import crypto from 'crypto';
import { Router, Response } from 'express';
import { assertJwtSecretConfigured, generateToken } from '../services/auth-service';
import { invalidateAuthUserCache } from '../middleware/auth';
import { setCsrfCookie, generateCsrfToken, timingSafeCompare } from '../middleware/csrf';
import { writeLog, getClientIp } from '../services/log-service';
import { logger } from '../services/logger';
import { handleRouteError, getErrorMessage } from '../middleware/error-handler';
import {
  getAuthorizationUrl,
  authenticateWithCode,
  findOrLinkPharmacy,
  generateOnboardingToken,
  verifyOnboardingToken,
} from '../services/workos-service';
import { buildTokenPayload, setAuthCookie, getLoginLogAction } from './auth-helpers';
import type { AuthRequest } from '../types';

const router = Router();

const ONBOARDING_COOKIE_NAME = 'onboarding_token';
const OAUTH_STATE_COOKIE = 'oauth_state';

type AuthRouteHandler = (req: AuthRequest, res: Response) => void | Promise<void>;
type OnboardingClaims = NonNullable<ReturnType<typeof verifyOnboardingToken>>;

function getClientBaseUrl(): string {
  if (process.env.CLIENT_URL) {
    return process.env.CLIENT_URL.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:5173';
}

function createAuthKitUrlHandler(
  screenHint: 'sign-in' | 'sign-up',
  logContext: string,
  userMessage: string,
): AuthRouteHandler {
  return (_req: AuthRequest, res: Response): void => {
    try {
      const state = crypto.randomBytes(32).toString('hex');
      res.cookie(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });
      const url = getAuthorizationUrl(screenHint, state);
      res.json({ url });
    } catch (err) {
      handleRouteError(err, logContext, userMessage, res);
    }
  };
}

export function getOnboardingClaimsOrRespond(
  req: AuthRequest,
  res: Response,
  missingMessage: string,
  invalidMessage: string,
): OnboardingClaims | null {
  const token = typeof req.cookies?.[ONBOARDING_COOKIE_NAME] === 'string' ? req.cookies[ONBOARDING_COOKIE_NAME] : '';
  if (!token) {
    res.status(401).json({ error: missingMessage });
    return null;
  }

  const claims = verifyOnboardingToken(token);
  if (!claims) {
    res.status(401).json({ error: invalidMessage });
    return null;
  }

  return claims;
}

router.get('/login', createAuthKitUrlHandler('sign-in', 'WorkOS login URL error', 'ログインURLの生成に失敗しました'));
router.get('/register', createAuthKitUrlHandler('sign-up', 'WorkOS register URL error', '登録URLの生成に失敗しました'));

router.get('/callback', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const stateCookie = typeof req.cookies?.[OAUTH_STATE_COOKIE] === 'string' ? req.cookies[OAUTH_STATE_COOKIE] : '';
    res.clearCookie(OAUTH_STATE_COOKIE);
    if (!stateParam || !stateCookie || !timingSafeCompare(stateParam, stateCookie)) {
      res.status(400).json({ error: 'OAuth state パラメータが無効です' });
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      res.status(400).json({ error: '認証コードがありません' });
      return;
    }
    assertJwtSecretConfigured();

    const authResult = await authenticateWithCode(code);
    const { pharmacy, isNewUser } = await findOrLinkPharmacy(authResult.user);

    if (isNewUser || !pharmacy) {
      const onboardingToken = generateOnboardingToken({
        workosUserId: authResult.user.id,
        email: authResult.user.email,
      });
      res.cookie(ONBOARDING_COOKIE_NAME, onboardingToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000,
      });

      res.redirect(`${getClientBaseUrl()}/onboarding`);
      return;
    }

    if (!pharmacy.isActive) {
      const clientBaseUrl = getClientBaseUrl();
      if (pharmacy.verificationStatus === 'pending_verification') {
        res.redirect(`${clientBaseUrl}/verification-pending?email=${encodeURIComponent(pharmacy.email)}`);
        return;
      }
      res.redirect(`${clientBaseUrl}/login?error=inactive`);
      return;
    }

    const token = generateToken(buildTokenPayload(pharmacy));
    invalidateAuthUserCache(pharmacy.id);

    setAuthCookie(res, token, process.env.NODE_ENV === 'production');
    setCsrfCookie(res, generateCsrfToken());

    const logAction = getLoginLogAction(pharmacy.isAdmin);
    void writeLog(logAction, {
      pharmacyId: pharmacy.id,
      detail: `WorkOS ログイン: ${pharmacy.name}`,
      ipAddress: getClientIp(req),
    });

    res.redirect(getClientBaseUrl());
  } catch (err) {
    logger.error('WorkOS callback error', { error: getErrorMessage(err) });
    res.redirect(`${getClientBaseUrl()}/login?error=auth_failed`);
  }
});

router.get('/onboarding-info', (req: AuthRequest, res: Response): void => {
  const claims = getOnboardingClaimsOrRespond(
    req,
    res,
    'Onboardingセッションが無効です。再度ログインしてください',
    'Onboardingセッションが期限切れです。再度ログインしてください',
  );
  if (!claims) {
    return;
  }

  res.json({ email: claims.email, workosUserId: claims.workosUserId });
});

export default router;

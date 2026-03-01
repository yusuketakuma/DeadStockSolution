import { Router } from 'express';
import { requireLogin } from '../middleware/auth';
import proposalsRouter from './exchange-proposals';
import commentsRouter from './exchange-comments';
import feedbackRouter from './exchange-feedback';
import historyRouter from './exchange-history';

const router = Router();
router.use(requireLogin);

router.use(proposalsRouter);
router.use(commentsRouter);
router.use(feedbackRouter);
router.use(historyRouter);

export default router;

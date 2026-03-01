import { Router } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import statsRouter from './admin-stats';
import logsRouter from './admin-logs';
import pharmaciesRouter from './admin-pharmacies';
import riskRouter from './admin-risk';
import reportsRouter from './admin-reports';
import trustRouter from './admin-trust';
import uploadJobsRouter from './admin-upload-jobs';
import matchingRulesRouter from './admin-matching-rules';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

router.use(statsRouter);
router.use(logsRouter);
router.use(trustRouter);
router.use(matchingRulesRouter);
router.use(riskRouter);
router.use(reportsRouter);
router.use(pharmaciesRouter);
router.use(uploadJobsRouter);

export default router;

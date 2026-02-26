import { Router } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import statsRouter from './admin-stats';
import logsRouter from './admin-logs';
import pharmaciesRouter from './admin-pharmacies';
import riskRouter from './admin-risk';
import reportsRouter from './admin-reports';
import trustRouter from './admin-trust';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

router.use(statsRouter);
router.use(logsRouter);
router.use(trustRouter);
router.use(riskRouter);
router.use(reportsRouter);
router.use(pharmaciesRouter);

export default router;

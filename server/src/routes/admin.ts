import { Router } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import statsRouter from './admin-stats';
import logsRouter from './admin-logs';
import pharmaciesRouter from './admin-pharmacies';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

router.use(statsRouter);
router.use(logsRouter);
router.use(pharmaciesRouter);

export default router;

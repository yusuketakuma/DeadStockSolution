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
import drugEquivalencesRouter from './admin-drug-equivalences';
import csvExportRouter from './admin-csv-export';

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
router.use(drugEquivalencesRouter);
router.use(csvExportRouter);
router.use(drugEquivalencesRouter);

export default router;

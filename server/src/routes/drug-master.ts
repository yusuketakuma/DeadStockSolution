import { Router } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import crudRouter from './drug-master-crud';
import syncRouter from './drug-master-sync';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

router.use('/', crudRouter);
router.use('/', syncRouter);

export default router;

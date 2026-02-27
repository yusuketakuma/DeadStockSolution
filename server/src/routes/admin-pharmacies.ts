import { Router } from 'express';
import listRouter from './admin-pharmacies-list';
import detailRouter from './admin-pharmacies-detail';
import actionsRouter from './admin-pharmacies-actions';

const router = Router();
router.use(listRouter);
router.use(detailRouter);
router.use(actionsRouter);

export default router;

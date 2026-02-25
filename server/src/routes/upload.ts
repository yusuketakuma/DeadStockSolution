import { Router } from 'express';
import { requireLogin } from '../middleware/auth';
import validationRouter from './upload-validation';
import parserRouter from './upload-parser';

const router = Router();

router.use(requireLogin);

router.use('/', validationRouter);
router.use('/', parserRouter);

export default router;

import { Router } from 'express';
import { requireLogin } from '../../middleware/auth';
import proposalsRouter from './proposals';
import commentsRouter from './comments';
import feedbackRouter from './feedback';
import historyRouter from './history';

const router = Router();
router.use(requireLogin);

router.use(proposalsRouter);
router.use(commentsRouter);
router.use(feedbackRouter);
router.use(historyRouter);

export default router;

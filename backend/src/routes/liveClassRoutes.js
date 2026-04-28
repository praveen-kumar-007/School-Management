import express from 'express';
import { scheduleLiveClass, listLiveClasses } from '../controllers/liveClassController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', roleMiddleware(['teacher', 'admin']), scheduleLiveClass);
router.get('/', roleMiddleware(['student', 'teacher', 'admin']), listLiveClasses);

export default router;

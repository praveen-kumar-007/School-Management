import express from 'express';
import {
	getAuditLogs,
	logAdminActivity,
	logErrorEvent,
	logUserAction
} from '../controllers/auditController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware(['teacher', 'admin']), getAuditLogs);
router.post('/user-action', authMiddleware, roleMiddleware(['student', 'teacher', 'admin']), logUserAction);
router.post('/errors', authMiddleware, roleMiddleware(['student', 'teacher', 'admin']), logErrorEvent);
router.post('/admin-activity', authMiddleware, roleMiddleware(['admin']), logAdminActivity);

export default router;
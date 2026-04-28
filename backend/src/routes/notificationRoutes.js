import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import {
  getMyNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  getNotificationPreferences,
  updateNotificationPreferences
} from '../controllers/notificationController.js';

const router = express.Router();

router.use(authMiddleware, roleMiddleware(['student', 'teacher', 'admin']));

router.get('/my', getMyNotifications);
router.put('/my/read-all', markAllNotificationsAsRead);
router.put('/my/:id/read', markNotificationAsRead);
router.get('/preferences', getNotificationPreferences);
router.put('/preferences', updateNotificationPreferences);

export default router;

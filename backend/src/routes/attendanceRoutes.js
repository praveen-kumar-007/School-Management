import express from 'express';
import {
  markAttendance,
  getAttendance,
  getStudentAttendance,
  getAttendanceSummary,
  exportAttendanceReport
} from '../controllers/attendanceController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

// NOTE: Specific routes must come BEFORE parameterized ones

// Student routes - specific paths
router.get('/my-attendance', authMiddleware, roleMiddleware(['student']), getStudentAttendance);

// Teacher routes
router.post('/mark', authMiddleware, roleMiddleware(['teacher', 'admin']), markAttendance);
router.get('/', authMiddleware, roleMiddleware(['teacher', 'admin']), getAttendance);
router.get('/summary', authMiddleware, roleMiddleware(['teacher', 'admin']), getAttendanceSummary);
router.get('/export', authMiddleware, roleMiddleware(['teacher', 'admin']), exportAttendanceReport);

export default router;

import express from 'express';
import {
  createAssignment,
  submitAssignment,
  gradeAssignment,
  getAssignments,
  createSmartTest,
  submitSmartTest,
  getSmartTestAnalytics,
  getAssignmentSubmissions
} from '../controllers/assignmentController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

// NOTE: Specific routes must come BEFORE parameterized ones

// Protected routes
router.get('/', authMiddleware, roleMiddleware(['student', 'teacher', 'admin']), getAssignments);

// Teacher routes - create assignment
router.post('/', authMiddleware, roleMiddleware(['teacher', 'admin']), createAssignment);
router.post('/smart-tests', authMiddleware, roleMiddleware(['teacher', 'admin']), createSmartTest);
router.get('/smart-tests/:assignmentId/analytics', authMiddleware, roleMiddleware(['teacher', 'admin']), getSmartTestAnalytics);

// Routes with :assignmentId (after specific routes)
router.put('/:assignmentId/grade', authMiddleware, roleMiddleware(['teacher', 'admin']), gradeAssignment);
router.get('/:assignmentId/submissions', authMiddleware, roleMiddleware(['teacher', 'admin']), getAssignmentSubmissions);
router.post('/:assignmentId/submit', authMiddleware, roleMiddleware(['student']), submitAssignment);
router.post('/smart-tests/:assignmentId/submit', authMiddleware, roleMiddleware(['student']), submitSmartTest);

export default router;

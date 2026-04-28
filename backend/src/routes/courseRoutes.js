import express from 'express';
import {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  enrollCourse,
  getStudentCourses,
  getStudentRecommendations,
  submitRecommendationFeedback,
  getRecommendationPreferences,
  clearRecommendationPreferences,
  removeRecommendationPreferenceItem,
  getInstructorCourses,
  updateLessonProgress,
  updateVideoProgress,
  completeQuiz,
  getMyCourseProgress,
  getCourseProgressAnalytics,
  askDoubtAssistant
} from '../controllers/courseController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

// NOTE: Specific routes must come BEFORE parameterized routes to avoid matching :id pattern
// This prevents "Route not found" errors

// Authenticated routes - specific paths
router.get('/student/my-courses', authMiddleware, roleMiddleware(['student']), getStudentCourses);
router.get('/student/recommendations', authMiddleware, roleMiddleware(['student']), getStudentRecommendations);
router.post('/student/recommendations/feedback', authMiddleware, roleMiddleware(['student']), submitRecommendationFeedback);
router.get('/student/recommendations/preferences', authMiddleware, roleMiddleware(['student']), getRecommendationPreferences);
router.delete('/student/recommendations/preferences', authMiddleware, roleMiddleware(['student']), clearRecommendationPreferences);
router.post('/student/recommendations/preferences/remove-item', authMiddleware, roleMiddleware(['student']), removeRecommendationPreferenceItem);
router.post('/student/doubt-assistant', authMiddleware, roleMiddleware(['student']), askDoubtAssistant);
router.get('/instructor/my-courses', authMiddleware, roleMiddleware(['teacher', 'admin']), getInstructorCourses);

// Protected course listing
router.get('/', authMiddleware, roleMiddleware(['student', 'teacher', 'admin']), getCourses);
router.get('/:id', authMiddleware, roleMiddleware(['student', 'teacher', 'admin']), getCourseById);

// Enroll route
router.post('/:courseId/enroll', authMiddleware, roleMiddleware(['student']), enrollCourse);

// Progress tracking routes
router.post('/:id/progress/lessons', authMiddleware, roleMiddleware(['student']), updateLessonProgress);
router.post('/:id/progress/video', authMiddleware, roleMiddleware(['student']), updateVideoProgress);
router.post('/:id/progress/quiz', authMiddleware, roleMiddleware(['student']), completeQuiz);
router.get('/:id/progress/my', authMiddleware, roleMiddleware(['student']), getMyCourseProgress);
router.get('/:id/progress', authMiddleware, roleMiddleware(['teacher', 'admin']), getCourseProgressAnalytics);

// Course CRUD - specific by ID (must be after specific routes like /student/my-courses)
// Guard route to avoid accidental unauthenticated access; already defined above with auth+roles
// router.get('/:id', getCourseById);
router.post('/', authMiddleware, roleMiddleware(['teacher', 'admin']), createCourse);
router.put('/:id', authMiddleware, roleMiddleware(['teacher', 'admin']), updateCourse);

export default router;

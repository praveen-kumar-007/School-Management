import express from 'express';
import { body } from 'express-validator';
import { authMiddleware } from '../middleware/auth.js';
import { permissionMiddleware, RBAC_ACTIONS, RBAC_RESOURCES } from '../middleware/rbac.js';
import validateRequest from '../middleware/validateRequest.js';
import {
  getOverview,
  approveCourse,
  assignCourseTeacher,
  createCourseByAdmin,
  createCourseContentFolder,
  createUser,
  addCourseContentMaterialVersion,
  createBackup,
  backupStatus,
  listBackupFiles,
  restoreBackup,
  deleteCourseByAdmin,
  deleteUser,
  exportReport,
  getAnalytics,
  getActivityLogs,
  getCourseEnrollments,
  getCourseContentFolders,
  getCoursesManagement,
  getModerationData,
  getUserProfile,
  listBroadcasts,
  listTeachers,
  listUsers,
  removeForumPost,
  sendBroadcast,
  uploadCourseContentMaterial,
  updateCourseByAdmin,
  updateUser
} from '../controllers/adminController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/users', permissionMiddleware(RBAC_RESOURCES.USERS, RBAC_ACTIONS.VIEW), listUsers);
router.get('/users/:id', permissionMiddleware(RBAC_RESOURCES.USERS, RBAC_ACTIONS.VIEW), getUserProfile);
router.post('/users', permissionMiddleware(RBAC_RESOURCES.USERS, RBAC_ACTIONS.MANAGE), createUser);
router.put('/users/:id', permissionMiddleware(RBAC_RESOURCES.USERS, RBAC_ACTIONS.EDIT), updateUser);
router.delete('/users/:id', permissionMiddleware(RBAC_RESOURCES.USERS, RBAC_ACTIONS.MANAGE), deleteUser);

router.post(
  '/backup',
  permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.MANAGE),
  body('targetCollections').optional().isArray({ min: 1 }),
  body('targetCollections.*').optional().isString().trim().escape(),
  validateRequest,
  createBackup
);
router.get('/backup/status', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), backupStatus);
router.get('/backup/list', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), listBackupFiles);
router.post('/backup/restore', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.MANAGE), restoreBackup);

router.get('/teachers', permissionMiddleware(RBAC_RESOURCES.USERS, RBAC_ACTIONS.VIEW), listTeachers);
router.get('/overview', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), getOverview);
router.get('/courses', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.VIEW), getCoursesManagement);
router.post('/courses', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.MANAGE), createCourseByAdmin);
router.put('/courses/:id', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.EDIT), updateCourseByAdmin);
router.delete('/courses/:id', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.MANAGE), deleteCourseByAdmin);
router.put('/courses/:id/assign', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.MANAGE), assignCourseTeacher);
router.get('/courses/:id/enrollments', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.VIEW), getCourseEnrollments);
router.get('/courses/:id/content', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.VIEW), getCourseContentFolders);
router.post('/courses/:id/content/folders', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.EDIT), createCourseContentFolder);
router.post('/courses/:id/content/materials', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.EDIT), uploadCourseContentMaterial);
router.post('/courses/:id/content/materials/:materialId/versions', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.EDIT), addCourseContentMaterialVersion);

router.get('/moderation', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.MANAGE), getModerationData);
router.put('/moderation/courses/:id/approve', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.MANAGE), approveCourse);
router.delete('/moderation/forums/:id', permissionMiddleware(RBAC_RESOURCES.COURSES, RBAC_ACTIONS.MANAGE), removeForumPost);

router.get('/analytics', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), getAnalytics);
router.get('/activity-logs', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), getActivityLogs);
router.get('/reports/export', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), exportReport);

router.get('/broadcasts', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.VIEW), listBroadcasts);
router.post('/broadcasts', permissionMiddleware(RBAC_RESOURCES.ANALYTICS, RBAC_ACTIONS.MANAGE), sendBroadcast);

export default router;
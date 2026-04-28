import express from 'express';
import { body, param } from 'express-validator';
import {
  addForumReply,
  createForumPost,
  createGoal,
  createNote,
  deleteForumPost,
  deleteForumReply,
  deleteGoal,
  deleteNote,
  listForumPosts,
  listGoals,
  listNotes,
  syncStudentState,
  updateForumPost,
  updateGoal,
  updateNote,
  upvoteForumPost
} from '../controllers/studentDashboardController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';

const router = express.Router();

router.use(authMiddleware, roleMiddleware(['student']));

/**
 * @swagger
 * tags:
 *   - name: Student Dashboard
 *     description: Student personalized dashboard resources
 */

router.get('/notes', listNotes);
router.post(
  '/notes',
  [
    body('courseId').isString().notEmpty(),
    body('courseTitle').optional().isString(),
    body('note').isString().trim().isLength({ min: 1, max: 5000 }),
    body('highlight').optional().isString().isLength({ max: 255 })
  ],
  validateRequest,
  createNote
);
router.put(
  '/notes/:id',
  [param('id').isMongoId(), body('note').optional().isString().isLength({ min: 1, max: 5000 }), body('highlight').optional().isString().isLength({ max: 255 })],
  validateRequest,
  updateNote
);
router.delete('/notes/:id', [param('id').isMongoId()], validateRequest, deleteNote);

router.get('/goals', listGoals);
router.post(
  '/goals',
  [body('title').isString().trim().isLength({ min: 1, max: 255 }), body('milestone').isString().trim().isLength({ min: 1, max: 255 }), body('progress').optional().isInt({ min: 0, max: 100 }), body('completed').optional().isBoolean()],
  validateRequest,
  createGoal
);
router.put(
  '/goals/:id',
  [param('id').isMongoId(), body('title').optional().isString().isLength({ min: 1, max: 255 }), body('milestone').optional().isString().isLength({ min: 1, max: 255 }), body('progress').optional().isInt({ min: 0, max: 100 }), body('completed').optional().isBoolean()],
  validateRequest,
  updateGoal
);
router.delete('/goals/:id', [param('id').isMongoId()], validateRequest, deleteGoal);

router.get('/forums/posts', listForumPosts);
router.post(
  '/forums/posts',
  [body('courseId').isString().notEmpty(), body('courseTitle').optional().isString(), body('message').isString().trim().isLength({ min: 1, max: 10000 })],
  validateRequest,
  createForumPost
);
router.put('/forums/posts/:id', [param('id').isMongoId(), body('message').isString().trim().isLength({ min: 1, max: 10000 })], validateRequest, updateForumPost);
router.delete('/forums/posts/:id', [param('id').isMongoId()], validateRequest, deleteForumPost);
router.post('/forums/posts/:id/replies', [param('id').isMongoId(), body('message').isString().trim().isLength({ min: 1, max: 5000 })], validateRequest, addForumReply);
router.delete('/forums/replies/:replyId', [param('replyId').isMongoId()], validateRequest, deleteForumReply);
router.post('/forums/posts/:id/upvote', [param('id').isMongoId()], validateRequest, upvoteForumPost);

router.get('/sync', syncStudentState);

export default router;

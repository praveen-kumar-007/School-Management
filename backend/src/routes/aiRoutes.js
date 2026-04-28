import express from 'express';
import {
  doubtSolver,
  studyPlanner,
  summarizeNotes,
  summarizePdfNotes
} from '../controllers/aiController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware, roleMiddleware(['student', 'teacher', 'admin']));

router.post('/doubt-solver', doubtSolver);
router.post('/notes-summarizer/text', summarizeNotes);
router.post('/notes-summarizer/pdf', summarizePdfNotes);
router.post('/study-planner', studyPlanner);

export default router;

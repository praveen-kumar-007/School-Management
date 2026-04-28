import express from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { globalSearch } from '../controllers/searchController.js';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware(['student', 'teacher', 'admin']), globalSearch);

export default router;

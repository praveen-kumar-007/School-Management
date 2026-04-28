import express from 'express';
import {
	register,
	login,
	getProfile,
	updateProfile,
	verifyToken,
	refreshToken,
	logout,
	getAllUsers,
	deleteUser,
	getAdminStats
} from '../controllers/authController.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = express.Router();

// NOTE: Specific routes must come BEFORE parameterized ones

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', authMiddleware, logout);

// Protected routes
router.get('/verify', authMiddleware, verifyToken);
router.get('/profile', authMiddleware, getProfile);
router.put('/profile', authMiddleware, updateProfile);

// Admin routes
router.get('/users', authMiddleware, roleMiddleware(['admin']), getAllUsers);
router.delete('/users/:id', authMiddleware, roleMiddleware(['admin']), deleteUser);
router.get('/admin/stats', authMiddleware, roleMiddleware(['admin']), getAdminStats);

export default router;

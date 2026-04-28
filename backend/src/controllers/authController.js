import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Course from '../models/Course.js';
import { blacklistToken } from '../services/tokenService.js';
import Assignment from '../models/Assignment.js';
import Attendance from '../models/Attendance.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { notifyAdmins } from '../services/notificationService.js';

const ACCESS_TOKEN_EXPIRE = process.env.JWT_EXPIRE || '15m';
const REFRESH_TOKEN_EXPIRE = process.env.REFRESH_TOKEN_EXPIRE || '7d';

const parseExpiryToMs = (value, fallbackMs) => {
  if (!value || typeof value !== 'string') return fallbackMs;

  const match = value.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    const asNumber = Number(value);
    return Number.isNaN(asNumber) ? fallbackMs : asNumber * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMultiplier = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * unitMultiplier[unit];
};

const REFRESH_TOKEN_EXPIRE_MS = parseExpiryToMs(REFRESH_TOKEN_EXPIRE, 7 * 24 * 60 * 60 * 1000);

const getRefreshSecret = () => process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: user.avatar,
  bio: user.bio,
  enrolledCourses: user.enrolledCourses,
  createdCourses: user.createdCourses,
  isActive: user.isActive,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const removeExpiredRefreshTokens = (user) => {
  const now = Date.now();
  user.refreshTokens = (user.refreshTokens || []).filter((entry) => {
    return !entry.revokedAt && new Date(entry.expiresAt).getTime() > now;
  });
};

// Generate Access Token (short-lived)
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role, name: user.name, tokenType: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRE }
  );
};

// Generate Refresh Token (long-lived)
const generateRefreshToken = (user, tokenId) => {
  return jwt.sign(
    { id: user._id, tokenId, tokenType: 'refresh' },
    getRefreshSecret(),
    { expiresIn: REFRESH_TOKEN_EXPIRE }
  );
};

// Generate both tokens
const generateTokens = (user) => {
  const tokenId = crypto.randomUUID();

  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user, tokenId),
    tokenId
  };
};

const persistRefreshToken = async (user, refreshToken, tokenId) => {
  removeExpiredRefreshTokens(user);

  user.refreshTokens = [
    {
      tokenHash: hashToken(refreshToken),
      tokenId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRE_MS)
    },
    ...(user.refreshTokens || [])
  ].slice(0, 10);

  await user.save();
};

export const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }

    // Validate email format
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists with this email' });
    }

    // Create user
    const user = new User({
      name,
      email,
      password,
      role: role || 'student'
    });

    await user.save();

    await logAuditEvent(req, {
      action: 'auth.register',
      targetType: 'user',
      targetId: user._id?.toString(),
      metadata: {
        email: user.email,
        role: user.role
      }
    });

    await notifyAdmins({
      type: 'new_user_registration',
      title: 'New User Registration',
      message: `${user.name} (${user.email}) registered as ${user.role}.`,
      metadata: {
        userId: user._id?.toString(),
        email: user.email,
        role: user.role
      },
      sendEmail: true
    });

    // Generate tokens
    const { accessToken, refreshToken, tokenId } = generateTokens(user);
    await persistRefreshToken(user, refreshToken, tokenId);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRE,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    // Find user and include password field along with lock info
    const user = await User.findOne({ email }).select('+password +refreshTokens.tokenHash +refreshTokens.tokenId +refreshTokens.expiresAt +refreshTokens.revokedAt +refreshTokens.lastUsedAt +refreshTokens.createdAt +loginAttempts +lockUntil');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated' });
    }

    // Apply account lockout on too many failed login attempts
    if (user.isLocked) {
      const lockMinutes = Number(process.env.ACCOUNT_LOCK_MINUTES || 15);
      return res.status(423).json({
        success: false,
        message: `Account locked due to multiple failed login attempts. Try again in ${lockMinutes} minutes.`
      });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await user.incrementLoginAttempts();
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    await user.resetLoginAttempts();

    // Update last login (best-effort, should not block successful authentication)
    try {
      await User.updateOne(
        { _id: user._id },
        { $set: { lastLogin: new Date() } }
      );
    } catch (lastLoginError) {
      console.error('Last login update failed:', lastLoginError);
    }

    await logAuditEvent(req, {
      action: 'auth.login',
      targetType: 'user',
      targetId: user._id?.toString(),
      metadata: {
        email: user.email,
        role: user.role
      }
    });

    // Generate tokens
    const { accessToken, refreshToken, tokenId } = generateTokens(user);
    await persistRefreshToken(user, refreshToken, tokenId);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRE,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('enrolledCourses').populate('createdCourses');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get Profile Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, bio, avatar } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, bio, avatar },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const verifyToken = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Verify Token Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Refresh Access Token
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, getRefreshSecret());
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    if (decoded?.tokenType !== 'refresh' || !decoded?.tokenId) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token payload' });
    }

    // Find user
    const user = await User.findById(decoded.id).select('+refreshTokens.tokenHash +refreshTokens.tokenId +refreshTokens.expiresAt +refreshTokens.revokedAt +refreshTokens.lastUsedAt +refreshTokens.createdAt');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'User account is inactive' });
    }

    const incomingTokenHash = hashToken(refreshToken);

    const matchedToken = (user.refreshTokens || []).find((entry) => {
      return entry.tokenId === decoded.tokenId
        && entry.tokenHash === incomingTokenHash
        && !entry.revokedAt
        && new Date(entry.expiresAt).getTime() > Date.now();
    });

    if (!matchedToken) {
      return res.status(401).json({ success: false, message: 'Refresh token was revoked or not recognized' });
    }

    matchedToken.revokedAt = new Date();
    matchedToken.lastUsedAt = new Date();

    const { accessToken: newAccessToken, refreshToken: newRefreshToken, tokenId: nextTokenId } = generateTokens(user);
    await persistRefreshToken(user, newRefreshToken, nextTokenId);

    await logAuditEvent(req, {
      action: 'auth.refresh',
      targetType: 'user',
      targetId: user._id?.toString(),
      metadata: {
        role: user.role
      }
    });

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRE
    });
  } catch (error) {
    console.error('Refresh Token Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Logout
export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const accessToken = req.headers.authorization?.split(' ')[1];

    if (accessToken) {
      await blacklistToken(accessToken);
    }

    if (req.user?.id) {
      const user = await User.findById(req.user.id).select('+refreshTokens.tokenHash +refreshTokens.tokenId +refreshTokens.expiresAt +refreshTokens.revokedAt +refreshTokens.lastUsedAt +refreshTokens.createdAt');

      if (user) {
        if (refreshToken) {
          const refreshHash = hashToken(refreshToken);
          user.refreshTokens = (user.refreshTokens || []).map((entry) => {
            if (entry.tokenHash === refreshHash && !entry.revokedAt) {
              entry.revokedAt = new Date();
              entry.lastUsedAt = new Date();
            }

            return entry;
          });
        } else {
          user.refreshTokens = (user.refreshTokens || []).map((entry) => ({
            ...entry,
            revokedAt: entry.revokedAt || new Date(),
            lastUsedAt: new Date()
          }));
        }

        await user.save();

        await logAuditEvent(req, {
          action: 'auth.logout',
          targetType: 'user',
          targetId: user._id?.toString(),
          metadata: {
            role: user.role
          }
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    const role = req.query.role;

    const filter = {};
    if (role) {
      filter.role = role;
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      users
    });
  } catch (error) {
    console.error('Get All Users Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await logAuditEvent(req, {
      action: 'admin.user.delete',
      targetType: 'user',
      targetId: id,
      metadata: {
        deletedEmail: user.email,
        deletedRole: user.role
      }
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminStats = async (_req, res) => {
  try {
    const [totalUsers, totalStudents, totalTeachers, totalCourses, publishedCourses, totalAssignments, totalAttendance, recentUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'teacher' }),
      Course.countDocuments(),
      Course.countDocuments({ isPublished: true }),
      Assignment.countDocuments(),
      Attendance.countDocuments(),
      User.find().select('name email role createdAt').sort({ createdAt: -1 }).limit(5)
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalStudents,
        totalTeachers,
        totalCourses,
        publishedCourses,
        totalAssignments,
        totalAttendance
      },
      recentUsers
    });
  } catch (error) {
    console.error('Get Admin Stats Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isTokenBlacklisted } from '../services/tokenService.js';

export const ROLES = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin'
};

const VALID_ROLES = Object.values(ROLES);

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.tokenType && decoded.tokenType !== 'access') {
      return res.status(401).json({ message: 'Invalid access token type' });
    }

    if (await isTokenBlacklisted(token)) {
      return res.status(401).json({ message: 'Token has been revoked' });
    }

    let user = null;
    try {
      user = await User.findById(decoded.id).select('name email role isActive');
    } catch (error) {
      if (error?.name !== 'CastError') {
        throw error;
      }
    }
    if (!user) {
      const allowTokenPayloadFallback = process.env.AUTH_REQUIRE_DB_USER !== 'true';

      if (allowTokenPayloadFallback && decoded?.id && decoded?.email && VALID_ROLES.includes(decoded?.role)) {
        req.user = {
          id: decoded.id,
          name: decoded.name,
          email: decoded.email,
          role: decoded.role
        };

        next();
        return;
      }

      return res.status(401).json({ message: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'User account is inactive' });
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const normalizedAllowedRoles = Array.isArray(allowedRoles)
      ? allowedRoles.filter((role) => VALID_ROLES.includes(role))
      : [];

    if (!normalizedAllowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized to access this resource' });
    }

    next();
  };
};

export const requireAdmin = roleMiddleware([ROLES.ADMIN]);
export const requireTeacher = roleMiddleware([ROLES.TEACHER, ROLES.ADMIN]);
export const requireStudent = roleMiddleware([ROLES.STUDENT]);

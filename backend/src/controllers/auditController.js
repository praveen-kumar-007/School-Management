import asyncHandler from '../middleware/asyncHandler.js';
import AppError from '../utils/AppError.js';
import {
  getAuditLogsService,
  logAdminActivityService,
  logErrorEventService,
  logUserActionService
} from '../services/auditService.js';

const validateActionPayload = (payload) => {
  if (!payload?.action || typeof payload.action !== 'string') {
    throw new AppError('action is required and must be a string', 400);
  }
};

export const getAuditLogs = asyncHandler(async (req, res) => {
  const result = await getAuditLogsService({
    query: req.query,
    user: req.user
  });

  res.status(200).json({
    success: true,
    ...result
  });
});

export const logUserAction = asyncHandler(async (req, res) => {
  validateActionPayload(req.body);

  const log = await logUserActionService(req, req.body);

  res.status(201).json({
    success: true,
    message: 'User action logged successfully',
    log
  });
});

export const logAdminActivity = asyncHandler(async (req, res) => {
  validateActionPayload(req.body);

  if (req.user?.role !== 'admin') {
    throw new AppError('Only admins can log admin activity', 403);
  }

  const log = await logAdminActivityService(req, req.body);

  res.status(201).json({
    success: true,
    message: 'Admin activity logged successfully',
    log
  });
});

export const logErrorEvent = asyncHandler(async (req, res) => {
  validateActionPayload(req.body);

  const log = await logErrorEventService(req, req.body);

  res.status(201).json({
    success: true,
    message: 'Error event logged successfully',
    log
  });
});
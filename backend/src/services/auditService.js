import { createAuditLog, findAuditLogs } from '../repositories/auditRepository.js';

const getClientIp = (req) => req.ip || req.headers['x-forwarded-for'] || null;

const baseAuditPayload = (req, payload) => ({
  actor: req?.user?.id || null,
  actorRole: req?.user?.role || 'student',
  action: payload.action,
  targetType: payload.targetType || 'unknown',
  targetId: payload.targetId || null,
  metadata: payload.metadata || {},
  ipAddress: getClientIp(req),
  userAgent: req?.headers?.['user-agent'] || null
});

export const getAuditLogsService = async ({ query, user }) => {
  const { page = 1, limit = 20, action, actorRole } = query;

  const numericPage = Math.max(parseInt(page, 10) || 1, 1);
  const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const filter = {};
  if (action) filter.action = action;
  if (actorRole) filter.actorRole = actorRole;

  if (user?.role !== 'admin') {
    filter.actor = user?.id;
  }

  const { logs, total } = await findAuditLogs({
    filter,
    page: numericPage,
    limit: numericLimit
  });

  return {
    page: numericPage,
    limit: numericLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / numericLimit)),
    logs
  };
};

export const logAuditEventService = async (req, payload) => {
  if (!payload?.action || !req?.user?.id || !req?.user?.role) {
    return null;
  }

  return createAuditLog(baseAuditPayload(req, payload));
};

export const logUserActionService = async (req, payload) => {
  return createAuditLog(baseAuditPayload(req, {
    ...payload,
    action: payload?.action || 'user.action'
  }));
};

export const logAdminActivityService = async (req, payload) => {
  return createAuditLog(baseAuditPayload(req, {
    ...payload,
    action: payload?.action || 'admin.activity',
    metadata: {
      ...(payload?.metadata || {}),
      activityType: payload?.metadata?.activityType || 'admin'
    }
  }));
};

export const logErrorEventService = async (req, payload) => {
  return createAuditLog(baseAuditPayload(req, {
    ...payload,
    action: payload?.action || 'system.error',
    metadata: {
      ...(payload?.metadata || {}),
      severity: payload?.metadata?.severity || 'error'
    }
  }));
};

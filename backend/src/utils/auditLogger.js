import { logAuditEventService } from '../services/auditService.js';
import logger from './logger.js';

export const logAuditEvent = async (req, payload) => {
  try {
    await logAuditEventService(req, payload);
  } catch (error) {
    logger.error('Audit logging failed', {
      error: error.message,
      action: payload?.action,
      actorId: req?.user?.id || null
    });
  }
};
import AuditLog from '../models/AuditLog.js';

export const findAuditLogs = async ({ filter, page, limit }) => {
  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actor', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AuditLog.countDocuments(filter)
  ]);

  return { logs, total };
};

export const createAuditLog = async (payload) => {
  return AuditLog.create(payload);
};

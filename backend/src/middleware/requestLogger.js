import logger from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request completed', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
      userId: req.user?.id || null,
      userRole: req.user?.role || null,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || null
    });
  });

  next();
};

export default requestLogger;

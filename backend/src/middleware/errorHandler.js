import { captureException } from '../config/monitoring.js';
import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  logger.error('Request failed', {
    status,
    message,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.id || null,
    userRole: req.user?.role || null,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  if (status >= 500) {
    captureException(err, {
      path: req.originalUrl,
      method: req.method,
      statusCode: status
    });
  }

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export default errorHandler;

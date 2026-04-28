import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import connectDB from './config/database.js';
import { initializeMonitoring } from './config/monitoring.js';
import errorHandler from './middleware/errorHandler.js';
import { connectRedis } from './config/redis.js';
import { swaggerMiddleware } from './config/swagger.js';
import { metricsHandler, metricsMiddleware } from './middleware/metrics.js';
import requestLogger from './middleware/requestLogger.js';
import { requestSanitizer } from './middleware/requestSanitizer.js';
import {
  authRateLimiter,
  enforceHttps,
  globalRateLimiter,
  helmetMiddleware,
  parameterPollutionProtection
} from './middleware/security.js';
import logger from './utils/logger.js';
import { setRealtimeServer } from './utils/realtime.js';
import { scheduleAutomaticBackups } from './services/backupService.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import courseRoutes from './routes/courseRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import assignmentRoutes from './routes/assignmentRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import studentDashboardRoutes from './routes/studentDashboardRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import liveClassRoutes from './routes/liveClassRoutes.js';

// Load environment variables
dotenv.config({ quiet: true });

initializeMonitoring();

// Initialize Express app
const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
const defaultOrigins = ['http://localhost:3000', 'http://localhost:5173'];
const envOrigins = [process.env.FRONTEND_URLS, process.env.FRONTEND_URL]
  .filter(Boolean)
  .flatMap((value) => value.split(','))
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];
const isLocalDevOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');

app.use(cors({
  origin: (origin, callback) => {
    const allowLocalDevOrigin = process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin);

    if (!origin || allowedOrigins.includes(origin) || allowLocalDevOrigin) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true
}));

app.use(enforceHttps);
app.use(helmetMiddleware);
app.use(globalRateLimiter);
app.use(parameterPollutionProtection);
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(requestSanitizer);
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: {
    fileSize: Number(process.env.FILE_UPLOAD_MAX_BYTES || 2 * 1024 * 1024 * 1024) // 2 GB default
  },
  abortOnLimit: true,
  safeFileNames: true,
  preserveExtension: true
}));
app.use(metricsMiddleware);

const enableRequestLogs = process.env.LOG_HTTP_REQUESTS === 'true';
if (enableRequestLogs) {
  app.use(requestLogger);
}

// Connect to database
await connectDB();
await connectRedis();

scheduleAutomaticBackups();

// API Routes
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/student-dashboard', studentDashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/live-classes', liveClassRoutes);
if (swaggerMiddleware.length > 0) {
  app.use('/api/docs', ...swaggerMiddleware);
}
app.get('/metrics', metricsHandler);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'Backend is running!', timestamp: new Date() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

setRealtimeServer(io);

io.on('connection', (socket) => {
  socket.on('join:user', (mongoUserId) => {
    if (mongoUserId) {
      socket.join(`user:${mongoUserId}`);
    }
  });

  socket.on('join:admin', (mongoUserId) => {
    socket.join('admin:all');
    if (mongoUserId) {
      socket.join(`user:${mongoUserId}`);
    }
  });

  socket.on('join:student', (studentMongoUserId) => {
    if (studentMongoUserId) {
      socket.join(`student:${studentMongoUserId}`);
    }
  });

  socket.on('join:course', (mongoCourseId) => {
    if (mongoCourseId) {
      socket.join(`course:${mongoCourseId}`);
    }
  });
});

httpServer.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    apiBaseUrl: `http://localhost:${PORT}`,
    corsOrigins: allowedOrigins,
    swaggerDocs: process.env.ENABLE_SWAGGER === 'true'
      ? `http://localhost:${PORT}/api/docs`
      : 'disabled (set ENABLE_SWAGGER=true)'
  });
});

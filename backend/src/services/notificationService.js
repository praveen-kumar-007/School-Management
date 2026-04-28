import Notification from '../models/Notification.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { getRealtimeServer } from '../utils/realtime.js';

let emailTransporterPromise = null;

const getEmailTransporter = async () => {
  if (emailTransporterPromise) {
    return emailTransporterPromise;
  }

  emailTransporterPromise = (async () => {
    try {
      const nodemailerModule = await import('nodemailer');
      const nodemailer = nodemailerModule.default || nodemailerModule;

      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null;
      }

      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } catch (error) {
      logger.warn('Email transporter unavailable', { reason: error.message });
      return null;
    }
  })();

  return emailTransporterPromise;
};

const NOTIFICATION_TYPE_TO_PREF_KEY = {
  assignment_uploaded: 'assignment_uploaded',
  assignment_graded: 'assignment_graded',
  test_scheduled: 'test_scheduled',
  material_uploaded: 'material_uploaded',
  live_class_scheduled: 'live_class_scheduled',
  general: 'general',
  course_update: 'general',
  announcements: 'announcements',
  new_user_registration: 'general',
  course_purchase: 'general',
  course_completion: 'general',
  system_update: 'general'
};

const getAllowedUsersForNotification = async (userIds, type) => {
  if (!Array.isArray(userIds) || !userIds.length) {
    return [];
  }

  const prefKey = NOTIFICATION_TYPE_TO_PREF_KEY[type] || 'general';

  const users = await User.find({ _id: { $in: userIds }, isActive: true }).select('notificationPreferences email name');

  return users
    .filter((user) => user.notificationPreferences?.[prefKey]?.inApp)
    .map((user) => user._id.toString());
};

export const createNotificationsForUsers = async ({ userIds, type, title, message, metadata = {} }) => {
  const uniqueUserIds = [...new Set(userIds.map((id) => id?.toString()).filter(Boolean))];
  const allowedUserIds = await getAllowedUsersForNotification(uniqueUserIds, type);

  if (!allowedUserIds.length) {
    return [];
  }

  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes for duplicate guard

  const existing = await Notification.find({
    user: { $in: allowedUserIds },
    type,
    title,
    message,
    createdAt: { $gte: recentCutoff }
  }).select('user');

  const existingUserIds = new Set(existing.map((n) => n.user.toString()));

  const docs = allowedUserIds
    .filter((userId) => !existingUserIds.has(userId))
    .map((userId) => ({
      user: userId,
      type,
      title,
      message,
      metadata,
      isRead: false
    }));

  if (!docs.length) {
    return [];
  }

  try {
    return await Notification.insertMany(docs, { ordered: false });
  } catch (error) {
    // ignore unique errors from race conditions
    if (error?.code !== 11000) {
      throw error;
    }
    return [];
  }
};

const toRealtimeNotification = (notification) => ({
  _id: notification._id?.toString?.() || notification.id,
  user: notification.user?.toString?.() || notification.user,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  metadata: notification.metadata || {},
  isRead: notification.isRead,
  readAt: notification.readAt || null,
  createdAt: notification.createdAt || new Date().toISOString(),
  updatedAt: notification.updatedAt || new Date().toISOString()
});

const emitRealtimeNotifications = (notifications = []) => {
  const io = getRealtimeServer();
  if (!io || !notifications.length) {
    return;
  }

  notifications.forEach((notification) => {
    const payload = toRealtimeNotification(notification);
    const userId = payload.user;

    if (userId) {
      io.to(`user:${userId}`).emit('notification:new', payload);
    }
  });
};

const emitAdminRealtimeAlerts = (notifications = []) => {
  const io = getRealtimeServer();
  if (!io || !notifications.length) {
    return;
  }

  notifications.forEach((notification) => {
    io.to('admin:all').emit('admin.notification', toRealtimeNotification(notification));
  });
};

export const sendEmailNotifications = async ({ userIds, subject, message }) => {
  if (!Array.isArray(userIds) || !userIds.length) {
    return;
  }

  const transporter = await getEmailTransporter();
  if (!transporter) {
    return;
  }

  const recipients = await User.find({ _id: { $in: userIds }, isActive: true }).select('email name');
  if (!recipients.length) {
    return;
  }

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;

  await Promise.all(
    recipients
      .filter((recipient) => recipient.email)
      .map(async (recipient) => {
        try {
          await transporter.sendMail({
            from: fromAddress,
            to: recipient.email,
            subject,
            text: `${message}\n\nRegards,\nE-Learning Platform`
          });
        } catch (error) {
          logger.error('Failed to send email notification', {
            userId: recipient._id?.toString(),
            email: recipient.email,
            error: error.message
          });
        }
      })
  );
};

export const notifyUsers = async ({ userIds, type, title, message, metadata = {}, sendEmail = true }) => {
  const createdNotifications = await createNotificationsForUsers({ userIds, type, title, message, metadata });
  emitRealtimeNotifications(createdNotifications);

  if (sendEmail) {
    await sendEmailNotifications({
      userIds,
      subject: title,
      message
    });
  }

  return createdNotifications;
};

export const notifyAdmins = async ({
  type,
  title,
  message,
  metadata = {},
  sendEmail = true
}) => {
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
  const adminIds = admins.map((admin) => admin._id?.toString()).filter(Boolean);

  if (!adminIds.length) {
    return [];
  }

  const createdNotifications = await createNotificationsForUsers({
    userIds: adminIds,
    type,
    title,
    message,
    metadata
  });

  emitRealtimeNotifications(createdNotifications);
  emitAdminRealtimeAlerts(createdNotifications);

  if (sendEmail) {
    await sendEmailNotifications({
      userIds: adminIds,
      subject: title,
      message
    });
  }

  return createdNotifications;
};

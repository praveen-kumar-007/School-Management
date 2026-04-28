import Notification from '../models/Notification.js';
import User from '../models/User.js';

export const getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = 'false', type } = req.query;
    const numericPage = Math.max(parseInt(page, 10) || 1, 1);
    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = { user: req.user.id };
    if (type) {
      filter.type = type;
    }
    if (String(unreadOnly).toLowerCase() === 'true') {
      filter.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((numericPage - 1) * numericLimit)
        .limit(numericLimit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user.id, isRead: false })
    ]);

    res.status(200).json({
      success: true,
      page: numericPage,
      limit: numericLimit,
      total,
      unreadCount,
      notifications
    });
  } catch (error) {
    console.error('Get Notifications Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, user: req.user.id });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    res.status(200).json({ success: true, notification });
  } catch (error) {
    console.error('Mark Notification Read Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      updatedCount: result.modifiedCount || 0
    });
  } catch (error) {
    console.error('Mark All Notifications Read Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getNotificationPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('notificationPreferences');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      notificationPreferences: user.notificationPreferences || {}
    });
  } catch (error) {
    console.error('Get Notification Preferences Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateNotificationPreferences = async (req, res) => {
  try {
    const updates = req.body;

    const user = await User.findById(req.user.id).select('notificationPreferences');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.notificationPreferences = user.notificationPreferences || {};

    Object.keys(updates).forEach((type) => {
      if (typeof updates[type] === 'object' && updates[type] !== null) {
        user.notificationPreferences[type] = {
          ...user.notificationPreferences[type],
          ...updates[type]
        };
      }
    });

    await user.save();

    res.status(200).json({
      success: true,
      notificationPreferences: user.notificationPreferences
    });
  } catch (error) {
    console.error('Update Notification Preferences Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

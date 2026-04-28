import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    type: {
      type: String,
      index: true
    },
    type: {
      type: String,
      enum: [
        'assignment_uploaded',
        'assignment_graded',
        'test_scheduled',
        'material_uploaded',
        'live_class_scheduled',
        'general',
        'new_user_registration',
        'course_purchase',
        'course_completion',
        'system_update'
      ],
      default: 'general'
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    metadata: {
      type: Object,
      default: {}
    },
    isRead: {
      type: Boolean,
      default: false
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

notificationSchema.index(
  { user: 1, type: 1, title: 1, message: 1 },
  { unique: true, partialFilterExpression: { isRead: false } }
);

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;

import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
      maxlength: [50, 'Name cannot be more than 50 characters']
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    role: {
      type: String,
      enum: ['student', 'teacher', 'admin'],
      default: 'student'
    },
    avatar: {
      type: String,
      default: null
    },
    bio: {
      type: String,
      default: ''
    },
    enrolledCourses: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      index: true
    }],
    recommendationPreferences: {
      notInterestedCourseIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course'
      }],
      notInterestedCategories: [{
        type: String,
        enum: ['programming', 'design', 'business', 'science', 'arts', 'other']
      }]
    },
    notificationPreferences: {
      assignment_uploaded: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      },
      assignment_graded: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      },
      test_scheduled: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      },
      material_uploaded: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      },
      live_class_scheduled: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      },
      general: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      },
      announcements: {
        inApp: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
      }
    },
    createdCourses: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course'
    }],
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: null
    },
    loginAttempts: {
      type: Number,
      default: 0,
      select: false
    },
    lockUntil: {
      type: Date,
      default: null,
      select: false
    },
    refreshTokens: [{
      tokenHash: {
        type: String,
        required: true,
        select: false
      },
      tokenId: {
        type: String,
        required: true,
        select: false
      },
      expiresAt: {
        type: Date,
        required: true,
        select: false
      },
      createdAt: {
        type: Date,
        default: Date.now,
        select: false
      },
      revokedAt: {
        type: Date,
        default: null,
        select: false
      },
      lastUsedAt: {
        type: Date,
        default: null,
        select: false
      }
    }]
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcryptjs.genSalt(10);
  this.password = await bcryptjs.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcryptjs.compare(enteredPassword, this.password);
};

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.incrementLoginAttempts = async function() {
  const maxAttempts = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
  const lockDurationMinutes = Number(process.env.ACCOUNT_LOCK_MINUTES || 15);

  if (this.lockUntil && this.lockUntil > Date.now()) {
    return this.save();
  }

  this.loginAttempts += 1;

  if (this.loginAttempts >= maxAttempts) {
    this.lockUntil = new Date(Date.now() + lockDurationMinutes * 60 * 1000);
  }

  return this.save();
};

userSchema.methods.resetLoginAttempts = async function() {
  this.loginAttempts = 0;
  this.lockUntil = null;
  return this.save();
};

userSchema.index({ role: 1 });

const User = mongoose.model('User', userSchema);

export default User;

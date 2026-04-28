import mongoose from 'mongoose';

const ForumReplySchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    }
  },
  { timestamps: true }
);

const ForumPostSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: false,
      index: true
    },
    courseTitle: {
      type: String,
      trim: true,
      maxlength: 255,
      default: ''
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 10000
    },
    upvotes: {
      type: Number,
      default: 0,
      min: 0
    },
    replies: {
      type: [ForumReplySchema],
      default: []
    }
  },
  { timestamps: true }
);

ForumPostSchema.index({ course: 1, updatedAt: -1 });
ForumPostSchema.index({ updatedAt: -1 });

const ForumPost = mongoose.model('ForumPost', ForumPostSchema);

export default ForumPost;

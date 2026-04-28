import mongoose from 'mongoose';

const courseProgressSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true
    },
    completedLessons: [{
      moduleIndex: {
        type: Number,
        required: true
      },
      lessonIndex: {
        type: Number,
        required: true
      },
      completedAt: {
        type: Date,
        default: Date.now
      }
    }],
    videoProgress: [{
      moduleIndex: {
        type: Number,
        required: true
      },
      lessonIndex: {
        type: Number,
        required: true
      },
      watchedPercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }],
    completedQuizzes: [{
      quiz: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quiz',
        required: true
      },
      score: {
        type: Number,
        default: 0
      },
      maxScore: {
        type: Number,
        default: 0
      },
      completedAt: {
        type: Date,
        default: Date.now
      }
    }],
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    lastActivityAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

courseProgressSchema.index({ student: 1, course: 1 }, { unique: true });
courseProgressSchema.index({ course: 1 });
courseProgressSchema.index({ student: 1 });

const CourseProgress = mongoose.model('CourseProgress', courseProgressSchema);

export default CourseProgress;

import mongoose from 'mongoose';

const StudentGoalSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255
    },
    milestone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    completed: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

StudentGoalSchema.index({ student: 1, updatedAt: -1 });

const StudentGoal = mongoose.model('StudentGoal', StudentGoalSchema);

export default StudentGoal;

import mongoose from 'mongoose';

const assignmentSubmissionSchema = new mongoose.Schema(
  {
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true,
      index: true
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    submittedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    fileUrl: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['submitted', 'graded', 'pending', 'resubmitted'],
      default: 'submitted'
    },
    marks: {
      type: Number,
      default: null
    },
    feedback: {
      type: String,
      default: ''
    },
    isReviewed: {
      type: Boolean,
      default: false
    },
    timeSpentSeconds: {
      type: Number,
      default: 0
    },
    startedAt: {
      type: Date,
      default: null
    },
    answers: [{
      questionIndex: Number,
      selectedOptionIndex: Number
    }],
    autoGradedScore: {
      type: Number,
      default: null
    }
  },
  { timestamps: true }
);

assignmentSubmissionSchema.index({ assignment: 1, student: 1 });
assignmentSubmissionSchema.index({ course: 1, student: 1 });
assignmentSubmissionSchema.index({ status: 1 });

const AssignmentSubmission = mongoose.model('AssignmentSubmission', assignmentSubmissionSchema);

export default AssignmentSubmission;

import mongoose from 'mongoose';

const quizSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    questions: [
      {
        prompt: {
          type: String,
          required: true
        },
        options: [{ type: String }],
        correctOptionIndex: {
          type: Number,
          required: true,
          min: 0
        },
        marks: {
          type: Number,
          default: 1,
          min: 0
        }
      }
    ],
    totalMarks: {
      type: Number,
      default: 100
    },
    dueDate: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

quizSchema.index({ course: 1 });

const Quiz = mongoose.model('Quiz', quizSchema);

export default Quiz;

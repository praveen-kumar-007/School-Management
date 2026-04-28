import mongoose from 'mongoose';

const assignmentSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    description: String,
    dueDate: {
      type: Date,
      required: true
    },
    kind: {
      type: String,
      enum: ['assignment', 'smart_test'],
      default: 'assignment'
    },
    testConfig: {
      durationMinutes: {
        type: Number,
        default: 30,
        min: 1
      },
      shuffleQuestions: {
        type: Boolean,
        default: false
      },
      questions: [{
        prompt: {
          type: String,
          required: false
        },
        options: [{
          type: String
        }],
        correctOptionIndex: {
          type: Number,
          default: 0
        },
        marks: {
          type: Number,
          default: 1,
          min: 0
        }
      }]
    },
    totalMarks: {
      type: Number,
      default: 100
    }
  },  { timestamps: true }
);

const Assignment = mongoose.model('Assignment', assignmentSchema);

export default Assignment;

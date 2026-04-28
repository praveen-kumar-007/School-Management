import mongoose from 'mongoose';

const StudentNoteSchema = new mongoose.Schema(
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
    note: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },
    highlight: {
      type: String,
      trim: true,
      maxlength: 255,
      default: ''
    }
  },
  { timestamps: true }
);

StudentNoteSchema.index({ student: 1, updatedAt: -1 });
StudentNoteSchema.index({ student: 1, course: 1, updatedAt: -1 });

const StudentNote = mongoose.model('StudentNote', StudentNoteSchema);

export default StudentNote;

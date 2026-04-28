import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    enrolledAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['enrolled', 'completed', 'dropped'],
      default: 'enrolled'
    }
  },
  { timestamps: true }
);

// Unique mapping to prevent duplicate enrollment
enrollmentSchema.index({ course: 1, student: 1 }, { unique: true });
enrollmentSchema.index({ student: 1 });
enrollmentSchema.index({ course: 1 });

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

export default Enrollment;

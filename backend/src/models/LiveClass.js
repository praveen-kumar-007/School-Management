import mongoose from 'mongoose';

const liveClassSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateTime: { type: Date, required: true, index: true },
    platform: { type: String, enum: ['Google Meet', 'Zoom', 'Microsoft Teams', 'Other'], default: 'Google Meet' },
    link: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['scheduled', 'live', 'completed', 'cancelled'], default: 'scheduled' }
  },
  { timestamps: true }
);

liveClassSchema.index({ teacher: 1, course: 1, dateTime: 1 });

const LiveClass = mongoose.model('LiveClass', liveClassSchema);

export default LiveClass;

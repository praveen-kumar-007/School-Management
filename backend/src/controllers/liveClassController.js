import LiveClass from '../models/LiveClass.js';
import Course from '../models/Course.js';
import { notifyUsers } from '../services/notificationService.js';

export const scheduleLiveClass = async (req, res) => {
  try {
    const { title, courseId, dateTime, platform = 'Google Meet', link, description = '' } = req.body;

    if (!title || !courseId || !dateTime || !link) {
      return res.status(400).json({ success: false, message: 'title, courseId, dateTime, and link are required' });
    }

    const course = await Course.findById(courseId).populate('students', '_id');
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    if (course.instructor.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const liveClass = new LiveClass({
      title: title.trim(),
      course: courseId,
      teacher: req.user.id,
      dateTime: new Date(dateTime),
      platform,
      link: link.trim(),
      description: description.trim()
    });

    await liveClass.save();

    const studentIds = (course.students || []).map((student) => student._id?.toString()).filter(Boolean);

    if (studentIds.length) {
      await notifyUsers({
        userIds: studentIds,
        type: 'live_class_scheduled',
        title: `Live class scheduled: ${title}`,
        message: `A new live class has been scheduled for ${course.title} at ${new Date(dateTime).toLocaleString()}.`,
        metadata: {
          liveClassId: liveClass._id?.toString(),
          courseId,
          teacherId: req.user.id,
          dateTime
        }
      });
    }

    res.status(201).json({ success: true, message: 'Live class scheduled', liveClass });
  } catch (error) {
    console.error('Schedule Live Class Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listLiveClasses = async (req, res) => {
  try {
    const { courseId, upcoming } = req.query;
    const filter = {};

    if (courseId) {
      filter.course = courseId;
    }

    if (upcoming === 'true') {
      filter.dateTime = { $gte: new Date() };
    }

    const classes = await LiveClass.find(filter)
      .populate('course', 'title')
      .populate('teacher', 'name email')
      .sort({ dateTime: 1 });

    res.status(200).json({ success: true, count: classes.length, liveClasses: classes });
  } catch (error) {
    console.error('List Live Classes Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
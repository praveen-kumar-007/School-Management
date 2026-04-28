import Attendance from '../models/Attendance.js';
import Course from '../models/Course.js';

export const markAttendance = async (req, res) => {
  try {
    const { courseId, studentId, status, remarks } = req.body;

    // Verify course exists and user is instructor
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    if (course.instructor.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Check if attendance already exists for today
    const existingAttendance = await Attendance.findOne({
      course: courseId,
      student: studentId,
      date: {
        $gte: new Date().setHours(0, 0, 0, 0),
        $lte: new Date().setHours(23, 59, 59, 999)
      }
    });

    if (existingAttendance) {
      existingAttendance.status = status;
      existingAttendance.remarks = remarks;
      await existingAttendance.save();
      return res.status(200).json({
        success: true,
        message: 'Attendance updated',
        attendance: existingAttendance
      });
    }

    const attendance = new Attendance({
      course: courseId,
      student: studentId,
      date: new Date(),
      status: status || 'absent',
      remarks
    });

    await attendance.save();

    res.status(201).json({
      success: true,
      message: 'Attendance marked',
      attendance
    });
  } catch (error) {
    console.error('Mark Attendance Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getAttendance = async (req, res) => {
  try {
    const { courseId, studentId } = req.query;

    let filter = {};
    if (courseId) filter.course = courseId;
    if (studentId) filter.student = studentId;

    const attendance = await Attendance.find(filter)
      .populate('course', 'title')
      .populate('student', 'name email')
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      count: attendance.length,
      attendance
    });
  } catch (error) {
    console.error('Get Attendance Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getStudentAttendance = async (req, res) => {
  try {
    const attendance = await Attendance.find({ student: req.user.id })
      .populate('course', 'title')
      .sort({ date: -1 });

    // Calculate attendance percentage
    const totalClasses = attendance.length;
    const presentClasses = attendance.filter(a => a.status === 'present').length;
    const attendancePercentage = totalClasses > 0 ? (presentClasses / totalClasses) * 100 : 0;

    res.status(200).json({
      success: true,
      totalClasses,
      presentClasses,
      attendancePercentage: Math.round(attendancePercentage),
      attendance
    });
  } catch (error) {
    console.error('Get Student Attendance Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getAttendanceSummary = async (req, res) => {
  try {
    const { courseId } = req.query;
    const filter = {};
    if (courseId) filter.course = courseId;

    const attendance = await Attendance.find(filter)
      .populate('course', 'title instructor')
      .populate('student', 'name email')
      .sort({ date: -1 });

    const byStudent = {};
    attendance.forEach((record) => {
      const sid = String(record.student._id);
      if (!byStudent[sid]) {
        byStudent[sid] = {
          studentId: sid,
          name: record.student.name,
          email: record.student.email,
          present: 0,
          absent: 0,
          total: 0,
          courseTitle: record.course?.title || 'Unknown'
        };
      }
      byStudent[sid].total += 1;
      if (record.status === 'present') byStudent[sid].present += 1;
      if (record.status === 'absent') byStudent[sid].absent += 1;
    });

    const studentSummaries = Object.values(byStudent).map((item) => ({
      ...item,
      attendancePct: item.total > 0 ? Math.round((item.present / item.total) * 100) : 0
    }));

    const lowAttendance = studentSummaries.filter((item) => item.attendancePct < 75);

    res.status(200).json({
      success: true,
      totalRecords: attendance.length,
      studentSummaries,
      lowAttendance
    });
  } catch (error) {
    console.error('Get Attendance Summary Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const exportAttendanceReport = async (req, res) => {
  try {
    const { courseId } = req.query;
    const filter = {};
    if (courseId) filter.course = courseId;

    const attendance = await Attendance.find(filter)
      .populate('course', 'title')
      .populate('student', 'name email')
      .sort({ date: -1 });

    const rows = attendance.map((record) => {
      return `${record.course.title || 'Unknown'},${record.student.name},${record.student.email},${record.status},${record.date.toISOString()},${record.remarks || ''}`;
    });

    const csv = ['Course,Student,Email,Status,Date,Remarks', ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Export Attendance Report Error:', error);
    res.status(500).json({ message: error.message });
  }
};

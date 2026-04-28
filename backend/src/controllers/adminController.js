import Course from '../models/Course.js';
import CourseProgress from '../models/CourseProgress.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Assignment from '../models/Assignment.js';
import AssignmentSubmission from '../models/AssignmentSubmission.js';
import AuditLog from '../models/AuditLog.js';
import cloudinary from '../config/cloudinary.js';
import ForumPost from '../models/ForumPost.js';
import { getRealtimeServer } from '../utils/realtime.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { getCache, setCache } from '../utils/cache.js';
import { validateUploadFile } from '../utils/uploadValidator.js';
import { notifyAdmins } from '../services/notificationService.js';
import { runDatabaseBackup, getBackupStatus, listBackups, restoreDatabaseBackup } from '../services/backupService.js';

const recentBroadcasts = [];

const safeNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const CONTENT_FILE_RULES = {
  pdf: {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['application/pdf']
  },
  video: {
    maxBytes: 200 * 1024 * 1024,
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska']
  },
  note: {
    maxBytes: 0,
    mimeTypes: []
  }
};

class ContentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentValidationError';
    this.statusCode = 400;
  }
}

const validateCourseContentFile = ({ file, materialType }) => {
  if (!file || materialType === 'note') {
    return;
  }

  const rule = CONTENT_FILE_RULES[materialType];
  if (!rule) {
    throw new ContentValidationError('Invalid material type');
  }

  const fileSize = safeNumber(file.size);
  if (fileSize <= 0) {
    throw new ContentValidationError('Uploaded file is empty');
  }

  if (rule.maxBytes && fileSize > rule.maxBytes) {
    const maxSizeMb = Math.round(rule.maxBytes / (1024 * 1024));
    throw new ContentValidationError(`${materialType.toUpperCase()} file size exceeds ${maxSizeMb}MB limit`);
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  if (!rule.mimeTypes.includes(mimeType)) {
    throw new ContentValidationError(`Unsupported ${materialType.toUpperCase()} file type`);
  }
};

const uploadCourseContentFile = async ({ file, courseId, materialType }) => {
  if (!file) {
    return {
      fileUrl: null,
      previewUrl: null,
      fileName: null,
      fileSize: 0,
      mimeType: null
    };
  }

  // Validate upload security and size
  const category = materialType === 'video' ? 'video' : materialType === 'pdf' ? 'pdf' : 'image';
  validateUploadFile(file, [category, 'docx']);

  validateCourseContentFile({ file, materialType });

  const resourceType = materialType === 'video' ? 'video' : 'raw';
  const uploaded = await cloudinary.uploader.upload(file.tempFilePath, {
    folder: `elearning/course-content/${courseId}`,
    resource_type: resourceType
  });

  return {
    fileUrl: uploaded.secure_url,
    previewUrl: uploaded.secure_url,
    fileName: file.name || uploaded.original_filename || null,
    fileSize: safeNumber(file.size),
    mimeType: file.mimetype || null
  };
};

const findFolderAndMaterial = (course, materialId) => {
  for (const folder of course.contentFolders || []) {
    for (const material of folder.materials || []) {
      if (material._id?.toString() === materialId) {
        return { folder, material };
      }
    }
  }

  return { folder: null, material: null };
};

const VALID_ANALYTICS_PERIODS = new Set(['daily', 'weekly', 'monthly']);

const getPeriodConfig = (period) => {
  if (period === 'daily') {
    return {
      points: 14,
      mongoFormat: '%Y-%m-%d',
      subtractUnit: 'day'
    };
  }

  if (period === 'weekly') {
    return {
      points: 12,
      mongoFormat: '%Y-%U',
      subtractUnit: 'week'
    };
  }

  return {
    points: 12,
    mongoFormat: '%Y-%m',
    subtractUnit: 'month'
  };
};

const addUnits = (date, amount, unit) => {
  const next = new Date(date);
  if (unit === 'day') {
    next.setDate(next.getDate() + amount);
    return next;
  }

  if (unit === 'week') {
    next.setDate(next.getDate() + amount * 7);
    return next;
  }

  next.setMonth(next.getMonth() + amount);
  return next;
};

const pad2 = (value) => String(value).padStart(2, '0');

const getWeekKey = (date) => {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayDiff = Math.floor((date - startOfYear) / (1000 * 60 * 60 * 24));
  const week = Math.floor((dayDiff + startOfYear.getDay()) / 7);
  return `${date.getFullYear()}-${pad2(week)}`;
};

const getBucketKey = (date, period) => {
  if (period === 'daily') {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  if (period === 'weekly') {
    return getWeekKey(date);
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
};

const getBucketLabel = (date, period) => {
  if (period === 'daily') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (period === 'weekly') {
    const end = addUnits(date, 6, 'day');
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const buildPeriodBuckets = (period, points, now = new Date()) => {
  const buckets = [];

  for (let index = points - 1; index >= 0; index -= 1) {
    const date = addUnits(now, -index, period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month');

    if (period === 'daily') {
      date.setHours(0, 0, 0, 0);
    }

    if (period === 'weekly') {
      const day = date.getDay();
      date.setDate(date.getDate() - day);
      date.setHours(0, 0, 0, 0);
    }

    if (period === 'monthly') {
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
    }

    buckets.push({
      key: getBucketKey(date, period),
      date,
      label: getBucketLabel(date, period)
    });
  }

  return buckets;
};

const buildSeriesMap = (rows, valueField = 'count') => {
  return rows.reduce((acc, row) => {
    acc[row._id] = safeNumber(row[valueField]);
    return acc;
  }, {});
};

const calculateGrowthPercentage = (previous, current) => {
  const prev = safeNumber(previous);
  const curr = safeNumber(current);

  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return 100;
  return Number((((curr - prev) / prev) * 100).toFixed(2));
};

const buildCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const headerLine = headers.join(',');
  const data = rows
    .map((row) =>
      headers
        .map((key) => {
          const raw = row[key] ?? '';
          const value = String(raw).replace(/"/g, '""');
          return /[",\n]/.test(value) ? `"${value}"` : value;
        })
        .join(',')
    )
    .join('\n');

  return `${headerLine}\n${data}`;
};

const buildSimplePdfBuffer = (title, rows) => {
  const lines = [title, '', ...rows.map((line) => String(line))];
  const escaped = lines
    .map((line) => line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'))
    .map((line, index) => `${index === 0 ? 'BT /F1 16 Tf 50 780 Td' : `0 -20 Td`} (${line}) Tj`)
    .join(' ');

  const streamContent = `${escaped} ET`;
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${streamContent.length} >> stream
${streamContent}
endstream endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000242 00000 n 
0000000312 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
${350 + streamContent.length}
%%EOF`;

  return Buffer.from(pdf);
};

export const listUsers = async (req, res) => {
  try {
    const {
      search,
      role,
      status,
      page = 1,
      limit = 10
    } = req.query;

    const numericPage = Math.max(parseInt(page, 10) || 1, 1);
    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (numericPage - 1) * numericLimit;

    const filter = {};

    if (role) filter.role = role;
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .select('-password -__v')
      .skip(skip)
      .limit(numericLimit)
      .lean();

    const total = await User.countDocuments(filter);

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        page: numericPage,
        limit: numericLimit,
        total
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Admin backup endpoints
export const createBackup = async (req, res) => {
  try {
    const { targetCollections = [] } = req.body;

    if (targetCollections && !Array.isArray(targetCollections)) {
      return res.status(400).json({ message: 'targetCollections must be an array' });
    }

    const backup = await runDatabaseBackup({ targetCollections });

    return res.status(200).json({
      success: true,
      message: 'Backup created',
      backup
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create backup'
    });
  }
};

export const backupStatus = (req, res) => {
  const status = getBackupStatus();
  return res.status(200).json({
    success: true,
    status
  });
};

export const listBackupFiles = async (req, res) => {
  try {
    const backups = await listBackups();
    res.status(200).json({ success: true, backups });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const restoreBackup = async (req, res) => {
  try {
    const { filePath, encryptionKey } = req.body;

    if (!filePath) {
      return res.status(400).json({ success: false, message: 'filePath is required' });
    }

    const result = await restoreDatabaseBackup({ filePath, encryptionKey });
    await logAuditEvent(req, {
      action: 'admin.database.restore',
      targetType: 'backup',
      targetId: filePath,
      metadata: { filePath }
    });

    res.status(200).json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const [recentActivity, activityCount] = await Promise.all([
      AuditLog.find({ actor: user._id })
        .sort({ createdAt: -1 })
        .limit(12)
        .select('action targetType targetId metadata createdAt'),
      AuditLog.countDocuments({ actor: user._id })
    ]);

    res.status(200).json({
      success: true,
      profile: {
        ...user.toObject(),
        enrolledCoursesCount: user.enrolledCourses?.length || 0,
        createdCoursesCount: user.createdCourses?.length || 0,
        activityCount
      },
      recentActivity
    });
  } catch (error) {
    console.error('Get User Profile Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const { name, email, password, role = 'student', isActive = true } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const created = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role,
      isActive
    });

    await logAuditEvent(req, {
      action: 'admin.user.create',
      targetType: 'user',
      targetId: created._id?.toString(),
      metadata: { email: created.email, role: created.role }
    });

    const safeUser = await User.findById(created._id).select('-password');
    res.status(201).json({ success: true, user: safeUser });
  } catch (error) {
    console.error('Create User Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, isActive } = req.body;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = !!isActive;

    await user.save();

    await logAuditEvent(req, {
      action: 'admin.user.update',
      targetType: 'user',
      targetId: user._id?.toString(),
      metadata: { role: user.role, isActive: user.isActive }
    });

    const safeUser = await User.findById(id).select('-password');
    res.status(200).json({ success: true, user: safeUser });
  } catch (error) {
    console.error('Update User Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await logAuditEvent(req, {
      action: 'admin.user.delete',
      targetType: 'user',
      targetId: id,
      metadata: { deletedEmail: user.email, deletedRole: user.role }
    });

    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listTeachers = async (_req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher', isActive: true }).select('name email role').sort({ name: 1 });
    res.status(200).json({ success: true, teachers });
  } catch (error) {
    console.error('List Teachers Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCoursesManagement = async (_req, res) => {
  try {
    const [courses, assignments] = await Promise.all([
      Course.find().populate('instructor', 'name email role').populate('students', 'name email role').sort({ createdAt: -1 }),
      Assignment.find().select('course submissions')
    ]);

    const courseIds = courses.map((course) => course._id).filter(Boolean);
    const courseProgressRows = courseIds.length
      ? await CourseProgress.aggregate([
        { $match: { course: { $in: courseIds } } },
        {
          $group: {
            _id: '$course',
            trackedStudents: { $sum: 1 },
            completedStudents: {
              $sum: {
                $cond: [{ $gte: ['$progressPercent', 100] }, 1, 0]
              }
            },
            avgProgressPercent: { $avg: '$progressPercent' }
          }
        }
      ])
      : [];

    const progressMap = courseProgressRows.reduce((acc, item) => {
      acc[item._id?.toString()] = {
        trackedStudents: item.trackedStudents || 0,
        completedStudents: item.completedStudents || 0,
        avgProgressPercent: Math.round(item.avgProgressPercent || 0)
      };
      return acc;
    }, {});

    const totalEnrollmentsAcrossCourses = courses.reduce((sum, course) => sum + (course.students?.length || 0), 0);

    const assignmentMap = assignments.reduce((acc, item) => {
      const key = item.course?.toString();
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = { assignmentCount: 0, reviewedSubmissions: 0 };
      }
      acc[key].assignmentCount += 1;
      acc[key].reviewedSubmissions += (item.submissions || []).filter((s) => s.isReviewed).length;
      return acc;
    }, {});

    const payload = courses.map((course) => {
      const stats = assignmentMap[course._id.toString()] || { assignmentCount: 0, reviewedSubmissions: 0 };
      const progressStats = progressMap[course._id.toString()] || {
        trackedStudents: 0,
        completedStudents: 0,
        avgProgressPercent: 0
      };
      const possibleReviews = Math.max((course.students?.length || 0) * stats.assignmentCount, 1);
      const progress = Math.round((stats.reviewedSubmissions / possibleReviews) * 100);

      const enrollmentCount = course.students?.length || 0;
      const completionRate = enrollmentCount > 0
        ? Math.round((progressStats.completedStudents / enrollmentCount) * 100)
        : 0;

      const feedbackRating = (course.reviews?.length || 0) > 0
        ? Number((course.reviews.reduce((sum, review) => sum + safeNumber(review.rating), 0) / course.reviews.length).toFixed(2))
        : Number(safeNumber(course.rating).toFixed(2));

      const revenueGenerated = Number((safeNumber(course.price) * enrollmentCount).toFixed(2));
      const popularityScore = totalEnrollmentsAcrossCourses > 0
        ? Number(((enrollmentCount / totalEnrollmentsAcrossCourses) * 100).toFixed(2))
        : 0;

      return {
        _id: course._id,
        title: course.title,
        price: course.price || 0,
        category: course.category,
        level: course.level,
        isPublished: course.isPublished,
        instructor: course.instructor,
        enrollmentCount,
        progress: Math.max(0, Math.min(100, progress)),
        completionRate,
        feedbackRating,
        feedbackCount: course.reviews?.length || 0,
        revenueGenerated,
        popularityScore,
        trackedStudents: progressStats.trackedStudents,
        completedStudents: progressStats.completedStudents,
        avgProgressPercent: progressStats.avgProgressPercent,
        createdAt: course.createdAt
      };
    });

    res.status(200).json({ success: true, courses: payload });
  } catch (error) {
    console.error('Get Courses Management Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createCourseByAdmin = async (req, res) => {
  try {
    const { title, description, instructorId, category, level, duration, price } = req.body;
    if (!title || !description || !instructorId) {
      return res.status(400).json({ success: false, message: 'Title, description, and instructorId are required' });
    }

    const teacher = await User.findOne({ _id: instructorId, role: 'teacher' });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const created = await Course.create({
      title,
      description,
      instructor: instructorId,
      category: category || 'other',
      level: level || 'beginner',
      duration: duration || '0 weeks',
      price: safeNumber(price),
      isPublished: false
    });

    await logAuditEvent(req, {
      action: 'admin.course.create',
      targetType: 'course',
      targetId: created._id?.toString(),
      metadata: { title, instructorId }
    });

    const course = await Course.findById(created._id).populate('instructor', 'name email');
    res.status(201).json({ success: true, course });
  } catch (error) {
    console.error('Create Course By Admin Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourseByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      category,
      level,
      duration,
      price,
      isPublished,
      instructorId
    } = req.body;

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    if (instructorId) {
      const teacher = await User.findOne({ _id: instructorId, role: 'teacher' });
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }
      course.instructor = teacher._id;
    }

    if (title !== undefined) course.title = title;
    if (description !== undefined) course.description = description;
    if (category !== undefined) course.category = category;
    if (level !== undefined) course.level = level;
    if (duration !== undefined) course.duration = duration;
    if (price !== undefined) course.price = safeNumber(price);
    if (isPublished !== undefined) course.isPublished = !!isPublished;

    await course.save();

    await logAuditEvent(req, {
      action: 'admin.course.update',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        title: course.title,
        isPublished: course.isPublished
      }
    });

    const updated = await Course.findById(id).populate('instructor', 'name email role');
    res.status(200).json({ success: true, course: updated });
  } catch (error) {
    console.error('Update Course By Admin Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCourseByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findByIdAndDelete(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    await Promise.all([
      User.updateMany({ enrolledCourses: id }, { $pull: { enrolledCourses: id } }),
      User.updateMany({ createdCourses: id }, { $pull: { createdCourses: id } })
    ]);

    await logAuditEvent(req, {
      action: 'admin.course.delete',
      targetType: 'course',
      targetId: id,
      metadata: {
        title: course.title
      }
    });

    res.status(200).json({ success: true, message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Delete Course By Admin Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const assignCourseTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const { instructorId } = req.body;

    const [course, teacher] = await Promise.all([
      Course.findById(id),
      User.findOne({ _id: instructorId, role: 'teacher' })
    ]);

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    course.instructor = teacher._id;
    await course.save();

    await logAuditEvent(req, {
      action: 'admin.course.assign',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: { instructorId: teacher._id?.toString() }
    });

    const updated = await Course.findById(id).populate('instructor', 'name email');
    res.status(200).json({ success: true, course: updated });
  } catch (error) {
    console.error('Assign Course Teacher Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseEnrollments = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const course = await Course.findById(req.params.id)
      .populate('instructor', 'name email')
      .select('title students instructor')
      .lean();

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const totalStudents = (course.students || []).length;
    const pagedStudentIds = (course.students || []).slice(skip, skip + limit);

    const students = await User.find({ _id: { $in: pagedStudentIds } })
      .select('name email role')
      .lean();

    const attendanceStats = await Attendance.aggregate([
      { $match: { course: course._id, student: { $in: pagedStudentIds } } },
      {
        $group: {
          _id: '$student',
          total: { $sum: 1 },
          presentCount: {
            $sum: {
              $cond: [
                { $in: ['$status', ['present', 'late']] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const progressByStudent = (attendanceStats || []).reduce((acc, item) => {
      const sid = item._id.toString();
      acc[sid] = item.total > 0 ? Math.round((item.presentCount / item.total) * 100) : 0;
      return acc;
    }, {});

    const studentsWithProgress = students.map((student) => ({
      _id: student._id,
      name: student.name,
      email: student.email,
      role: student.role,
      progress: progressByStudent[student._id.toString()] || 0
    }));

    res.status(200).json({
      success: true,
      page,
      limit,
      totalStudents,
      totalPages: Math.max(1, Math.ceil(totalStudents / limit)),
      course: {
        _id: course._id,
        title: course.title,
        instructor: course.instructor,
        students: studentsWithProgress
      }
    });
  } catch (error) {
    console.error('Get Course Enrollments Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseContentFolders = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findById(id).select('title contentFolders');
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const folders = [...(course.contentFolders || [])]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

    res.status(200).json({
      success: true,
      course: {
        _id: course._id,
        title: course.title
      },
      folders
    });
  } catch (error) {
    console.error('Get Course Content Folders Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createCourseContentFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description = '' } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Folder name is required' });
    }

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    course.contentFolders = course.contentFolders || [];
    course.contentFolders.push({
      name: name.trim(),
      description: description?.trim() || '',
      createdBy: req.user.id,
      materials: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await course.save();

    const createdFolder = course.contentFolders[course.contentFolders.length - 1];

    await logAuditEvent(req, {
      action: 'admin.course.content.folder.create',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        folderId: createdFolder._id?.toString(),
        folderName: createdFolder.name
      }
    });

    res.status(201).json({ success: true, folder: createdFolder });
  } catch (error) {
    console.error('Create Course Content Folder Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadCourseContentMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      folderId,
      type,
      title,
      description = '',
      notesText = '',
      changeNote = 'Initial upload'
    } = req.body;

    if (!folderId || !type || !title) {
      return res.status(400).json({ success: false, message: 'folderId, type, and title are required' });
    }

    if (!['pdf', 'video', 'note'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid material type' });
    }

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const folder = (course.contentFolders || []).find((item) => item._id?.toString() === folderId);
    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }

    const uploadFile = req.files?.material;
    if (type !== 'note' && !uploadFile) {
      return res.status(400).json({ success: false, message: 'File is required for PDF and video materials' });
    }

    const uploadedMeta = await uploadCourseContentFile({
      file: uploadFile,
      courseId: course._id?.toString(),
      materialType: type
    });

    const firstVersion = {
      versionNumber: 1,
      fileUrl: uploadedMeta.fileUrl,
      previewUrl: uploadedMeta.previewUrl,
      notesText: notesText || '',
      fileName: uploadedMeta.fileName,
      fileSize: uploadedMeta.fileSize,
      mimeType: uploadedMeta.mimeType,
      changeNote: changeNote || 'Initial upload',
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    };

    folder.materials.push({
      type,
      title: title.trim(),
      description: description?.trim() || '',
      fileName: uploadedMeta.fileName,
      fileSize: uploadedMeta.fileSize,
      mimeType: uploadedMeta.mimeType,
      latestFileUrl: uploadedMeta.fileUrl,
      latestPreviewUrl: uploadedMeta.previewUrl,
      latestNotesText: notesText || '',
      currentVersion: 1,
      versions: [firstVersion],
      createdBy: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    folder.updatedAt = new Date();
    await course.save();

    const createdMaterial = folder.materials[folder.materials.length - 1];

    const studentIds = (course.students || []).map((student) => student._id?.toString()).filter(Boolean);

    if (studentIds.length) {
      await notifyUsers({
        userIds: studentIds,
        type: 'material_uploaded',
        title: `New material uploaded: ${createdMaterial.title}`,
        message: `A new ${type} has been uploaded to ${course.title}.`,
        metadata: {
          courseId: course._id?.toString(),
          folderId,
          materialId: createdMaterial._id?.toString(),
          materialType: type
        },
        sendEmail: true
      });
    }

    await logAuditEvent(req, {
      action: 'admin.course.content.material.upload',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        folderId,
        materialId: createdMaterial._id?.toString(),
        materialType: type,
        title: createdMaterial.title
      }
    });

    res.status(201).json({ success: true, material: createdMaterial, folderId });
  } catch (error) {
    console.error('Upload Course Content Material Error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const addCourseContentMaterialVersion = async (req, res) => {
  try {
    const { id, materialId } = req.params;
    const { notesText = '', changeNote = 'Updated content' } = req.body;

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const { folder, material } = findFolderAndMaterial(course, materialId);
    if (!folder || !material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const uploadFile = req.files?.material;
    if (material.type !== 'note' && !uploadFile) {
      return res.status(400).json({ success: false, message: 'File is required to upload a new version for this material' });
    }

    const uploadedMeta = await uploadCourseContentFile({
      file: uploadFile,
      courseId: course._id?.toString(),
      materialType: material.type
    });

    const nextVersion = (material.currentVersion || material.versions?.length || 0) + 1;
    const versionPayload = {
      versionNumber: nextVersion,
      fileUrl: uploadedMeta.fileUrl || material.latestFileUrl,
      previewUrl: uploadedMeta.previewUrl || material.latestPreviewUrl,
      notesText: notesText || material.latestNotesText || '',
      fileName: uploadedMeta.fileName || material.fileName,
      fileSize: uploadedMeta.fileSize || material.fileSize || 0,
      mimeType: uploadedMeta.mimeType || material.mimeType,
      changeNote: changeNote || 'Updated content',
      uploadedBy: req.user.id,
      uploadedAt: new Date()
    };

    material.versions.push(versionPayload);
    material.currentVersion = nextVersion;
    material.latestFileUrl = versionPayload.fileUrl;
    material.latestPreviewUrl = versionPayload.previewUrl;
    material.latestNotesText = versionPayload.notesText;
    material.fileName = versionPayload.fileName;
    material.fileSize = versionPayload.fileSize;
    material.mimeType = versionPayload.mimeType;
    material.updatedAt = new Date();

    folder.updatedAt = new Date();
    await course.save();

    await logAuditEvent(req, {
      action: 'admin.course.content.material.version.add',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        materialId: material._id?.toString(),
        version: nextVersion,
        changeNote
      }
    });

    res.status(200).json({ success: true, material, folderId: folder._id?.toString() });
  } catch (error) {
    console.error('Add Course Content Material Version Error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getModerationData = async (_req, res) => {
  try {
    const [pendingCourses, forumPosts] = await Promise.all([
      Course.find({ isPublished: false }).populate('instructor', 'name email').sort({ createdAt: -1 }).limit(100),
      ForumPost.find()
        .populate('student', 'name email')
        .populate('course', 'title')
        .populate('replies.student', 'name email')
        .sort({ createdAt: -1 })
        .limit(150)
    ]);

    res.status(200).json({
      success: true,
      pendingCourses,
      forumPosts
    });
  } catch (error) {
    console.error('Get Moderation Data Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const approveCourse = async (req, res) => {
  try {
    const { approved = true } = req.body;
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    course.isPublished = !!approved;
    await course.save();

    await logAuditEvent(req, {
      action: 'admin.course.approval',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: { isPublished: course.isPublished }
    });

    res.status(200).json({ success: true, course });
  } catch (error) {
    console.error('Approve Course Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const removeForumPost = async (req, res) => {
  try {
    const deleted = await ForumPost.deleteOne({ _id: req.params.id });
    if (!deleted.deletedCount) {
      return res.status(404).json({ success: false, message: 'Forum post not found' });
    }

    await logAuditEvent(req, {
      action: 'admin.forum.delete',
      targetType: 'forum_post',
      targetId: req.params.id
    });

    res.status(200).json({ success: true, message: 'Forum post removed' });
  } catch (error) {
    console.error('Remove Forum Post Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getOverview = async (_req, res) => {
  try {
    const cacheKey = 'admin:overview';
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalCourses,
      activeUsers,
      recentActivity,
      weeklyActions
    ] = await Promise.all([
      User.countDocuments(),
      Course.countDocuments(),
      User.countDocuments({ lastLogin: { $gte: sevenDaysAgo } }),
      AuditLog.find().populate('actor', 'name email role').sort({ createdAt: -1 }).limit(10),
      AuditLog.countDocuments({ createdAt: { $gte: sevenDaysAgo } })
    ]);

    const response = {
      success: true,
      summary: {
        totalUsers,
        totalCourses,
        revenue: null,
        activityScore: weeklyActions,
        activeUsers
      },
      recentActivity
    };

    await setCache(cacheKey, response, 30); // 30 seconds cache

    res.status(200).json(response);
  } catch (error) {
    console.error('Get Overview Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAnalytics = async (req, res) => {
  try {
    const requestedPeriod = (req.query.period || 'monthly').toString().toLowerCase();
    const period = VALID_ANALYTICS_PERIODS.has(requestedPeriod) ? requestedPeriod : 'monthly';
    const section = (req.query.section || 'all').toString().toLowerCase();
    const allowedSections = new Set(['all', 'summary', 'engagement', 'payments', 'performance']);

    if (!allowedSections.has(section)) {
      return res.status(400).json({ success: false, message: 'Invalid section parameter' });
    }

    const cacheKey = `admin:analytics:${period}:${section}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const isFullRefresh = section === 'all';
    const needsPerformance = section === 'all' || section === 'performance';
    const needsEngagement = section === 'all' || section === 'engagement';
    const needsPayments = section === 'all' || section === 'payments';
    const needsSummary = section === 'all' || section === 'summary';

    const periodConfig = getPeriodConfig(period);

    const now = new Date();
    const activeWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const periodBuckets = buildPeriodBuckets(period, periodConfig.points, now);
    const periodStartDate = periodBuckets[0]?.date || activeWindowStart;

    const monthlyBuckets = buildPeriodBuckets('monthly', 12, now);
    const monthlyStartDate = monthlyBuckets[0]?.date || new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const planBuckets = [
      { key: 'free', label: 'Free Plan', min: 0, max: 0 },
      { key: 'starter', label: 'Starter Plan', min: 0.01, max: 999 },
      { key: 'pro', label: 'Pro Plan', min: 1000, max: 4999 },
      { key: 'enterprise', label: 'Enterprise Plan', min: 5000, max: Number.MAX_SAFE_INTEGER }
    ];

    const baseTasks = [
      User.countDocuments(),
      User.countDocuments({ lastLogin: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ role: 'student', lastLogin: { $gte: activeWindowStart } }),
      User.countDocuments({ role: 'teacher' }),
      User.countDocuments({ role: 'student' }),
      Course.countDocuments(),
      Course.aggregate([{ $project: { count: { $size: '$students' } } }, { $group: { _id: null, total: { $sum: '$count' } } }]),
      Course.aggregate([
        {
          $project: {
            revenue: {
              $multiply: [
                { $ifNull: ['$price', 0] },
                { $size: { $ifNull: ['$students', []] } }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$revenue' }
          }
        }
      ]),
      Assignment.countDocuments(),
      ForumPost.countDocuments(),
      ForumPost.aggregate([
        { $project: { repliesCount: { $size: { $ifNull: ['$replies', []] } } } },
        { $group: { _id: null, total: { $sum: '$repliesCount' } } }
      ]),
      User.find().select('name role createdAt').sort({ createdAt: -1 }).limit(7),
      Course.find().select('title createdAt').sort({ createdAt: -1 }).limit(7),
      Course.aggregate([
        {
          $project: {
            title: 1,
            price: { $ifNull: ['$price', 0] },
            enrollmentCount: { $size: { $ifNull: ['$students', []] } },
            revenue: {
              $multiply: [
                { $ifNull: ['$price', 0] },
                { $size: { $ifNull: ['$students', []] } }
              ]
            }
          }
        }
      ]),
      AuditLog.find({ action: 'course.enroll' })
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 })
        .limit(15),
      AuditLog.find({ action: 'course.enroll', createdAt: { $gte: periodStartDate } })
        .select('createdAt targetId metadata')
        .sort({ createdAt: 1 })
        .lean(),
      User.aggregate([
        { $match: { createdAt: { $gte: periodStartDate } } },
        { $group: { _id: { $dateToString: { format: periodConfig.mongoFormat, date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      User.aggregate([
        { $match: { role: 'student', lastLogin: { $ne: null, $gte: periodStartDate } } },
        { $group: { _id: { $dateToString: { format: periodConfig.mongoFormat, date: '$lastLogin' } }, count: { $sum: 1 } } }
      ]),
      Course.aggregate([
        { $match: { createdAt: { $gte: periodStartDate } } },
        {
          $group: {
            _id: { $dateToString: { format: periodConfig.mongoFormat, date: '$createdAt' } },
            enrollments: { $sum: { $size: { $ifNull: ['$students', []] } } }
          }
        }
      ]),
      Course.aggregate([
        { $match: { createdAt: { $gte: periodStartDate } } },
        {
          $group: {
            _id: { $dateToString: { format: periodConfig.mongoFormat, date: '$createdAt' } },
            revenue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$price', 0] },
                  { $size: { $ifNull: ['$students', []] } }
                ]
              }
            }
          }
        }
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: monthlyStartDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }
      ]),
      Course.aggregate([
        { $match: { createdAt: { $gte: monthlyStartDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            enrollments: { $sum: { $size: { $ifNull: ['$students', []] } } }
          }
        }
      ]),
      Course.aggregate([
        { $match: { createdAt: { $gte: monthlyStartDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            revenue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$price', 0] },
                  { $size: { $ifNull: ['$students', []] } }
                ]
              }
            }
          }
        }
      ])
    ];

    const performanceTasks = needsPerformance
      ? [
          Attendance.aggregate([
            {
              $group: {
                _id: '$student',
                total: { $sum: 1 },
                present: {
                  $sum: {
                    $cond: [
                      { $in: ['$status', ['present', 'late']] },
                      1,
                      0
                    ]
                  }
                }
              }
            }
          ]),
          AssignmentSubmission.aggregate([
            {
              $group: {
                _id: '$student',
                totalSubmissions: { $sum: 1 },
                submitted: {
                  $sum: {
                    $cond: [{ $ifNull: ['$submittedAt', false] }, 1, 0]
                  }
                },
                totalScore: { $sum: { $ifNull: ['$marks', 0] } }
              }
            }
          ]),
          CourseProgress.aggregate([
            {
              $group: {
                _id: '$student',
                progressSum: { $sum: { $ifNull: ['$progressPercent', 0] } },
                courses: { $sum: 1 }
              }
            }
          ]),
          User.find({ role: 'student' })
            .select('name email')
            .sort({ lastLogin: -1, createdAt: -1 })
            .limit(500)
            .lean()
        ]
      : [Promise.resolve([]), Promise.resolve([]), Promise.resolve([]), Promise.resolve([])];

    const results = await Promise.all([...baseTasks, ...performanceTasks]);

    const [
      totalUsers,
      activeUsers,
      activeStudents,
      totalTeachers,
      totalStudents,
      totalCourses,
      totalEnrollments,
      totalRevenue,
      totalAssignments,
      forumPostsCount,
      forumRepliesCountRows,
      recentUsers,
      recentCourses,
      courseRevenueRows,
      recentEnrollmentLogs,
      periodEnrollmentLogs,
      usersSeries,
      activeStudentsSeries,
      enrollmentsSeries,
      revenueSeries,
      monthlyUsersSeries,
      monthlyEnrollmentsSeries,
      monthlyRevenueSeries,
      studentAttendanceRecords,
      studentAssignments,
      courseProgressRecords,
      studentsList
    ] = results;

    const forumRepliesCount = safeNumber(forumRepliesCountRows[0]?.total || 0);


    const usersSeriesMap = buildSeriesMap(usersSeries, 'count');
    const activeStudentsSeriesMap = buildSeriesMap(activeStudentsSeries, 'count');
    const enrollmentsSeriesMap = buildSeriesMap(enrollmentsSeries, 'enrollments');
    const revenueSeriesMap = buildSeriesMap(revenueSeries, 'revenue');

    const courseRevenueMap = (courseRevenueRows || []).reduce((acc, course) => {
      acc[course._id?.toString()] = {
        title: course.title,
        price: safeNumber(course.price),
        enrollmentCount: safeNumber(course.enrollmentCount),
        revenue: safeNumber(course.revenue)
      };
      return acc;
    }, {});

    const timeSeries = periodBuckets.map((bucket) => ({
      label: bucket.label,
      users: usersSeriesMap[bucket.key] || 0,
      activeStudents: activeStudentsSeriesMap[bucket.key] || 0,
      enrollments: enrollmentsSeriesMap[bucket.key] || 0,
      revenue: Number((revenueSeriesMap[bucket.key] || 0).toFixed?.(2) || revenueSeriesMap[bucket.key] || 0)
    }));

    const monthlyUsersSeriesMap = buildSeriesMap(monthlyUsersSeries, 'count');
    const monthlyEnrollmentsSeriesMap = buildSeriesMap(monthlyEnrollmentsSeries, 'enrollments');
    const monthlyRevenueSeriesMap = buildSeriesMap(monthlyRevenueSeries, 'revenue');

    const monthlyGrowth = monthlyBuckets.map((bucket) => ({
      label: bucket.label,
      users: monthlyUsersSeriesMap[bucket.key] || 0,
      enrollments: monthlyEnrollmentsSeriesMap[bucket.key] || 0,
      revenue: Number((monthlyRevenueSeriesMap[bucket.key] || 0).toFixed?.(2) || monthlyRevenueSeriesMap[bucket.key] || 0)
    }));

    const currentPoint = timeSeries[timeSeries.length - 1] || { users: 0, enrollments: 0, revenue: 0 };
    const previousPoint = timeSeries[timeSeries.length - 2] || { users: 0, enrollments: 0, revenue: 0 };

    const resolvedTotalEnrollments = safeNumber(totalEnrollments[0]?.total || 0);
    const resolvedTotalRevenue = safeNumber(totalRevenue[0]?.total || 0);
    const averageRevenuePerEnrollment = resolvedTotalEnrollments
      ? Number((resolvedTotalRevenue / resolvedTotalEnrollments).toFixed(2))
      : 0;

    const recentTransactions = (recentEnrollmentLogs || []).map((log) => {
      const courseId = log.targetId || log.metadata?.courseId;
      const courseMeta = courseRevenueMap[courseId] || {};
      const amount = safeNumber(courseMeta.price || 0);
      return {
        id: log._id?.toString(),
        transactionId: `TXN-${String(log._id || '').slice(-8).toUpperCase()}`,
        action: log.action,
        user: {
          id: log.actor?._id?.toString() || null,
          name: log.actor?.name || log.actor?.email || 'Unknown User',
          email: log.actor?.email || null,
          role: log.actorRole || log.actor?.role || null
        },
        courseId,
        courseTitle: courseMeta.title || 'Unknown Course',
        amount,
        status: 'completed',
        timestamp: log.createdAt
      };
    });

    const subscriptionPlans = planBuckets.map((plan) => {
      const coursesInPlan = (courseRevenueRows || []).filter((course) => {
        const price = safeNumber(course.price);
        return price >= plan.min && price <= plan.max;
      });

      const subscribers = coursesInPlan.reduce((sum, course) => sum + safeNumber(course.enrollmentCount), 0);
      const earnings = coursesInPlan.reduce((sum, course) => sum + safeNumber(course.revenue), 0);

      return {
        key: plan.key,
        name: plan.label,
        priceRange: plan.max >= Number.MAX_SAFE_INTEGER
          ? `₹${plan.min.toLocaleString('en-IN')}+`
          : plan.key === 'free'
            ? '₹0'
            : `₹${plan.min.toLocaleString('en-IN')} - ₹${plan.max.toLocaleString('en-IN')}`,
        courses: coursesInPlan.length,
        subscribers,
        earnings: Number(earnings.toFixed(2))
      };
    });

    const paymentTrendMap = periodBuckets.reduce((acc, bucket) => {
      acc[bucket.key] = {
        label: bucket.label,
        transactions: 0,
        revenue: 0,
        paidTransactions: 0,
        freeTransactions: 0
      };
      return acc;
    }, {});

    (periodEnrollmentLogs || []).forEach((log) => {
      const logDate = new Date(log.createdAt);
      const key = getBucketKey(logDate, period);
      const courseId = log.targetId || log.metadata?.courseId;
      const coursePrice = safeNumber(courseRevenueMap[courseId]?.price || 0);
      const bucket = paymentTrendMap[key];
      if (!bucket) return;

      bucket.transactions += 1;
      bucket.revenue += coursePrice;
      if (coursePrice > 0) {
        bucket.paidTransactions += 1;
      } else {
        bucket.freeTransactions += 1;
      }
    });

    const paymentTrend = periodBuckets.map((bucket) => {
      const row = paymentTrendMap[bucket.key];
      return {
        label: row.label,
        transactions: row.transactions,
        revenue: Number(row.revenue.toFixed(2)),
        paidTransactions: row.paidTransactions,
        freeTransactions: row.freeTransactions
      };
    });

    const paidEnrollments = paymentTrend.reduce((sum, item) => sum + item.paidTransactions, 0);
    const freeEnrollments = paymentTrend.reduce((sum, item) => sum + item.freeTransactions, 0);
    const totalTransactions = paidEnrollments + freeEnrollments;

    // Student Performance Predictor
    const attendanceByStudent = {};
    (studentAttendanceRecords || []).forEach((record) => {
      const studentId = String(record.student);
      if (!attendanceByStudent[studentId]) {
        attendanceByStudent[studentId] = { present: 0, total: 0 };
      }
      attendanceByStudent[studentId].total += 1;
      if (record.status === 'present') attendanceByStudent[studentId].present += 1;
    });

    const assignmentsByStudent = {};
    (studentAssignments || []).forEach((submission) => {
      const studentId = String(submission._id);
      assignmentsByStudent[studentId] = {
        totalScore: Number(submission.totalScore || 0),
        count: Number(submission.totalSubmissions || 0),
        submitted: Number(submission.submitted || 0)
      };
    });

    const progressByStudent = {};
    (courseProgressRecords || []).forEach((progress) => {
      const studentId = String(progress.student);
      if (!progressByStudent[studentId]) {
        progressByStudent[studentId] = { progressSum: 0, courses: 0 };
      }
      progressByStudent[studentId].progressSum += Number(progress.progressPercent || 0);
      progressByStudent[studentId].courses += 1;
    });

    const studentPerformancePrediction = (studentsList || []).map((student) => {
      const studentId = String(student._id);
      const attendance = attendanceByStudent[studentId];
      const attendancePct = attendance?.total ? Math.round((attendance.present / attendance.total) * 100) : 0;
      const assignment = assignmentsByStudent[studentId];
      const avgAssignmentScore = assignment?.count ? Math.round(assignment.totalScore / assignment.count) : 0;
      const progress = progressByStudent[studentId] ? Math.round(progressByStudent[studentId].progressSum / Math.max(1, progressByStudent[studentId].courses)) : 0;
      const engagementScore = Math.round((attendancePct * 0.35) + (avgAssignmentScore * 0.45) + (progress * 0.2));

      let tier = 'needs extra support';
      if (engagementScore >= 85 && attendancePct >= 90 && avgAssignmentScore >= 80) {
        tier = 'high-performing';
      } else if (engagementScore <= 55 || attendancePct <= 60 || avgAssignmentScore <= 55) {
        tier = 'at-risk';
      }

      return {
        studentId,
        name: student.name || 'Unknown',
        email: student.email || '',
        attendancePct,
        avgAssignmentScore,
        progress,
        engagementScore,
        tier
      };
    });

    const atRiskStudents = studentPerformancePrediction.filter((item) => item.tier === 'at-risk').slice(0, 8);
    const highPerformingStudents = studentPerformancePrediction.filter((item) => item.tier === 'high-performing').slice(0, 8);
    const needsSupportStudents = studentPerformancePrediction.filter((item) => item.tier === 'needs extra support').slice(0, 8);

    const studentPredictionSummary = {
      totalStudents: studentPerformancePrediction.length,
      atRisk: atRiskStudents.length,
      highPerformers: highPerformingStudents.length,
      needsSupport: needsSupportStudents.length,
      atRiskStudents,
      highPerformingStudents,
      needsSupportStudents,
      predictionTrend: (timeSeries || []).map((point) => ({
        label: point.label || 'N/A',
        atRisk: Math.min(atRiskStudents.length, 10),
        highPerforming: Math.min(highPerformingStudents.length, 10),
        needsSupport: Math.min(needsSupportStudents.length, 10)
      }))
    };

    const analyticsResponse = {
      success: true,
      analytics: {
        period,
        totalUsers,
        activeUsers,
        activeStudents,
        totalTeachers,
        totalStudents,
        totalCourses,
        totalEnrollments: resolvedTotalEnrollments,
        totalAssignments,
        totalRevenue: resolvedTotalRevenue,
        revenue: resolvedTotalRevenue,
        revenueStats: {
          totalRevenue: resolvedTotalRevenue,
          averageRevenuePerEnrollment
        },
        totalEarnings: resolvedTotalRevenue,
        growthStats: {
          usersGrowthPct: calculateGrowthPercentage(previousPoint.users, currentPoint.users),
          enrollmentsGrowthPct: calculateGrowthPercentage(previousPoint.enrollments, currentPoint.enrollments),
          revenueGrowthPct: calculateGrowthPercentage(previousPoint.revenue, currentPoint.revenue)
        },
        timeSeries,
        monthlyGrowth,
        engagementRate: totalUsers ? Math.round(((forumPostsCount + forumRepliesCount) / totalUsers) * 100) : 0,
        forumPosts: forumPostsCount,
        forumReplies: forumRepliesCount,
        recentUsers,
        recentCourses,
        recentTransactions,
        subscriptionPlans,
        paymentAnalytics: {
          paidEnrollments,
          freeEnrollments,
          totalTransactions,
          paidConversionRate: totalTransactions ? Number(((paidEnrollments / totalTransactions) * 100).toFixed(2)) : 0,
          paymentTrend,
          planRevenueDistribution: subscriptionPlans.map((plan) => ({
            name: plan.name,
            earnings: plan.earnings,
            subscribers: plan.subscribers
          }))
        }
      }
    };

    await setCache(cacheKey, analyticsResponse, 60); // 60 seconds
    res.status(200).json(analyticsResponse);
  } catch (error) {
    console.error('Get Analytics Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getActivityLogs = async (req, res) => {
  try {
    const { page = 1, limit = 25, actorRole, action } = req.query;
    const numericPage = Math.max(parseInt(page, 10) || 1, 1);
    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);

    const filter = {};
    if (actorRole) filter.actorRole = actorRole;
    if (action) filter.action = action;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 })
        .skip((numericPage - 1) * numericLimit)
        .limit(numericLimit),
      AuditLog.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      page: numericPage,
      limit: numericLimit,
      total,
      logs
    });
  } catch (error) {
    console.error('Get Activity Logs Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const exportReport = async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toString().toLowerCase();
    const period = VALID_ANALYTICS_PERIODS.has((req.query.period || '').toString().toLowerCase())
      ? (req.query.period || 'monthly').toString().toLowerCase()
      : 'monthly';
    const [users, courses] = await Promise.all([
      User.find().select('name email role isActive createdAt').sort({ createdAt: -1 }).limit(1000),
      Course.find().populate('instructor', 'name email').sort({ createdAt: -1 }).limit(1000)
    ]);

    const rows = courses.map((course) => ({
      courseTitle: course.title,
      instructor: course.instructor?.name || 'Unassigned',
      enrollments: course.students?.length || 0,
      published: course.isPublished ? 'Yes' : 'No',
      createdAt: course.createdAt?.toISOString?.() || ''
    }));

    if (format === 'pdf') {
      const summary = [
        `Generated At: ${new Date().toISOString()}`,
        `Period: ${period}`,
        `Total Users: ${users.length}`,
        `Total Courses: ${courses.length}`,
        `Total Enrollments: ${courses.reduce((sum, item) => sum + (item.students?.length || 0), 0)}`
      ];

      const pdf = buildSimplePdfBuffer('Platform Report', summary);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="platform-report-${period}.pdf"`);
      return res.status(200).send(pdf);
    }

    const csv = buildCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="platform-report-${period}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Export Report Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendBroadcast = async (req, res) => {
  try {
    const { title, message, severity = 'info' } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }

    const payload = {
      id: `${Date.now()}`,
      title,
      message,
      severity,
      createdAt: new Date().toISOString(),
      createdBy: req.user.id
    };

    const io = getRealtimeServer();
    if (io) {
      io.emit('admin.broadcast', payload);
    }

    recentBroadcasts.unshift(payload);
    if (recentBroadcasts.length > 20) {
      recentBroadcasts.pop();
    }

    await notifyAdmins({
      type: 'system_update',
      title: `System Update: ${title}`,
      message,
      metadata: {
        broadcastId: payload.id,
        severity,
        createdBy: req.user.id
      },
      sendEmail: true
    });

    await logAuditEvent(req, {
      action: 'admin.broadcast.send',
      targetType: 'broadcast',
      targetId: payload.id,
      metadata: { severity }
    });

    res.status(201).json({ success: true, broadcast: payload });
  } catch (error) {
    console.error('Send Broadcast Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listBroadcasts = async (_req, res) => {
  res.status(200).json({ success: true, broadcasts: recentBroadcasts });
};
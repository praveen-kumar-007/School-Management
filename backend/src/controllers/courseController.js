import Course from '../models/Course.js';
import User from '../models/User.js';
import Enrollment from '../models/Enrollment.js';
import CourseProgress from '../models/CourseProgress.js';
import Quiz from '../models/Quiz.js';
import cloudinary from '../config/cloudinary.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { notifyAdmins } from '../services/notificationService.js';
import { validateUploadFile } from '../utils/uploadValidator.js';
import StudentGoal from '../models/StudentGoal.js';
import StudentNote from '../models/StudentNote.js';

const buildCourseProgress = (course, completedLessons = [], completedQuizzes = []) => {
  const totalLessons = (course.modules || []).reduce((sum, module) => {
    return sum + ((module.lessons || []).length);
  }, 0);

  const totalQuizzes = Array.isArray(course.quizzes) ? course.quizzes.length : 0;

  const completedLessonsCount = completedLessons.length;
  const completedQuizzesCount = completedQuizzes.length;

  const lessonsPercent = totalLessons > 0 ? (completedLessonsCount / totalLessons) * 100 : 0;
  const quizzesPercent = totalQuizzes > 0 ? (completedQuizzesCount / totalQuizzes) * 100 : 0;

  const lessonWeight = totalQuizzes > 0 ? 0.7 : 1;
  const quizWeight = totalQuizzes > 0 ? 0.3 : 0;

  const coursePercent = (lessonsPercent * lessonWeight) + (quizzesPercent * quizWeight);

  return {
    totalLessons,
    completedLessonsCount,
    totalQuizzes,
    completedQuizzesCount,
    lessonsPercent: Number(lessonsPercent.toFixed(2)),
    quizzesPercent: Number(quizzesPercent.toFixed(2)),
    progressPercent: Math.max(0, Math.min(100, Number(coursePercent.toFixed(2))))
  };
};

const levelWeight = {
  beginner: 1,
  intermediate: 2,
  advanced: 3
};

const tokenizeText = (text = '') => {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4);
};

const pickTopInterestKeywords = (keywords, top = 12) => {
  const frequency = keywords.reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([token]) => token);
};

const toObjectIdString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return null;
};

export const createCourse = async (req, res) => {
  try {
    const { title, description, category, level, duration, price } = req.body;

    // Validate required fields
    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required' });
    }

    // Handle image upload if provided
    let thumbnailUrl = null;
    if (req.files && req.files.thumbnail) {
      try {
        const file = req.files.thumbnail;

        validateUploadFile(file, ['image']);

        const result = await cloudinary.uploader.upload(file.tempFilePath, {
          folder: `elearning/courses/${req.user.id}`,
          resource_type: 'image'
        });
        thumbnailUrl = result.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary Upload Error:', uploadError);
        return res.status(400).json({ message: uploadError.message || 'Failed to upload thumbnail' });
      }
    }

    const course = new Course({
      title,
      description,
      category: category || 'other',
      level: level || 'beginner',
      duration: duration || '0 weeks',
      price: price || 0,
      thumbnail: thumbnailUrl,
      instructor: req.user.id
    });

    await course.save();
    await course.populate('instructor', 'name email avatar');

    await logAuditEvent(req, {
      action: 'course.create',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        title,
        level: course.level,
        category: course.category
      }
    });

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      course
    });
  } catch (error) {
    console.error('Create Course Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getCourses = async (req, res) => {
  try {
    const { category, level, search, page = 1, limit = 20 } = req.query;
    const numericalPage = Math.max(parseInt(page, 10) || 1, 1);
    const numericalLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (numericalPage - 1) * numericalLimit;

    let filter = { isPublished: true };

    if (category) filter.category = category;
    if (level) filter.level = level;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .populate('instructor', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(numericalLimit)
        .lean(),
      Course.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: courses.length,
      total,
      page: numericalPage,
      limit: numericalLimit,
      totalPages: Math.max(1, Math.ceil(total / numericalLimit)),
      courses
    });
  } catch (error) {
    console.error('Get Courses Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('instructor', 'name email avatar bio')
      .populate('students', 'name email avatar');

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.status(200).json({
      success: true,
      course
    });
  } catch (error) {
    console.error('Get Course Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findById(id);

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check if user is instructor
    if (course.instructor.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this course' });
    }

    // Update fields
    if (req.body.title) course.title = req.body.title;
    if (req.body.description) course.description = req.body.description;
    if (req.body.category) course.category = req.body.category;
    if (req.body.level) course.level = req.body.level;
    if (req.body.duration) course.duration = req.body.duration;
    if (req.body.price) course.price = req.body.price;
    if (req.body.isPublished !== undefined) course.isPublished = req.body.isPublished;

    // Handle new thumbnail upload
    if (req.files && req.files.thumbnail) {
      try {
        const file = req.files.thumbnail;
        const result = await cloudinary.uploader.upload(file.tempFilePath, {
          folder: 'elearning/courses',
          resource_type: 'auto'
        });
        course.thumbnail = result.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary Upload Error:', uploadError);
        return res.status(400).json({ message: 'Failed to upload thumbnail' });
      }
    }

    await course.save();

    await logAuditEvent(req, {
      action: 'course.update',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        title: course.title,
        isPublished: course.isPublished
      }
    });

    res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      course
    });
  } catch (error) {
    console.error('Update Course Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const enrollCourse = async (req, res) => {
  try {
    const courseId = req.params.courseId || req.body.courseId;
    
    if (!courseId) {
      return res.status(400).json({ success: false, message: 'Course ID is required' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const user = await User.findById(req.user.id);

    // Use dedicated enrollment collection
    const existingEnrollment = await Enrollment.findOne({ course: courseId, student: req.user.id });
    if (existingEnrollment) {
      return res.status(400).json({ message: 'Already enrolled in this course' });
    }

    const enrollment = new Enrollment({ course: courseId, student: req.user.id });
    await enrollment.save();

    // Maintain de-normalized student lists for quick queries
    if (!course.students.includes(req.user.id)) {
      course.students.push(req.user.id);
      await course.save();
    }

    if (!user.enrolledCourses.includes(courseId)) {
      user.enrolledCourses.push(courseId);
      await user.save();
    }

    await logAuditEvent(req, {
      action: 'course.enroll',
      targetType: 'course',
      targetId: course._id?.toString(),
      metadata: {
        courseId,
        studentId: req.user.id
      }
    });

    await notifyAdmins({
      type: 'course_purchase',
      title: 'New Course Purchase',
      message: `${user?.name || 'A student'} enrolled in ${course.title}.`,
      metadata: {
        courseId: course._id?.toString(),
        courseTitle: course.title,
        studentId: user?._id?.toString() || req.user.id,
        studentName: user?.name,
        studentEmail: user?.email,
        amount: Number(course.price || 0)
      },
      sendEmail: true
    });

    res.status(200).json({
      success: true,
      message: 'Enrolled successfully',
      course
    });
  } catch (error) {
    console.error('Enroll Course Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getStudentCourses = async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user.id }).select('course');
    const courseIds = enrollments.map((e) => e.course);

    const courses = await Course.find({ _id: { $in: courseIds } })
      .populate('instructor', 'name email avatar')
      .sort({ createdAt: -1 });
    const progressEntries = await CourseProgress.find({
      student: req.user.id,
      course: { $in: courseIds }
    }).lean();

    const progressMap = progressEntries.reduce((acc, entry) => {
      acc[entry.course.toString()] = entry;
      return acc;
    }, {});

    const enrichedCourses = courses.map((course) => {
      const entry = progressMap[course._id.toString()];
      const computed = buildCourseProgress(course, entry?.completedLessons || []);

      return {
        ...course.toObject(),
        progress: entry?.progressPercent ?? computed.progressPercent,
        completedLessonsCount: computed.completedLessonsCount,
        totalLessons: computed.totalLessons
      };
    });

    res.status(200).json({
      success: true,
      count: enrichedCourses.length,
      courses: enrichedCourses
    });
  } catch (error) {
    console.error('Get Student Courses Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getStudentRecommendations = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 20);

    const [student, enrolledCourses, allPublishedCourses, progressEntries] = await Promise.all([
      User.findById(req.user.id).select('name email bio enrolledCourses recommendationPreferences'),
      Course.find({ students: req.user.id }).select('title category level description modules').lean(),
      Course.find({ isPublished: true, students: { $ne: req.user.id } })
        .populate('instructor', 'name email avatar')
        .select('title description category level price rating students thumbnail instructor modules')
        .lean(),
      CourseProgress.find({ student: req.user.id }).select('course progressPercent completedLessons').lean()
    ]);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const progressByCourse = progressEntries.reduce((acc, item) => {
      acc[item.course.toString()] = Number(item.progressPercent || 0);
      return acc;
    }, {});

    const categoryWeights = enrolledCourses.reduce((acc, course) => {
      const progress = Number(progressByCourse[course._id.toString()] || 0);
      const base = 1 + progress / 100;
      const category = course.category || 'other';
      acc[category] = (acc[category] || 0) + base;
      return acc;
    }, {});

    const completedCourses = Object.values(progressByCourse).filter((progress) => progress >= 90).length;
    const avgProgress = Object.values(progressByCourse).length
      ? Object.values(progressByCourse).reduce((sum, value) => sum + Number(value), 0) / Object.values(progressByCourse).length
      : 0;

    const [goalRows, noteRows] = await Promise.all([
      StudentGoal.find({ student: req.user.id }).sort({ updatedAt: -1 }).limit(50).lean(),
      StudentNote.find({ student: req.user.id }).sort({ updatedAt: -1 }).limit(120).lean()
    ]);

    const goalKeywords = goalRows.flatMap((goal) => tokenizeText(`${goal.title || ''} ${goal.milestone || ''}`));
    const noteKeywords = noteRows.flatMap((note) => tokenizeText(`${note.note || ''} ${note.highlight || ''}`));
    const bioKeywords = tokenizeText(student.bio || '');
    const interestKeywords = pickTopInterestKeywords([...goalKeywords, ...noteKeywords, ...bioKeywords]);

    const maxCategoryWeight = Math.max(...Object.values(categoryWeights), 1);
    const targetLevel = avgProgress >= 75 ? 3 : avgProgress >= 40 ? 2 : 1;
    const hiddenCourseIds = new Set((student.recommendationPreferences?.notInterestedCourseIds || []).map((item) => toObjectIdString(item)).filter(Boolean));
    const deEmphasizedCategories = new Set((student.recommendationPreferences?.notInterestedCategories || []).map((item) => String(item || '').toLowerCase()));

    const scoredRecommendations = allPublishedCourses.map((course) => {
      const reasons = [];
      let score = 0;

      const courseCategory = course.category || 'other';
      let categoryScore = ((categoryWeights[courseCategory] || 0) / maxCategoryWeight) * 45;
      if (deEmphasizedCategories.has(courseCategory.toLowerCase())) {
        categoryScore *= 0.35;
        reasons.push(`Lower priority due to your recent “not interested” feedback in ${courseCategory}`);
      }
      if (categoryScore > 0) {
        reasons.push(`Matches your interest in ${courseCategory}`);
      }
      score += categoryScore;

      const courseLevelWeight = levelWeight[course.level] || 1;
      const levelGap = Math.abs(targetLevel - courseLevelWeight);
      const levelScore = Math.max(0, 20 - levelGap * 8);
      if (levelScore >= 12) {
        reasons.push('Fits your learning progression stage');
      }
      score += levelScore;

      const popularityScore = Math.min((course.students?.length || 0) / 80, 1) * 10;
      if (popularityScore >= 5) {
        reasons.push('Popular among learners');
      }
      score += popularityScore;

      const ratingScore = Math.min(Math.max(Number(course.rating || 0), 0), 5) * 2;
      if (ratingScore >= 7) {
        reasons.push('Highly rated by students');
      }
      score += ratingScore;

      const courseText = `${course.title || ''} ${course.description || ''}`.toLowerCase();
      const keywordMatches = interestKeywords.filter((keyword) => courseText.includes(keyword));
      const keywordScore = Math.min(keywordMatches.length * 4, 20);
      if (keywordScore > 0) {
        reasons.push(`Aligned with your focus topics: ${keywordMatches.slice(0, 3).join(', ')}`);
      }
      score += keywordScore;

      const normalizedScore = Number(Math.min(100, Math.max(0, score)).toFixed(2));
      const isHidden = hiddenCourseIds.has(toObjectIdString(course._id));

      return {
        course,
        recommendationScore: normalizedScore,
        reasons: reasons.slice(0, 3),
        hiddenByPreference: isHidden,
        matchProfile: {
          categoryAffinity: Number(categoryScore.toFixed(2)),
          levelFit: Number(levelScore.toFixed(2)),
          popularity: Number(popularityScore.toFixed(2)),
          rating: Number(ratingScore.toFixed(2)),
          interestKeywordFit: Number(keywordScore.toFixed(2))
        }
      };
    });

    const recommendations = scoredRecommendations
      .filter((item) => !item.hiddenByPreference)
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, limit);

    res.status(200).json({
      success: true,
      profile: {
        avgProgress: Number(avgProgress.toFixed(2)),
        completedCourses,
        strongestCategories: Object.entries(categoryWeights)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([category]) => category),
        inferredInterests: interestKeywords.slice(0, 8),
        suppressedCategories: Array.from(deEmphasizedCategories)
      },
      recommendations
    });
  } catch (error) {
    console.error('Get Student Recommendations Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const askDoubtAssistant = async (req, res) => {
  try {
    const { question, courseId } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }

    const student = await User.findById(req.user.id).populate('enrolledCourses', 'title description category level modules');
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const studentCourses = (student.enrolledCourses || []).map((course) => course.title).slice(0, 5);

    const lowerQuestion = question.toLowerCase();
    let generatedAnswer = 'Great question! Let me help you better understand that topic.';

    if (lowerQuestion.includes('explain') || lowerQuestion.includes('what is')) {
      generatedAnswer = `Certainly! ${question} is an important concept in your learning journey. `;
      generatedAnswer += `You are enrolled in ${studentCourses.length ? studentCourses.join(', ') : 'your courses'}, so try mapping the concept to those course materials for faster understanding.`;
    } else if (lowerQuestion.includes('assignment') || lowerQuestion.includes('quiz')) {
      generatedAnswer = `For your ${question}, focus on revisiting assignments and quizzes from ${studentCourses.length ? studentCourses[0] : 'your current course'}. `;
      generatedAnswer += 'Make sure to review key examples, and practice with similar questions.';
    } else if (lowerQuestion.includes('project') || lowerQuestion.includes('deadline')) {
      generatedAnswer = `Looking at your courses, it is a good idea to break the work into 20-minute focused study sessions. `;
      generatedAnswer += 'Create a checklist to track completion and try group discussion on related forum sections.';
    } else {
      generatedAnswer = `Here is a guided response for: ${question}. `;
      generatedAnswer += 'I recommend exploring topics in your current course modules step-by-step using the quiz and lesson review features.';
    }

    const suggestionTemplates = [
      'Summarize this concept in 3 bullet points',
      'Provide a sample problem and solution',
      'Relate this to a real-world example',
      'Recommend a quick revision plan for this topic'
    ];

    const coursesRef = studentCourses.length ? `Courses: ${studentCourses.join(', ')}` : 'No enrolled courses found';

    return res.status(200).json({
      success: true,
      answer: generatedAnswer,
      relatedCourses: studentCourses,
      suggestedResources: [
        { title: 'Core Concepts Recap', type: 'cheatsheet', link: 'https://example.com/cheatsheet' },
        { title: 'Practice Quiz', type: 'quiz', link: 'https://example.com/practice-quiz' }
      ],
      quickSuggestions: suggestionTemplates,
      context: coursesRef
    });
  } catch (error) {
    console.error('Ask Doubt Assistant Error:', error);
    res.status(500).json({ success: false, message: 'AI Doubt Assistant failed to respond' });
  }
};

export const submitRecommendationFeedback = async (req, res) => {
  try {
    const { courseId, feedback } = req.body;

    if (!courseId || !['not_interested', 'undo_not_interested'].includes(feedback)) {
      return res.status(400).json({ success: false, message: 'courseId and valid feedback are required' });
    }

    const [student, course] = await Promise.all([
      User.findById(req.user.id),
      Course.findById(courseId).select('category')
    ]);

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const prefs = student.recommendationPreferences || {
      notInterestedCourseIds: [],
      notInterestedCategories: []
    };

    const courseIdString = toObjectIdString(course._id);
    const category = String(course.category || 'other').toLowerCase();

    if (feedback === 'not_interested') {
      const existingCourseIdSet = new Set((prefs.notInterestedCourseIds || []).map((item) => toObjectIdString(item)).filter(Boolean));
      if (!existingCourseIdSet.has(courseIdString)) {
        prefs.notInterestedCourseIds.push(course._id);
      }

      const existingCategorySet = new Set((prefs.notInterestedCategories || []).map((item) => String(item || '').toLowerCase()));
      if (!existingCategorySet.has(category)) {
        prefs.notInterestedCategories.push(category);
      }
    }

    if (feedback === 'undo_not_interested') {
      const filteredCourseIds = (prefs.notInterestedCourseIds || []).filter((item) => toObjectIdString(item) !== courseIdString);
      prefs.notInterestedCourseIds = filteredCourseIds;

      const remainingCourses = await Course.find({ _id: { $in: filteredCourseIds } }).select('category').lean();
      const categoryStillHidden = remainingCourses.some((item) => String(item.category || 'other').toLowerCase() === category);
      if (!categoryStillHidden) {
        prefs.notInterestedCategories = (prefs.notInterestedCategories || []).filter((item) => String(item || '').toLowerCase() !== category);
      }
    }

    student.recommendationPreferences = prefs;
    await student.save();

    await logAuditEvent(req, {
      action: feedback === 'not_interested'
        ? 'student.recommendation.feedback.not_interested'
        : 'student.recommendation.feedback.undo_not_interested',
      targetType: 'course',
      targetId: courseIdString,
      metadata: {
        category,
        feedback
      }
    });

    res.status(200).json({
      success: true,
      message: feedback === 'not_interested'
        ? 'Recommendation feedback recorded'
        : 'Recommendation feedback reverted',
      preferences: {
        hiddenCourses: prefs.notInterestedCourseIds.map((item) => toObjectIdString(item)),
        suppressedCategories: prefs.notInterestedCategories
      }
    });
  } catch (error) {
    console.error('Submit Recommendation Feedback Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getRecommendationPreferences = async (req, res) => {
  try {
    const student = await User.findById(req.user.id)
      .select('recommendationPreferences')
      .populate('recommendationPreferences.notInterestedCourseIds', 'title category level');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const prefs = student.recommendationPreferences || {
      notInterestedCourseIds: [],
      notInterestedCategories: []
    };

    res.status(200).json({
      success: true,
      preferences: {
        hiddenCourses: (prefs.notInterestedCourseIds || []).map((course) => ({
          _id: toObjectIdString(course?._id || course),
          title: course?.title || 'Unknown Course',
          category: course?.category || 'other',
          level: course?.level || 'beginner'
        })),
        suppressedCategories: prefs.notInterestedCategories || []
      }
    });
  } catch (error) {
    console.error('Get Recommendation Preferences Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const clearRecommendationPreferences = async (req, res) => {
  try {
    const student = await User.findById(req.user.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    student.recommendationPreferences = {
      notInterestedCourseIds: [],
      notInterestedCategories: []
    };

    await student.save();

    await logAuditEvent(req, {
      action: 'student.recommendation.preferences.clear',
      targetType: 'user',
      targetId: req.user.id,
      metadata: {
        cleared: true
      }
    });

    res.status(200).json({
      success: true,
      message: 'Recommendation preferences cleared',
      preferences: {
        hiddenCourses: [],
        suppressedCategories: []
      }
    });
  } catch (error) {
    console.error('Clear Recommendation Preferences Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const removeRecommendationPreferenceItem = async (req, res) => {
  try {
    const { type, value } = req.body;

    if (!type || !value || !['course', 'category'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type (course|category) and value are required' });
    }

    const student = await User.findById(req.user.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const prefs = student.recommendationPreferences || {
      notInterestedCourseIds: [],
      notInterestedCategories: []
    };

    if (type === 'course') {
      const courseIdValue = String(value);
      prefs.notInterestedCourseIds = (prefs.notInterestedCourseIds || []).filter((item) => toObjectIdString(item) !== courseIdValue);

      const remainingCourses = await Course.find({ _id: { $in: prefs.notInterestedCourseIds } }).select('category').lean();
      const categorySet = new Set(remainingCourses.map((item) => String(item.category || 'other').toLowerCase()));
      prefs.notInterestedCategories = (prefs.notInterestedCategories || []).filter((item) => categorySet.has(String(item || '').toLowerCase()));
    }

    if (type === 'category') {
      const categoryValue = String(value).toLowerCase();
      prefs.notInterestedCategories = (prefs.notInterestedCategories || []).filter((item) => String(item || '').toLowerCase() !== categoryValue);

      const retainedCourseIds = [];
      for (const courseId of prefs.notInterestedCourseIds || []) {
        const normalizedCourseId = toObjectIdString(courseId);
        if (!normalizedCourseId) continue;
        const course = await Course.findById(normalizedCourseId).select('category').lean();
        if (!course) continue;
        if (String(course.category || 'other').toLowerCase() !== categoryValue) {
          retainedCourseIds.push(courseId);
        }
      }
      prefs.notInterestedCourseIds = retainedCourseIds;
    }

    student.recommendationPreferences = prefs;
    await student.save();

    await logAuditEvent(req, {
      action: 'student.recommendation.preferences.remove_item',
      targetType: 'user',
      targetId: req.user.id,
      metadata: {
        type,
        value
      }
    });

    const populatedStudent = await User.findById(req.user.id)
      .select('recommendationPreferences')
      .populate('recommendationPreferences.notInterestedCourseIds', 'title category level');

    const latest = populatedStudent?.recommendationPreferences || {
      notInterestedCourseIds: [],
      notInterestedCategories: []
    };

    res.status(200).json({
      success: true,
      message: 'Recommendation preference removed',
      preferences: {
        hiddenCourses: (latest.notInterestedCourseIds || []).map((course) => ({
          _id: toObjectIdString(course?._id || course),
          title: course?.title || 'Unknown Course',
          category: course?.category || 'other',
          level: course?.level || 'beginner'
        })),
        suppressedCategories: latest.notInterestedCategories || []
      }
    });
  } catch (error) {
    console.error('Remove Recommendation Preference Item Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getInstructorCourses = async (req, res) => {
  try {
    const courses = await Course.find({ instructor: req.user.id })
      .populate('students', 'name email avatar')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: courses.length,
      courses
    });
  } catch (error) {
    console.error('Get Instructor Courses Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const updateLessonProgress = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { moduleIndex, lessonIndex, completed = true } = req.body;

    if (moduleIndex === undefined || lessonIndex === undefined) {
      return res.status(400).json({ success: false, message: 'moduleIndex and lessonIndex are required' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const module = course.modules?.[moduleIndex];
    if (!module) {
      return res.status(400).json({ success: false, message: 'Invalid moduleIndex' });
    }

    const lesson = module.lessons?.[lessonIndex];
    if (!lesson) {
      return res.status(400).json({ success: false, message: 'Invalid lessonIndex' });
    }

    const progress = await CourseProgress.findOneAndUpdate(
      { student: req.user.id, course: courseId },
      { $setOnInsert: { student: req.user.id, course: courseId } },
      { new: true, upsert: true }
    );
    const previousProgressPercent = Number(progress.progressPercent || 0);

    const lessonKey = `${moduleIndex}:${lessonIndex}`;
    const existingIndex = (progress.completedLessons || []).findIndex(
      (item) => `${item.moduleIndex}:${item.lessonIndex}` === lessonKey
    );

    if (completed && existingIndex < 0) {
      progress.completedLessons.push({ moduleIndex, lessonIndex, completedAt: new Date() });
    }

    if (!completed && existingIndex >= 0) {
      progress.completedLessons.splice(existingIndex, 1);
    }

    const computed = buildCourseProgress(course, progress.completedLessons, progress.completedQuizzes || []);
    progress.progressPercent = computed.progressPercent;
    progress.lastActivityAt = new Date();
    await progress.save();

    if (previousProgressPercent < 100 && progress.progressPercent === 100) {
      await notifyAdmins({
        type: 'course_completion',
        title: 'Course Completed',
        message: `${req.user.name || 'A student'} completed ${course.title}.`,
        metadata: {
          courseId: course._id?.toString(),
          courseTitle: course.title,
          studentId: req.user.id,
          studentName: req.user.name,
          progressPercent: progress.progressPercent
        },
        sendEmail: true
      });
    }

    await logAuditEvent(req, {
      action: 'course.progress.update',
      targetType: 'course',
      targetId: courseId,
      metadata: {
        moduleIndex,
        lessonIndex,
        completed,
        progressPercent: progress.progressPercent
      }
    });

    res.status(200).json({
      success: true,
      message: 'Progress updated',
      progress: {
        courseId,
        totalLessons: computed.totalLessons,
        completedLessonsCount: computed.completedLessonsCount,
        totalQuizzes: computed.totalQuizzes,
        completedQuizzesCount: computed.completedQuizzesCount,
        lessonsPercent: computed.lessonsPercent,
        quizzesPercent: computed.quizzesPercent,
        progressPercent: progress.progressPercent,
        completedLessons: progress.completedLessons,
        completedQuizzes: progress.completedQuizzes || [],
        videoProgress: progress.videoProgress || [],
        lastActivityAt: progress.lastActivityAt
      }
    });
  } catch (error) {
    console.error('Update Lesson Progress Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVideoProgress = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { moduleIndex, lessonIndex, watchedPercent } = req.body;

    if (moduleIndex === undefined || lessonIndex === undefined || watchedPercent === undefined) {
      return res.status(400).json({ success: false, message: 'moduleIndex, lessonIndex, and watchedPercent are required' });
    }

    if (typeof watchedPercent !== 'number' || watchedPercent < 0 || watchedPercent > 100) {
      return res.status(400).json({ success: false, message: 'watchedPercent must be a number between 0 and 100' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const module = course.modules?.[moduleIndex];
    if (!module || !module.lessons?.[lessonIndex]) {
      return res.status(400).json({ success: false, message: 'Invalid moduleIndex or lessonIndex' });
    }

    const progress = await CourseProgress.findOneAndUpdate(
      { student: req.user.id, course: courseId },
      { $setOnInsert: { student: req.user.id, course: courseId } },
      { new: true, upsert: true }
    );

    const videoKey = `${moduleIndex}:${lessonIndex}`;
    const existingVideoIdx = (progress.videoProgress || []).findIndex(
      (item) => `${item.moduleIndex}:${item.lessonIndex}` === videoKey
    );

    if (existingVideoIdx >= 0) {
      progress.videoProgress[existingVideoIdx].watchedPercent = Math.max(progress.videoProgress[existingVideoIdx].watchedPercent, watchedPercent);
      progress.videoProgress[existingVideoIdx].updatedAt = new Date();
    } else {
      progress.videoProgress = progress.videoProgress || [];
      progress.videoProgress.push({ moduleIndex, lessonIndex, watchedPercent, updatedAt: new Date() });
    }

    const lessonKey = `${moduleIndex}:${lessonIndex}`;
    const existingLessonIndex = (progress.completedLessons || []).findIndex(
      (item) => `${item.moduleIndex}:${item.lessonIndex}` === lessonKey
    );

    if (watchedPercent >= 90 && existingLessonIndex < 0) {
      progress.completedLessons = progress.completedLessons || [];
      progress.completedLessons.push({ moduleIndex, lessonIndex, completedAt: new Date() });
    }

    const computed = buildCourseProgress(course, progress.completedLessons || [], progress.completedQuizzes || []);
    const previousProgressPercent = Number(progress.progressPercent || 0);

    progress.progressPercent = computed.progressPercent;
    progress.lastActivityAt = new Date();
    await progress.save();

    if (previousProgressPercent < 100 && progress.progressPercent === 100) {
      await notifyAdmins({
        type: 'course_completion',
        title: 'Course Completed',
        message: `${req.user.name || 'A student'} completed ${course.title}.`,
        metadata: {
          courseId: course._id?.toString(),
          courseTitle: course.title,
          studentId: req.user.id,
          studentName: req.user.name,
          progressPercent: progress.progressPercent
        },
        sendEmail: true
      });
    }

    await logAuditEvent(req, {
      action: 'course.progress.video',
      targetType: 'course',
      targetId: courseId,
      metadata: {
        moduleIndex,
        lessonIndex,
        watchedPercent,
        progressPercent: progress.progressPercent
      }
    });

    res.status(200).json({
      success: true,
      message: 'Video progress updated',
      progress: {
        courseId,
        ...computed,
        videoProgress: progress.videoProgress,
        completedLessons: progress.completedLessons,
        completedQuizzes: progress.completedQuizzes || [],
        progressPercent: progress.progressPercent,
        lastActivityAt: progress.lastActivityAt
      }
    });
  } catch (error) {
    console.error('Update Video Progress Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const completeQuiz = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { quizId, score, maxScore } = req.body;

    if (!quizId || score === undefined || maxScore === undefined) {
      return res.status(400).json({ success: false, message: 'quizId, score, and maxScore are required' });
    }

    if (typeof score !== 'number' || typeof maxScore !== 'number' || score < 0 || maxScore <= 0 || score > maxScore) {
      return res.status(400).json({ success: false, message: 'Invalid score or maxScore' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz || quiz.course.toString() !== courseId) {
      return res.status(400).json({ success: false, message: 'Quiz not found or not part of this course' });
    }

    const progress = await CourseProgress.findOneAndUpdate(
      { student: req.user.id, course: courseId },
      { $setOnInsert: { student: req.user.id, course: courseId } },
      { new: true, upsert: true }
    );

    const existingQuizIndex = (progress.completedQuizzes || []).findIndex((item) => item.quiz.toString() === quizId);

    if (existingQuizIndex >= 0) {
      progress.completedQuizzes[existingQuizIndex].score = score;
      progress.completedQuizzes[existingQuizIndex].maxScore = maxScore;
      progress.completedQuizzes[existingQuizIndex].completedAt = new Date();
    } else {
      progress.completedQuizzes = progress.completedQuizzes || [];
      progress.completedQuizzes.push({ quiz: quizId, score, maxScore, completedAt: new Date() });
    }

    const computed = buildCourseProgress(course, progress.completedLessons || [], progress.completedQuizzes || []);
    const previousProgressPercent = Number(progress.progressPercent || 0);

    progress.progressPercent = computed.progressPercent;
    progress.lastActivityAt = new Date();
    await progress.save();

    if (previousProgressPercent < 100 && progress.progressPercent === 100) {
      await notifyAdmins({
        type: 'course_completion',
        title: 'Course Completed',
        message: `${req.user.name || 'A student'} completed ${course.title}.`,
        metadata: {
          courseId: course._id?.toString(),
          courseTitle: course.title,
          studentId: req.user.id,
          studentName: req.user.name,
          progressPercent: progress.progressPercent
        },
        sendEmail: true
      });
    }

    await logAuditEvent(req, {
      action: 'course.progress.quiz',
      targetType: 'course',
      targetId: courseId,
      metadata: {
        quizId,
        score,
        maxScore,
        progressPercent: progress.progressPercent
      }
    });

    res.status(200).json({
      success: true,
      message: 'Quiz marked complete',
      progress: {
        courseId,
        totalLessons: computed.totalLessons,
        completedLessonsCount: computed.completedLessonsCount,
        totalQuizzes: computed.totalQuizzes,
        completedQuizzesCount: computed.completedQuizzesCount,
        lessonsPercent: computed.lessonsPercent,
        quizzesPercent: computed.quizzesPercent,
        progressPercent: progress.progressPercent,
        completedLessons: progress.completedLessons || [],
        completedQuizzes: progress.completedQuizzes || [],
        videoProgress: progress.videoProgress || [],
        lastActivityAt: progress.lastActivityAt
      }
    });
  } catch (error) {
    console.error('Complete Quiz Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyCourseProgress = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    const progress = await CourseProgress.findOne({ student: req.user.id, course: courseId }).lean();
    const completedLessons = progress?.completedLessons || [];
    const completedQuizzes = progress?.completedQuizzes || [];
    const computed = buildCourseProgress(course, completedLessons, completedQuizzes);

    res.status(200).json({
      success: true,
      progress: {
        courseId,
        totalLessons: computed.totalLessons,
        completedLessonsCount: computed.completedLessonsCount,
        totalQuizzes: computed.totalQuizzes,
        completedQuizzesCount: computed.completedQuizzesCount,
        lessonsPercent: computed.lessonsPercent,
        quizzesPercent: computed.quizzesPercent,
        progressPercent: progress?.progressPercent ?? computed.progressPercent,
        completedLessons,
        completedQuizzes,
        videoProgress: progress?.videoProgress || [],
        lastActivityAt: progress?.lastActivityAt || null
      }
    });
  } catch (error) {
    console.error('Get My Course Progress Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseProgressAnalytics = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const course = await Course.findById(courseId).populate('students', 'name email');

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    if (course.instructor.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to view this course analytics' });
    }

    const progressEntries = await CourseProgress.find({ course: courseId })
      .select('student completedLessons completedQuizzes progressPercent')
      .lean();

    const progressMap = progressEntries.reduce((acc, entry) => {
      acc[entry.student.toString()] = entry;
      return acc;
    }, {});

    const studentProgress = course.students.map((student) => {
      const entry = progressMap[student._id.toString()];
      const computed = buildCourseProgress(course, entry?.completedLessons || [], entry?.completedQuizzes || []);
      return {
        studentId: student._id,
        name: student.name,
        email: student.email,
        progressPercent: entry?.progressPercent ?? computed.progressPercent,
        completedLessonsCount: computed.completedLessonsCount,
        totalLessons: computed.totalLessons,
        completedQuizzesCount: computed.completedQuizzesCount,
        totalQuizzes: computed.totalQuizzes
      };
    });

    const averageProgress = studentProgress.length
      ? Math.round(studentProgress.reduce((sum, item) => sum + item.progressPercent, 0) / studentProgress.length)
      : 0;

    res.status(200).json({
      success: true,
      analytics: {
        courseId,
        courseTitle: course.title,
        totalStudents: studentProgress.length,
        averageProgress,
        studentProgress
      }
    });
  } catch (error) {
    console.error('Get Course Progress Analytics Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

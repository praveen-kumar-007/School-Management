import Assignment from '../models/Assignment.js';
import Course from '../models/Course.js';
import AssignmentSubmission from '../models/AssignmentSubmission.js';
import Enrollment from '../models/Enrollment.js';
import cloudinary from '../config/cloudinary.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { notifyUsers } from '../services/notificationService.js';
import { validateUploadFile } from '../utils/uploadValidator.js';

const gradeSmartTestSubmission = (assignment, answers = []) => {
  const questions = assignment?.testConfig?.questions || [];
  const answerMap = answers.reduce((acc, item) => {
    acc[item.questionIndex] = item.selectedOptionIndex;
    return acc;
  }, {});

  let score = 0;
  let maxScore = 0;
  let correctCount = 0;

  questions.forEach((question, index) => {
    const marks = Number(question?.marks || 1);
    maxScore += marks;

    if (answerMap[index] === question.correctOptionIndex) {
      score += marks;
      correctCount += 1;
    }
  });

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  return {
    score,
    maxScore,
    percentage,
    totalQuestions: questions.length,
    correctCount
  };
};

export const createAssignment = async (req, res) => {
  try {
    const { courseId, title, description, dueDate, totalMarks } = req.body;

    // Verify course and instructor
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    if (course.instructor.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const assignment = new Assignment({
      course: courseId,
      title,
      description,
      kind: 'assignment',
      dueDate,
      totalMarks: totalMarks || 100
    });

    await assignment.save();

    await logAuditEvent(req, {
      action: 'assignment.create',
      targetType: 'assignment',
      targetId: assignment._id?.toString(),
      metadata: {
        title: assignment.title,
        courseId: courseId
      }
    });

    await notifyUsers({
      userIds: course.students || [],
      type: 'assignment_uploaded',
      title: `New Assignment: ${assignment.title}`,
      message: `A new assignment has been uploaded for ${course.title}. Due date: ${new Date(assignment.dueDate).toLocaleString()}`,
      metadata: {
        assignmentId: assignment._id?.toString(),
        courseId: course._id?.toString()
      },
      sendEmail: true
    });

    res.status(201).json({
      success: true,
      message: 'Assignment created',
      assignment
    });
  } catch (error) {
    console.error('Create Assignment Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const submitAssignment = async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId || req.body.assignmentId;
    if (!assignmentId) {
      return res.status(400).json({ success: false, message: 'Assignment ID is required' });
    }

    const assignment = await Assignment.findById(assignmentId).populate('course');
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    if (assignment.kind === 'smart_test') {
      return res.status(400).json({ success: false, message: 'Use smart test submit endpoint for this test' });
    }

    const userId = req.user.id;

    const enrolled = await Enrollment.exists({ course: assignment.course._id, student: userId });
    if (!enrolled) {
      return res.status(403).json({ success: false, message: 'Student is not enrolled in this course' });
    }

    let fileUrl = null;
    if (req.files && req.files.file) {
      try {
        const file = req.files.file;

        // validate assignment upload file type and size
        validateUploadFile(file, ['pdf', 'docx', 'image', 'video']);

        const result = await cloudinary.uploader.upload(file.tempFilePath, {
          folder: `elearning/assignments/${assignmentId}/${userId}`,
          resource_type: 'auto'
        });
        fileUrl = result.secure_url;
      } catch (uploadError) {
        console.error('Cloudinary Upload Error:', uploadError);
        return res.status(400).json({ success: false, message: uploadError.message || 'Failed to upload file' });
      }
    }

    const submissionRecord = new AssignmentSubmission({
      assignment: assignment._id,
      course: assignment.course._id,
      student: userId,
      submittedAt: new Date(),
      fileUrl,
      status: 'submitted',
      isReviewed: false
    });

    await submissionRecord.save();

    await logAuditEvent(req, {
      action: 'assignment.submit',
      targetType: 'assignment',
      targetId: assignment._id?.toString(),
      metadata: {
        assignmentId,
        studentId: userId,
        hasFile: !!fileUrl
      }
    });

    res.status(201).json({
      success: true,
      message: 'Assignment submitted',
      submission: submissionRecord
    });
  } catch (error) {
    console.error('Submit Assignment Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const gradeAssignment = async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId || req.body.assignmentId;
    const { studentId, marks, feedback } = req.body;
    
    if (!assignmentId) {
      return res.status(400).json({ success: false, message: 'Assignment ID is required' });
    }
    
    if (!studentId || marks === undefined) {
      return res.status(400).json({ success: false, message: 'Student ID and marks are required' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    // Verify instructor
    const course = await Course.findById(assignment.course);
    if (course.instructor.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const submission = await AssignmentSubmission.findOne({ assignment: assignmentId, student: studentId }).sort({ submittedAt: -1 });
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    submission.marks = marks;
    submission.feedback = feedback || '';
    submission.isReviewed = true;
    submission.status = 'graded';
    await submission.save();

    await notifyUsers({
      userIds: [studentId],
      type: 'assignment_graded',
      title: `Assignment Graded: ${assignment.title}`,
      message: `Your submission for ${assignment.title} has been graded: ${marks} marks.`,
      metadata: {
        assignmentId,
        studentId,
        marks
      },
      sendEmail: true
    });

    await logAuditEvent(req, {
      action: 'assignment.grade',
      targetType: 'assignment',
      targetId: assignment._id?.toString(),
      metadata: {
        assignmentId,
        studentId,
        marks
      }
    });

    res.status(200).json({
      success: true,
      message: 'Assignment graded',
      submission
    });
  } catch (error) {
    console.error('Grade Assignment Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const getAssignmentSubmissions = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    if (!assignmentId) {
      return res.status(400).json({ success: false, message: 'Assignment ID is required' });
    }

    const assignment = await Assignment.findById(assignmentId).populate('course');
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    if (assignment.course?.instructor?.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const submissions = await AssignmentSubmission.find({ assignment: assignmentId })
      .populate('student', 'name email')
      .sort({ submittedAt: -1 });

    res.status(200).json({
      success: true,
      assignmentId,
      count: submissions.length,
      submissions
    });
  } catch (error) {
    console.error('Get Assignment Submissions Error:', error);
    res.status(500).json({ message: error.message });
  }
};

export const createSmartTest = async (req, res) => {
  try {
    const {
      courseId,
      title,
      description,
      dueDate,
      totalMarks,
      durationMinutes = 30,
      shuffleQuestions = false,
      questions = []
    } = req.body;

    if (!courseId || !title || !dueDate) {
      return res.status(400).json({ success: false, message: 'courseId, title and dueDate are required' });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one question is required' });
    }

    const hasInvalidQuestion = questions.some((question) => {
      return !question.prompt
        || !Array.isArray(question.options)
        || question.options.length < 2
        || question.correctOptionIndex === undefined;
    });

    if (hasInvalidQuestion) {
      return res.status(400).json({ success: false, message: 'Each question must include prompt, options(>=2), and correctOptionIndex' });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    if (course.instructor.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const maxMarks = questions.reduce((sum, question) => sum + Number(question.marks || 1), 0);

    const smartTest = new Assignment({
      course: courseId,
      title,
      description,
      dueDate,
      kind: 'smart_test',
      totalMarks: totalMarks || maxMarks,
      testConfig: {
        durationMinutes,
        shuffleQuestions,
        questions: questions.map((question) => ({
          prompt: question.prompt,
          options: question.options,
          correctOptionIndex: Number(question.correctOptionIndex),
          marks: Number(question.marks || 1)
        }))
      }
    });

    await smartTest.save();

    await logAuditEvent(req, {
      action: 'smart_test.create',
      targetType: 'assignment',
      targetId: smartTest._id?.toString(),
      metadata: {
        courseId,
        durationMinutes,
        questionCount: questions.length
      }
    });

    await notifyUsers({
      userIds: course.students || [],
      type: 'test_scheduled',
      title: `Smart Test Scheduled: ${smartTest.title}`,
      message: `A smart test is scheduled for ${course.title}. Duration: ${durationMinutes} min. Due: ${new Date(smartTest.dueDate).toLocaleString()}`,
      metadata: {
        assignmentId: smartTest._id?.toString(),
        courseId: course._id?.toString(),
        durationMinutes
      },
      sendEmail: true
    });

    res.status(201).json({
      success: true,
      message: 'Smart test created',
      smartTest
    });
  } catch (error) {
    console.error('Create Smart Test Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const submitSmartTest = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { answers = [], startedAt, timeSpentSeconds = 0 } = req.body;

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Smart test not found' });
    }

    if (assignment.kind !== 'smart_test') {
      return res.status(400).json({ success: false, message: 'This assignment is not a smart test' });
    }

    if (new Date() > new Date(assignment.dueDate)) {
      return res.status(400).json({ success: false, message: 'Test deadline passed' });
    }

    const existingSubmission = await AssignmentSubmission.findOne({ assignment: assignmentId, student: req.user.id }).sort({ submittedAt: -1 });

    if (existingSubmission && existingSubmission.status === 'submitted') {
      return res.status(400).json({ success: false, message: 'Smart test already submitted' });
    }

    const secondsSpent = Number(timeSpentSeconds || 0);
    const maxAllowedSeconds = Number(assignment.testConfig?.durationMinutes || 30) * 60;
    if (secondsSpent > maxAllowedSeconds + 15) {
      return res.status(400).json({ success: false, message: 'Timer limit exceeded' });
    }

    const grading = gradeSmartTestSubmission(assignment, answers);

    const submissionRecord = new AssignmentSubmission({
      assignment: assignment._id,
      course: assignment.course,
      student: req.user.id,
      submittedAt: new Date(),
      startedAt: startedAt ? new Date(startedAt) : null,
      timeSpentSeconds: secondsSpent,
      fileUrl: null,
      status: 'graded',
      autoGradedScore: grading.score,
      marks: grading.score,
      feedback: `Auto graded: ${grading.correctCount}/${grading.totalQuestions} correct (${grading.percentage}%)`,
      isReviewed: true
    });

    await submissionRecord.save();

    await logAuditEvent(req, {
      action: 'smart_test.submit',
      targetType: 'assignment',
      targetId: assignmentId,
      metadata: {
        score: grading.score,
        percentage: grading.percentage,
        timeSpentSeconds: secondsSpent
      }
    });

    res.status(200).json({
      success: true,
      message: 'Smart test submitted and auto graded',
      result: grading
    });
  } catch (error) {
    console.error('Submit Smart Test Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSmartTestAnalytics = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await Assignment.findById(assignmentId).populate('course', 'title instructor');

    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Smart test not found' });
    }

    if (assignment.kind !== 'smart_test') {
      return res.status(400).json({ success: false, message: 'This assignment is not a smart test' });
    }

    if (assignment.course?.instructor?.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const submissions = await AssignmentSubmission.find({ assignment: assignmentId })
      .populate('student', 'name email')
      .sort({ submittedAt: -1 });

    const scores = submissions.map((item) => Number(item.autoGradedScore ?? item.marks ?? 0));
    const averageScore = scores.length
      ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100) / 100
      : 0;

    const avgTimeSpentSeconds = submissions.length
      ? Math.round(submissions.reduce((sum, item) => sum + Number(item.timeSpentSeconds || 0), 0) / submissions.length)
      : 0;

    const passScore = Math.round(Number(assignment.totalMarks || 0) * 0.4);
    const passCount = scores.filter((score) => score >= passScore).length;

    res.status(200).json({
      success: true,
      analytics: {
        assignmentId,
        title: assignment.title,
        courseTitle: assignment.course?.title,
        durationMinutes: assignment.testConfig?.durationMinutes || 0,
        questionCount: assignment.testConfig?.questions?.length || 0,
        totalSubmissions: submissions.length,
        averageScore,
        highestScore: scores.length ? Math.max(...scores) : 0,
        lowestScore: scores.length ? Math.min(...scores) : 0,
        passCount,
        failCount: submissions.length - passCount,
        passRate: submissions.length ? Math.round((passCount / submissions.length) * 100) : 0,
        avgTimeSpentSeconds,
        results: submissions.map((item) => ({
          studentId: item.student?._id,
          name: item.student?.name,
          email: item.student?.email,
          score: item.autoGradedScore ?? item.marks ?? 0,
          timeSpentSeconds: item.timeSpentSeconds || 0,
          submittedAt: item.submittedAt
        }))
      }
    });
  } catch (error) {
    console.error('Get Smart Test Analytics Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAssignments = async (req, res) => {
  try {
    const { courseId, page = 1, limit = 20 } = req.query;
    const numericPage = Math.max(parseInt(page, 10) || 1, 1);
    const numericLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (numericPage - 1) * numericLimit;

    let filter = {};
    if (courseId) filter.course = courseId;

    const [assignments, total] = await Promise.all([
      Assignment.find(filter)
        .populate('course', 'title')
        .sort({ dueDate: 1 })
        .skip(skip)
        .limit(numericLimit)
        .lean(),
      Assignment.countDocuments(filter)
    ]);

    const assignmentIds = assignments.map((assignment) => assignment._id);
    const allSubmissions = await AssignmentSubmission.find({ assignment: { $in: assignmentIds } })
      .populate('student', 'name email')
      .sort({ submittedAt: -1 });

    const submissionsMap = allSubmissions.reduce((acc, submission) => {
      const id = submission.assignment.toString();
      if (!acc[id]) acc[id] = [];
      acc[id].push(submission);
      return acc;
    }, {});

    const assignmentsWithSubmissions = assignments.map((assignment) => ({
      ...assignment.toObject(),
      submissions: submissionsMap[assignment._id.toString()] || []
    }));

    res.status(200).json({
      success: true,
      count: assignments.length,
      total,
      page: numericPage,
      limit: numericLimit,
      totalPages: Math.max(1, Math.ceil(total / numericLimit)),
      assignments: assignmentsWithSubmissions
    });
  } catch (error) {
    console.error('Get Assignments Error:', error);
    res.status(500).json({ message: error.message });
  }
};

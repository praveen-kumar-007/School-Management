import ForumPost from '../models/ForumPost.js';
import StudentGoal from '../models/StudentGoal.js';
import StudentNote from '../models/StudentNote.js';
import { deleteCacheByPrefix, getCache, setCache } from '../utils/cache.js';
import { emitCourseSync, emitStudentSync } from '../utils/realtime.js';

const studentCachePrefix = (mongoUserId) => `student:${mongoUserId}:`;

const invalidateStudentCache = async (mongoUserId) => {
  await deleteCacheByPrefix(studentCachePrefix(mongoUserId));
};

const toNoteDto = (note) => ({
  id: note._id.toString(),
  courseId: note.course?._id?.toString?.() || note.course?.toString?.() || null,
  courseTitle: note.courseTitle || note.course?.title || 'Course',
  note: note.note,
  highlight: note.highlight || '',
  createdAt: note.createdAt,
  updatedAt: note.updatedAt
});

const toGoalDto = (goal) => ({
  id: goal._id.toString(),
  title: goal.title,
  milestone: goal.milestone,
  progress: Number(goal.progress || 0),
  completed: !!goal.completed,
  createdAt: goal.createdAt,
  updatedAt: goal.updatedAt
});

const toReplyDto = (reply) => ({
  id: reply._id.toString(),
  authorId: reply.student?._id?.toString?.() || reply.student?.toString?.() || null,
  author: reply.student?.name || 'Student',
  message: reply.message,
  createdAt: reply.createdAt,
  updatedAt: reply.updatedAt
});

const toForumPostDto = (post) => ({
  id: post._id.toString(),
  courseId: post.course?._id?.toString?.() || post.course?.toString?.() || null,
  courseTitle: post.courseTitle || post.course?.title || 'Course',
  authorId: post.student?._id?.toString?.() || post.student?.toString?.() || null,
  author: post.student?.name || 'Student',
  message: post.message,
  upvotes: Number(post.upvotes || 0),
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  replies: (post.replies || []).map(toReplyDto)
});

export const listNotes = async (req, res) => {
  try {
    const cacheKey = `${studentCachePrefix(req.user.id)}notes:${req.query.courseId || 'all'}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, notes: cached, cached: true });
    }

    const filter = { student: req.user.id };
    if (req.query.courseId) {
      filter.course = req.query.courseId;
    }

    const notes = await StudentNote.find(filter)
      .populate('course', 'title')
      .sort({ updatedAt: -1 })
      .lean();

    const payload = notes.map(toNoteDto);
    await setCache(cacheKey, payload, 30);

    return res.status(200).json({ success: true, notes: payload });
  } catch (error) {
    console.error('List Notes Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createNote = async (req, res) => {
  try {
    const { courseId, courseTitle, note, highlight } = req.body;

    const created = await StudentNote.create({
      student: req.user.id,
      course: courseId || undefined,
      courseTitle: courseTitle || '',
      note,
      highlight: highlight || ''
    });

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.note.created', { noteId: created._id.toString(), courseId });

    const hydrated = await StudentNote.findById(created._id).populate('course', 'title').lean();

    return res.status(201).json({ success: true, note: toNoteDto(hydrated) });
  } catch (error) {
    console.error('Create Note Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateNote = async (req, res) => {
  try {
    const note = await StudentNote.findOne({ _id: req.params.id, student: req.user.id });

    if (!note) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    note.note = req.body.note ?? note.note;
    note.highlight = req.body.highlight ?? note.highlight;
    await note.save();

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.note.updated', { noteId: note._id.toString() });

    const hydrated = await StudentNote.findById(note._id).populate('course', 'title').lean();

    return res.status(200).json({ success: true, note: toNoteDto(hydrated) });
  } catch (error) {
    console.error('Update Note Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteNote = async (req, res) => {
  try {
    const deleted = await StudentNote.deleteOne({ _id: req.params.id, student: req.user.id });

    if (!deleted.deletedCount) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.note.deleted', { noteId: req.params.id });

    return res.status(200).json({ success: true, message: 'Note deleted' });
  } catch (error) {
    console.error('Delete Note Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listGoals = async (req, res) => {
  try {
    const cacheKey = `${studentCachePrefix(req.user.id)}goals`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, goals: cached, cached: true });
    }

    const goals = await StudentGoal.find({ student: req.user.id }).sort({ updatedAt: -1 }).lean();
    const payload = goals.map(toGoalDto);

    await setCache(cacheKey, payload, 30);

    return res.status(200).json({ success: true, goals: payload });
  } catch (error) {
    console.error('List Goals Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createGoal = async (req, res) => {
  try {
    const goal = await StudentGoal.create({
      student: req.user.id,
      title: req.body.title,
      milestone: req.body.milestone,
      progress: req.body.progress || 0,
      completed: !!req.body.completed
    });

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.goal.created', { goalId: goal._id.toString() });

    return res.status(201).json({ success: true, goal: toGoalDto(goal.toObject()) });
  } catch (error) {
    console.error('Create Goal Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateGoal = async (req, res) => {
  try {
    const goal = await StudentGoal.findOne({ _id: req.params.id, student: req.user.id });

    if (!goal) {
      return res.status(404).json({ success: false, message: 'Goal not found' });
    }

    goal.title = req.body.title ?? goal.title;
    goal.milestone = req.body.milestone ?? goal.milestone;
    if (req.body.progress !== undefined) {
      goal.progress = Math.max(0, Math.min(100, Number(req.body.progress)));
      goal.completed = goal.progress >= 100;
    }
    if (req.body.completed !== undefined) {
      goal.completed = !!req.body.completed;
    }
    await goal.save();

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.goal.updated', { goalId: goal._id.toString() });

    return res.status(200).json({ success: true, goal: toGoalDto(goal.toObject()) });
  } catch (error) {
    console.error('Update Goal Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteGoal = async (req, res) => {
  try {
    const deleted = await StudentGoal.deleteOne({ _id: req.params.id, student: req.user.id });

    if (!deleted.deletedCount) {
      return res.status(404).json({ success: false, message: 'Goal not found' });
    }

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.goal.deleted', { goalId: req.params.id });

    return res.status(200).json({ success: true, message: 'Goal deleted' });
  } catch (error) {
    console.error('Delete Goal Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listForumPosts = async (req, res) => {
  try {
    const courseId = req.query.courseId || 'all';
    const cacheKey = `${studentCachePrefix(req.user.id)}forum:${courseId}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, posts: cached, cached: true });
    }

    const filter = {};
    if (req.query.courseId) {
      filter.course = req.query.courseId;
    }

    const posts = await ForumPost.find(filter)
      .populate('student', 'name email')
      .populate('course', 'title')
      .populate('replies.student', 'name email')
      .sort({ updatedAt: -1 })
      .lean();

    const payload = posts.map(toForumPostDto);
    await setCache(cacheKey, payload, 20);

    return res.status(200).json({ success: true, posts: payload });
  } catch (error) {
    console.error('List Forum Posts Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createForumPost = async (req, res) => {
  try {
    const post = await ForumPost.create({
      student: req.user.id,
      course: req.body.courseId || undefined,
      courseTitle: req.body.courseTitle || '',
      message: req.body.message,
      upvotes: 0
    });

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.forum.created', { postId: post._id.toString() });
    if (req.body.courseId) {
      emitCourseSync(req.body.courseId, 'course.forum.created', { postId: post._id.toString() });
    }

    const hydrated = await ForumPost.findById(post._id)
      .populate('student', 'name email')
      .populate('course', 'title')
      .populate('replies.student', 'name email')
      .lean();

    return res.status(201).json({ success: true, post: toForumPostDto(hydrated) });
  } catch (error) {
    console.error('Create Forum Post Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateForumPost = async (req, res) => {
  try {
    const post = await ForumPost.findOne({ _id: req.params.id, student: req.user.id });

    if (!post) {
      return res.status(404).json({ success: false, message: 'Forum post not found' });
    }

    post.message = req.body.message ?? post.message;
    await post.save();

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.forum.updated', { postId: post._id.toString() });
    if (post.course) {
      emitCourseSync(post.course.toString(), 'course.forum.updated', { postId: post._id.toString() });
    }

    const hydrated = await ForumPost.findById(post._id)
      .populate('student', 'name email')
      .populate('course', 'title')
      .populate('replies.student', 'name email')
      .lean();

    return res.status(200).json({ success: true, post: toForumPostDto(hydrated) });
  } catch (error) {
    console.error('Update Forum Post Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteForumPost = async (req, res) => {
  try {
    const post = await ForumPost.findOne({ _id: req.params.id, student: req.user.id });

    if (!post) {
      return res.status(404).json({ success: false, message: 'Forum post not found' });
    }

    const courseId = post.course?.toString();
    await post.deleteOne();

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.forum.deleted', { postId: req.params.id });
    if (courseId) {
      emitCourseSync(courseId, 'course.forum.deleted', { postId: req.params.id });
    }

    return res.status(200).json({ success: true, message: 'Forum post deleted' });
  } catch (error) {
    console.error('Delete Forum Post Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const addForumReply = async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Forum post not found' });
    }

    post.replies.push({
      student: req.user.id,
      message: req.body.message
    });
    await post.save();

    const createdReply = post.replies[post.replies.length - 1];

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.forum.reply.created', {
      postId: post._id.toString(),
      replyId: createdReply._id.toString()
    });
    if (post.course) {
      emitCourseSync(post.course.toString(), 'course.forum.reply.created', {
        postId: post._id.toString(),
        replyId: createdReply._id.toString()
      });
    }

    const hydratedPost = await ForumPost.findById(post._id)
      .populate('replies.student', 'name email')
      .lean();
    const hydratedReply = hydratedPost?.replies?.find((reply) => reply._id.toString() === createdReply._id.toString());

    return res.status(201).json({ success: true, reply: toReplyDto(hydratedReply) });
  } catch (error) {
    console.error('Add Forum Reply Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteForumReply = async (req, res) => {
  try {
    const post = await ForumPost.findOne({ 'replies._id': req.params.replyId });

    if (!post) {
      return res.status(404).json({ success: false, message: 'Reply not found' });
    }

    const reply = post.replies.id(req.params.replyId);
    if (!reply) {
      return res.status(404).json({ success: false, message: 'Reply not found' });
    }

    if (reply.student.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this reply' });
    }

    reply.deleteOne();
    await post.save();

    await invalidateStudentCache(req.user.id);
    emitStudentSync(req.user.id, 'student.forum.reply.deleted', { replyId: req.params.replyId });

    return res.status(200).json({ success: true, message: 'Reply deleted' });
  } catch (error) {
    console.error('Delete Forum Reply Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const upvoteForumPost = async (req, res) => {
  try {
    const post = await ForumPost.findById(req.params.id)
      .populate('student', 'name email')
      .populate('course', 'title')
      .populate('replies.student', 'name email');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Forum post not found' });
    }

    post.upvotes += 1;
    await post.save();

    if (post.course) {
      emitCourseSync(post.course._id.toString(), 'course.forum.upvoted', {
        postId: post._id.toString(),
        upvotes: post.upvotes
      });
    }

    return res.status(200).json({
      success: true,
      upvotes: post.upvotes,
      post: toForumPostDto(post.toObject())
    });
  } catch (error) {
    console.error('Upvote Forum Post Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const syncStudentState = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : null;
    const hasSince = since && !Number.isNaN(since.getTime());
    const timeFilter = hasSince ? { updatedAt: { $gte: since } } : {};

    const [notesRaw, goalsRaw, postsRaw] = await Promise.all([
      StudentNote.find({ student: req.user.id, ...timeFilter })
        .populate('course', 'title')
        .sort({ updatedAt: -1 })
        .lean(),
      StudentGoal.find({ student: req.user.id, ...timeFilter })
        .sort({ updatedAt: -1 })
        .lean(),
      ForumPost.find(timeFilter)
        .populate('student', 'name email')
        .populate('course', 'title')
        .populate('replies.student', 'name email')
        .sort({ updatedAt: -1 })
        .lean()
    ]);

    const notes = notesRaw.map(toNoteDto);
    const goals = goalsRaw.map(toGoalDto);
    const posts = postsRaw.map(toForumPostDto);

    const replies = posts.flatMap((post) =>
      (post.replies || []).map((reply) => ({
        ...reply,
        postId: post.id,
        courseId: post.courseId,
        courseTitle: post.courseTitle
      }))
    );

    return res.status(200).json({
      success: true,
      sync: {
        notes,
        goals,
        posts,
        replies,
        serverTimestamp: new Date().toISOString(),
        since: hasSince ? since.toISOString() : null
      }
    });
  } catch (error) {
    console.error('Sync Student State Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

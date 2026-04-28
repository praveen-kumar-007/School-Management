import Course from '../models/Course.js';
import User from '../models/User.js';

export const globalSearch = async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const scope = String(req.query.scope || 'all').toLowerCase();
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query parameter q is required' });
    }

    const regex = new RegExp(query, 'i');
    const role = req.user?.role || 'student';

    const results = {
      teachers: [],
      students: [],
      courses: [],
      lessons: [],
      materials: []
    };

    const includeTeacher = role === 'admin' || role === 'teacher';
    const includeStudent = role === 'admin' || role === 'teacher';
    const includeCourse = true;

    const filteredScope = scope === 'all' ? ['teachers', 'students', 'courses', 'lessons', 'materials'] : scope.split(',').map((item) => item.trim());

    if (includeTeacher && filteredScope.includes('teachers')) {
      results.teachers = await User.find({
        role: 'teacher',
        $or: [
          { name: { $regex: regex } },
          { email: { $regex: regex } }
        ]
      })
        .select('name email role')
        .limit(10)
        .lean();
    }

    if (includeStudent && filteredScope.includes('students')) {
      results.students = await User.find({
        role: 'student',
        $or: [
          { name: { $regex: regex } },
          { email: { $regex: regex } }
        ]
      })
        .select('name email role')
        .limit(10)
        .lean();
    }

    if (includeCourse && filteredScope.includes('courses')) {
      const courseFilter = {
        $or: [
          { title: { $regex: regex } },
          { description: { $regex: regex } },
          { category: { $regex: regex } }
        ]
      };

      if (role === 'teacher') {
        courseFilter.instructor = req.user.id;
      }

      results.courses = await Course.find(courseFilter)
        .select('title description category level instructor')
        .limit(10)
        .lean();
    }

    if (filteredScope.includes('lessons') || filteredScope.includes('materials')) {
      const courseQuery = role === 'teacher'
        ? { instructor: req.user.id }
        : role === 'student'
          ? { students: req.user.id }
          : {};

      const courses = await Course.find(courseQuery)
        .select('title modules')
        .lean();

      courses.forEach((course) => {
        (course.modules || []).forEach((module) => {
          (module.lessons || []).forEach((lesson) => {
            if (filteredScope.includes('lessons') && (regex.test(lesson.title || '') || regex.test(lesson.content || ''))) {
              results.lessons.push({
                courseId: course._id,
                courseTitle: course.title,
                module: module.title,
                lessonTitle: lesson.title || 'Untitled',
                lessonId: lesson._id || null
              });
            }

            if (filteredScope.includes('materials') && ((lesson.title && regex.test(lesson.title)) || (lesson.content && regex.test(lesson.content)))) {
              results.materials.push({
                courseId: course._id,
                courseTitle: course.title,
                module: module.title,
                lessonTitle: lesson.title || 'Untitled'
              });
            }
          });
        });
      });

      results.lessons = results.lessons.slice(0, 10);
      results.materials = results.materials.slice(0, 10);
    }

    return res.status(200).json({ success: true, query, results });
  } catch (error) {
    console.error('Global search error:', error);
    return res.status(500).json({ success: false, message: 'Failed to perform global search' });
  }
};

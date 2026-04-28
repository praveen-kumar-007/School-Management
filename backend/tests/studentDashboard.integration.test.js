import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import studentDashboardRoutes from '../src/routes/studentDashboardRoutes.js';
import errorHandler from '../src/middleware/errorHandler.js';
import { sequelize, syncSqlModels } from '../src/sql/models/index.js';

const app = express();
app.use(express.json());
app.use('/api/student-dashboard', studentDashboardRoutes);
app.use(errorHandler);

const buildToken = (overrides = {}) => {
  const payload = {
    id: 'student-mongo-1',
    email: 'student1@example.com',
    role: 'student',
    name: 'Student One',
    ...overrides
  };
  return jwt.sign(payload, process.env.JWT_SECRET);
};

describe('Student Dashboard API Integration', () => {
  let token;

  beforeAll(async () => {
    token = buildToken();
    await syncSqlModels({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('should create and list notes', async () => {
    const createResponse = await request(app)
      .post('/api/student-dashboard/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        courseId: 'mongo-course-1',
        courseTitle: 'Course One',
        note: 'My first note',
        highlight: 'Important topic'
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.success).toBe(true);

    const listResponse = await request(app)
      .get('/api/student-dashboard/notes')
      .set('Authorization', `Bearer ${token}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.notes)).toBe(true);
    expect(listResponse.body.notes.length).toBeGreaterThan(0);
  });

  test('should create and update goals', async () => {
    const createResponse = await request(app)
      .post('/api/student-dashboard/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Finish React course',
        milestone: 'Complete modules 1-3',
        progress: 20
      });

    expect(createResponse.status).toBe(201);
    const goalId = createResponse.body.goal.id;

    const updateResponse = await request(app)
      .put(`/api/student-dashboard/goals/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ progress: 100 });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.goal.completed).toBe(true);
  });

  test('should create forum post, reply and upvote', async () => {
    const createPostResponse = await request(app)
      .post('/api/student-dashboard/forums/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        courseId: 'mongo-course-2',
        courseTitle: 'Course Two',
        message: 'Hello forum!'
      });

    expect(createPostResponse.status).toBe(201);
    const postId = createPostResponse.body.post.id;

    const replyResponse = await request(app)
      .post(`/api/student-dashboard/forums/posts/${postId}/replies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'My reply' });

    expect(replyResponse.status).toBe(201);

    const upvoteResponse = await request(app)
      .post(`/api/student-dashboard/forums/posts/${postId}/upvote`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(upvoteResponse.status).toBe(200);
    expect(upvoteResponse.body.upvotes).toBe(1);
  });

  test('should enforce student-only role access', async () => {
    const teacherToken = buildToken({ role: 'teacher' });

    const response = await request(app)
      .get('/api/student-dashboard/goals')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(response.status).toBe(403);
  });
});

import {
  generateStudyPlan,
  solveDoubt,
  summarizeNotesText,
  summarizePdfFile
} from '../services/aiService.js';
import { logAuditEvent } from '../utils/auditLogger.js';

export const doubtSolver = async (req, res) => {
  try {
    const { question, context } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, message: 'question is required' });
    }

    const answer = await solveDoubt({ question, context });

    await logAuditEvent(req, {
      action: 'ai.doubt_solver',
      targetType: 'ai',
      metadata: {
        questionLength: question.length
      }
    });

    res.status(200).json({
      success: true,
      question,
      answer
    });
  } catch (error) {
    console.error('AI Doubt Solver Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const summarizeNotes = async (req, res) => {
  try {
    const { text, maxBullets = 6 } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length < 30) {
      return res.status(400).json({ success: false, message: 'text is required (min 30 characters)' });
    }

    const result = await summarizeNotesText({ text, maxBullets });

    await logAuditEvent(req, {
      action: 'ai.notes_summarizer.text',
      targetType: 'ai',
      metadata: {
        sourceLength: result.sourceLength
      }
    });

    res.status(200).json({
      success: true,
      summary: result.summary,
      sourceLength: result.sourceLength
    });
  } catch (error) {
    console.error('AI Text Summary Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const summarizePdfNotes = async (req, res) => {
  try {
    const maxBullets = Number(req.body?.maxBullets || 6);
    const pdfFile = req.files?.pdf;

    if (!pdfFile) {
      return res.status(400).json({ success: false, message: 'PDF file is required as field: pdf' });
    }

    const mimeType = pdfFile.mimetype || '';
    if (mimeType && mimeType !== 'application/pdf') {
      return res.status(400).json({ success: false, message: 'Only PDF is supported' });
    }

    const result = await summarizePdfFile({
      filePath: pdfFile.tempFilePath,
      maxBullets
    });

    await logAuditEvent(req, {
      action: 'ai.notes_summarizer.pdf',
      targetType: 'ai',
      metadata: {
        pageCount: result.pageCount,
        sourceLength: result.sourceLength
      }
    });

    res.status(200).json({
      success: true,
      summary: result.summary,
      sourceLength: result.sourceLength,
      pageCount: result.pageCount
    });
  } catch (error) {
    console.error('AI PDF Summary Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const studyPlanner = async (req, res) => {
  try {
    const {
      subjects = [],
      weakTopics = [],
      hoursPerDay = 2,
      planDays = 7,
      examDate = null
    } = req.body;

    const plan = await generateStudyPlan({
      subjects,
      weakTopics,
      hoursPerDay,
      planDays,
      examDate
    });

    await logAuditEvent(req, {
      action: 'ai.study_planner',
      targetType: 'ai',
      metadata: {
        planDays: Number(planDays) || 7,
        hoursPerDay: Number(hoursPerDay) || 2,
        subjectCount: Array.isArray(subjects) ? subjects.length : 0
      }
    });

    res.status(200).json({
      success: true,
      plan: plan.planText,
      dailyPlan: plan.dailyPlan || null,
      meta: plan.meta
    });
  } catch (error) {
    console.error('AI Study Planner Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

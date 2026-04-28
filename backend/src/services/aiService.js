import fs from 'fs/promises';

const hasExternalAiConfig = () => {
  return Boolean(process.env.AI_API_KEY && process.env.AI_API_URL);
};

const defaultModel = process.env.AI_MODEL || 'gpt-4o-mini';

const callExternalAi = async ({ systemPrompt, userPrompt }) => {
  if (!hasExternalAiConfig()) {
    return null;
  }

  const response = await fetch(process.env.AI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.AI_API_KEY}`
    },
    body: JSON.stringify({
      model: defaultModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 700
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || null;
};

const splitSentences = (text) => {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const summarizeByFrequency = (text, sentenceCount = 5) => {
  const sentences = splitSentences(text);
  if (!sentences.length) {
    return [];
  }

  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const frequencies = words.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {});

  const scored = sentences.map((sentence, index) => {
    const sentenceWords = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const score = sentenceWords.reduce((sum, word) => sum + (frequencies[word] || 0), 0);
    return { sentence, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, sentenceCount))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
};

export const solveDoubt = async ({ question, context = '' }) => {
  const systemPrompt = 'You are an educational doubt solver. Explain clearly with steps, examples, and concise tips.';
  const userPrompt = `Student question: ${question}\n\nContext: ${context || 'No extra context'}\n\nProvide:\n1) Direct answer\n2) Step-by-step explanation\n3) One quick example\n4) 2 follow-up practice questions.`;

  const aiAnswer = await callExternalAi({ systemPrompt, userPrompt });
  if (aiAnswer) {
    return aiAnswer;
  }

  return [
    `Direct Answer: ${question}`,
    'Step-by-step: Break the problem into concepts, identify what is known, apply the core rule, and verify the result.',
    `Example: Use a small sample input for "${question}" and check expected output manually.`,
    'Practice 1: Solve the same type with different values.',
    'Practice 2: Explain the concept in your own words in 3-5 lines.'
  ].join('\n');
};

export const summarizeNotesText = async ({ text, maxBullets = 6 }) => {
  const safeBullets = Math.min(Math.max(Number(maxBullets) || 6, 3), 12);

  const systemPrompt = 'You summarize study notes into crisp bullet points for students.';
  const userPrompt = `Summarize the following notes into ${safeBullets} concise bullets and a short revision checklist:\n\n${text}`;

  const aiSummary = await callExternalAi({ systemPrompt, userPrompt });
  if (aiSummary) {
    return {
      summary: aiSummary,
      sourceLength: String(text || '').length
    };
  }

  const bullets = summarizeByFrequency(text, safeBullets).map((line) => `- ${line}`);
  const fallback = [
    'Short Notes:',
    ...bullets,
    '',
    'Revision Checklist:',
    '- Review key definitions',
    '- Solve 3 practice questions',
    '- Revise weak topics once more before test'
  ].join('\n');

  return {
    summary: fallback,
    sourceLength: String(text || '').length
  };
};

export const summarizePdfFile = async ({ filePath, maxBullets = 6 }) => {
  const pdfParse = (await import('pdf-parse')).default;
  const fileBuffer = await fs.readFile(filePath);
  const parsed = await pdfParse(fileBuffer);
  const rawText = parsed?.text || '';

  const result = await summarizeNotesText({
    text: rawText,
    maxBullets
  });

  return {
    ...result,
    pageCount: parsed?.numpages || 0
  };
};

export const generateStudyPlan = async ({
  subjects = [],
  weakTopics = [],
  hoursPerDay = 2,
  planDays = 7,
  examDate = null
}) => {
  const safeDays = Math.min(Math.max(Number(planDays) || 7, 1), 30);
  const safeHours = Math.min(Math.max(Number(hoursPerDay) || 2, 1), 12);

  const subjectList = Array.isArray(subjects) ? subjects.filter(Boolean) : [];
  const weakList = Array.isArray(weakTopics) ? weakTopics.filter(Boolean) : [];

  const systemPrompt = 'You are a study coach that creates realistic daily plans for students.';
  const userPrompt = `Create a ${safeDays}-day plan with ${safeHours} hours/day.\nSubjects: ${subjectList.join(', ') || 'General study'}\nWeak topics: ${weakList.join(', ') || 'None'}\nExam date: ${examDate || 'Not provided'}\nReturn concise day-wise tasks.`;

  const aiPlan = await callExternalAi({ systemPrompt, userPrompt });
  if (aiPlan) {
    return {
      planText: aiPlan,
      meta: { hoursPerDay: safeHours, planDays: safeDays }
    };
  }

  const allTopics = [...weakList, ...subjectList.filter((item) => !weakList.includes(item))];
  const topics = allTopics.length ? allTopics : ['Revision', 'Practice Questions', 'Mock Test'];

  const dailyPlan = Array.from({ length: safeDays }).map((_, index) => {
    const focusTopic = topics[index % topics.length];
    const reviewTopic = topics[(index + 1) % topics.length];

    return {
      day: index + 1,
      tasks: [
        `Concept review (${Math.ceil(safeHours * 0.4)}h): ${focusTopic}`,
        `Practice (${Math.ceil(safeHours * 0.4)}h): ${focusTopic} problems`,
        `Quick revision (${Math.max(1, Math.floor(safeHours * 0.2))}h): ${reviewTopic}`
      ]
    };
  });

  return {
    planText: dailyPlan.map((item) => `Day ${item.day}:\n- ${item.tasks.join('\n- ')}`).join('\n\n'),
    dailyPlan,
    meta: { hoursPerDay: safeHours, planDays: safeDays }
  };
};

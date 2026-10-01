import { DIFFICULTIES, TOPICS } from '#shared/types/interview'
import type { AnalyzeRequest, AnalyzeResponse, Question } from '#shared/types/interview'

const SYSTEM = `You are a senior engineer conducting a technical interview about a candidate's own GitHub project.
You have the project's README, file tree and key source files. Write questions that only the person who wrote this code could answer well.

Rules:
- Every question must reference something concrete in the provided source: a specific function, file, data structure, control flow, config value, error path or dependency choice. Name it.
- Do not ask generic framework or language trivia ("what is a Vue component?", "explain async/await").
- Mix topics: architecture, decisions, debugging, tradeoffs, implementation. Use each topic at least once.
- Mix difficulty: roughly 3 easy, 4 medium, 3 hard.
- "debugging" questions should pose a plausible failure in THIS code and ask how they'd trace or fix it.
- "tradeoffs" and "decisions" questions should ask why the code does X rather than an obvious alternative.
- expectedPoints: 2-4 short, checkable facts a strong answer must mention, grounded in what the code actually does. Cite file names where useful.
- Write questions the way an interviewer speaks: one or two sentences, no preamble.`

const schema = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      minItems: 10,
      maxItems: 10,
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          topic: { type: 'STRING', enum: [...TOPICS] },
          difficulty: { type: 'STRING', enum: [...DIFFICULTIES] },
          expectedPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['question', 'topic', 'difficulty', 'expectedPoints'],
        propertyOrdering: ['topic', 'difficulty', 'question', 'expectedPoints'],
      },
    },
  },
  required: ['questions'],
}

export default defineEventHandler(async (event): Promise<AnalyzeResponse> => {
  const body = await readBody<Partial<AnalyzeRequest>>(event)
  if (!body?.repoUrl || typeof body.repoUrl !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'repoUrl is required.' })
  }

  const { owner, repo } = parseRepoUrl(body.repoUrl)
  const snapshot = await fetchRepoSnapshot(owner, repo)
  const codeContext = buildCodeContext(snapshot)

  const result = await generateJson<{ questions: Omit<Question, 'id'>[] }>({
    system: SYSTEM,
    prompt: `${codeContext}\n\nWrite exactly 10 interview questions about this codebase.`,
    schema,
  })

  const questions: Question[] = (result.questions ?? [])
    .filter((q) => q?.question && Array.isArray(q.expectedPoints))
    .slice(0, 10)
    .map((q, i) => ({
      id: `q${i + 1}`,
      question: q.question.trim(),
      topic: TOPICS.includes(q.topic) ? q.topic : 'implementation',
      difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium',
      expectedPoints: q.expectedPoints.filter(Boolean),
    }))

  if (questions.length === 0) {
    throw createError({ statusCode: 502, statusMessage: 'Gemini did not return any usable questions.' })
  }

  return {
    repoName: `${owner}/${repo}`,
    questions,
    codeContext,
    files: snapshot.files.map((f) => f.path),
  }
})

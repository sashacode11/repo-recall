import { DIFFICULTIES } from '#shared/types/interview'
import type { MockQuestion, MockQuestionsRequest, MockQuestionsResponse, StudyTopic } from '#shared/types/interview'

const QUESTION_COUNT = 10

const SYSTEM = `You are the interviewer for a live technical interview. The candidate has studied the topics below using the listed practice questions.
Write a ${QUESTION_COUNT}-question interview covering the same topics with NEW questions.

Rules:
- Do not reuse, reword or lightly vary any practice question. Each interview question must need a different piece of knowledge or a different angle (a scenario, a failure to debug, a design choice, a tradeoff under a constraint, "what happens when").
- Stay inside each topic's scope and its "what they probe" list; this tests the same ground, not new ground.
- Cover every topic at least once if there are ${QUESTION_COUNT} or fewer topics. Give earlier (more important) topics more questions.
- Mix difficulty: roughly 3 easy, 4 medium, 3 hard, calibrated to the seniority.
- Phrase each question the way an interviewer says it out loud: one or two sentences, no preamble, answerable in 1-3 minutes.
- expectedPoints: 2-5 short, checkable, correct technical facts a strong answer contains.
- topicId must be one of the given topic ids.`

const schema = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      minItems: QUESTION_COUNT,
      maxItems: QUESTION_COUNT,
      items: {
        type: 'OBJECT',
        properties: {
          topicId: { type: 'STRING' },
          difficulty: { type: 'STRING', enum: [...DIFFICULTIES] },
          question: { type: 'STRING' },
          expectedPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['topicId', 'difficulty', 'question', 'expectedPoints'],
        propertyOrdering: ['topicId', 'difficulty', 'question', 'expectedPoints'],
      },
    },
  },
  required: ['questions'],
}

function isTopic(t: unknown): t is StudyTopic {
  const x = t as StudyTopic
  return !!x && typeof x.id === 'string' && typeof x.topic === 'string' && Array.isArray(x.questions)
}

export default defineEventHandler(async (event): Promise<MockQuestionsResponse> => {
  const body = await readBody<Partial<MockQuestionsRequest>>(event)
  const plan = Array.isArray(body?.studyPlan) ? body.studyPlan.filter(isTopic).slice(0, 10) : []
  if (plan.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'studyPlan is required. Analyze a job description first.' })
  }

  const planText = plan
    .map((t) =>
      [
        `### ${t.id}: ${t.topic}`,
        `What they probe:\n${(t.whatTheyProbe ?? []).map((p) => `- ${p}`).join('\n')}`,
        `Practice questions already used (do not repeat):\n${t.questions.map((q) => `- ${q.question}`).join('\n')}`,
      ].join('\n'),
    )
    .join('\n\n')

  const role = [body?.roleTitle, body?.seniority && body.seniority !== 'unspecified' ? `(${body.seniority})` : '']
    .filter(Boolean)
    .join(' ')

  const raw = await generateJson<{ questions: Omit<MockQuestion, 'id'>[] }>({
    system: SYSTEM,
    prompt: `${role ? `Role: ${role}\n\n` : ''}${planText}\n\nWrite the ${QUESTION_COUNT} interview questions.`,
    schema,
    temperature: 0.7,
    thinkingBudget: 2048,
  })

  const topicIds = new Set(plan.map((t) => t.id))
  const used = new Set(plan.flatMap((t) => t.questions.map((q) => normalize(q.question))))
  const questions: MockQuestion[] = (raw.questions ?? [])
    .filter((q) => q?.question && topicIds.has(q.topicId) && !used.has(normalize(q.question)))
    .slice(0, QUESTION_COUNT)
    .map((q, i) => ({
      id: `m${i + 1}`,
      topicId: q.topicId,
      question: q.question.trim(),
      difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium',
      expectedPoints: (q.expectedPoints ?? []).filter(Boolean),
    }))

  if (questions.length < 5) {
    throw createError({ statusCode: 502, statusMessage: 'Gemini did not return enough usable interview questions. Try again.' })
  }

  return { questions }
})

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

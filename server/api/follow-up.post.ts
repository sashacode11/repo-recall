import type { FollowUpRequest, FollowUpResponse } from '#shared/types/interview'

const SYSTEM = `You are the interviewer in a live technical interview. The candidate just gave a weak answer. Ask ONE follow-up question that digs into what their answer was missing.

Rules:
- Target the single most important gap from the "missing" list - the one that best separates someone who understands the topic from someone who doesn't.
- Make it narrower and more concrete than the original question, the way a real interviewer probes: "You mentioned X - what actually happens when...", "How would that behave if...", "What would you use to guarantee...".
- Never reveal the answer, hint at it, or say what was missing. Never praise or criticise the previous answer.
- If earlier follow-ups are listed, dig somewhere new; do not re-ask them.
- One or two sentences, spoken style, no preamble.
- expectedPoints: 2-4 short, correct, checkable facts a strong answer to THIS follow-up contains.`

const schema = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    expectedPoints: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['question', 'expectedPoints'],
  propertyOrdering: ['question', 'expectedPoints'],
}

export default defineEventHandler(async (event): Promise<FollowUpResponse> => {
  const body = await readBody<Partial<FollowUpRequest>>(event)
  if (typeof body?.question !== 'string' || !body.question.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'question is required.' })
  }
  if (typeof body.jobContext !== 'string' || !body.jobContext.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'jobContext is required.' })
  }
  const missing = Array.isArray(body.missing) ? body.missing.filter((m) => typeof m === 'string') : []
  const previous = Array.isArray(body.previous) ? body.previous.slice(0, 5) : []

  const prompt = [
    body.jobContext.slice(0, 20_000),
    '',
    '---',
    `## Original question\n${body.question.trim()}`,
    `## Candidate answer\n"""\n${String(body.answer ?? '').slice(0, 6_000) || '(no answer)'}\n"""`,
    `## What the answer was missing\n${missing.length ? missing.map((m) => `- ${m}`).join('\n') : '(not listed)'}`,
    body.feedback ? `## Grader's note\n${body.feedback}` : '',
    previous.length
      ? `## Follow-ups already asked\n${previous.map((p, i) => `${i + 1}. Q: ${p.question}\n   A: ${p.answer || '(no answer)'}`).join('\n')}`
      : '',
    '',
    'Ask the follow-up.',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await generateJson<FollowUpResponse>({ system: SYSTEM, prompt, schema, temperature: 0.5, thinkingBudget: 0 })
  const question = String(result.question ?? '').trim()
  if (!question) {
    throw createError({ statusCode: 502, statusMessage: 'Gemini did not return a follow-up question.' })
  }
  return { question, expectedPoints: (result.expectedPoints ?? []).filter(Boolean) }
})

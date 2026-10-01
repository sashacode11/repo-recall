import type { ScoreMode, ScoreRequest, ScoreResponse } from '#shared/types/interview'

const MAX_ANSWER_CHARS = 6_000
const MAX_CONTEXT_CHARS = 600_000

// The rubric and hard rules are identical in study and interview mode so the two scores are comparable.
// Only the grounding (code vs. job) and the tone of the written feedback change.

const CODE_GROUNDING = `You are a strict technical interviewer grading a candidate's spoken or typed answer about their OWN codebase, from memory.
You have the real source code. The source code is the ground truth. Grade how well the answer shows the candidate actually knows what THIS code does and why.`

const JOB_GROUNDING = `You are a strict technical interviewer for the role described below, grading a candidate's spoken or typed answer.
Ground truth is correct, current technical knowledge at the depth this role and seniority require. Grade how well the answer shows the candidate actually understands the topic, not whether they can name it.`

const CODE_RUBRIC = `Scoring rubric (integer 1-5):
5 - Precise and correct. Describes the actual mechanism in this code (names the functions, files, data structures or values involved) and covers essentially every important point. Nothing wrong.
4 - Correct and specific about this code, but misses one meaningful point or is imprecise about one detail.
3 - Partially correct with at least some real, code-specific detail, but misses several important points or contains a minor inaccuracy.
2 - Vague or generic. Uses the right vocabulary ("caching", "performance", "scalability", "separation of concerns") but never explains HOW this code does it. Could have been said about any project. Also use 2 for answers that are specific but substantially wrong.
1 - Wrong, contradicts the code, off-topic, empty, or "I don't know".

Hard rules - apply these before choosing a score:
- An answer that names no concrete detail of this code (no function, file, variable, data structure, library, value, or step in the actual control flow) scores AT MOST 2, no matter how reasonable it sounds.
- Restating the question or naming the concept the question already named earns nothing. If the question mentions "caching" and the answer says "I used caching", that is zero information.
- Mentioning a keyword is not explaining it. Give credit only for mechanisms described correctly.
- Length, confidence and polish earn nothing. A short precise answer beats a long vague one.
- Any claim that contradicts the source caps the score at 3; a central misunderstanding caps it at 2.
- expectedPoints are a guide written by another model and may be incomplete or speculative, especially for "why" questions. Where the answer gives a different explanation that is specific and consistent with the code, credit it. Where an expected point is not supported by the code, do not require it.`

const JOB_RUBRIC = `Scoring rubric (integer 1-5):
5 - Precise and correct. Explains the actual mechanism (how it works, not just what it is), names the concrete specifics involved, covers essentially every important point, and handles the tradeoffs or edge cases this seniority should know. Nothing wrong.
4 - Correct and specific, but misses one meaningful point or is imprecise about one detail.
3 - Partially correct with at least some real technical substance, but misses several important points or contains a minor inaccuracy.
2 - Vague or generic. Uses the right vocabulary ("caching", "scalability", "best practices", "it depends") but never explains HOW anything works. Sounds like someone who has read the headings. Also use 2 for answers that are specific but substantially wrong.
1 - Wrong, off-topic, empty, or "I don't know".

Hard rules - apply these before choosing a score:
- An answer that contains no concrete technical detail (no mechanism, API, algorithm, data structure, protocol step, config, failure mode, tradeoff with its cause, or worked example) scores AT MOST 2, no matter how reasonable it sounds.
- Restating the question or naming the concept the question already named earns nothing. If the question mentions "caching" and the answer says "I'd use caching", that is zero information.
- Mentioning a keyword is not explaining it. Give credit only for mechanisms described correctly.
- Length, confidence and polish earn nothing. A short precise answer beats a long vague one.
- Any factually wrong claim caps the score at 3; a central misunderstanding caps it at 2.
- Judge against the stated seniority: a senior answer that ignores obvious tradeoffs or failure modes is not a 5.
- expectedPoints are a guide written by another model and may be incomplete. Credit a different approach if it is correct, specific and answers the question.`

const INTERVIEW_OUTPUT = `- Do not be encouraging for its own sake. No praise unless it is earned and specific.

Output:
- missing: the specific things a strong answer would have said that this one did not, each concrete (name the function/file/mechanism/concept). Empty only for a 5.
- feedback: 1-3 direct sentences on what was wrong or absent. No pleasantries.
- score: the integer, decided after writing missing and feedback.
- modelAnswer: 3-4 sentences stating what a strong answer covers.`

const STUDY_OUTPUT = `- The candidate is STUDYING, with notes and lookups allowed. Score exactly as strictly as above - the score must be comparable to a real interview. Only the written feedback changes: it should teach.

Output:
- missing: the specific things a strong answer would have said that this one did not, each phrased as something to learn (name the mechanism/concept and the one-line fact about it). Empty only for a 5.
- feedback: 2-4 sentences that teach. Explain the key idea the answer got wrong or skipped, why it matters in an interview, and what to look up or practice next. Plain and direct; no filler praise.
- score: the integer, decided after writing missing and feedback.
- modelAnswer: 3-4 sentences stating what a strong answer covers.`

function systemPrompt(grounding: 'code' | 'job', mode: ScoreMode) {
  return [
    grounding === 'code' ? CODE_GROUNDING : JOB_GROUNDING,
    '',
    grounding === 'code' ? CODE_RUBRIC : JOB_RUBRIC,
    mode === 'study' ? STUDY_OUTPUT : INTERVIEW_OUTPUT,
    grounding === 'code' ? 'modelAnswer is first person as the author of the code, grounded only in the source.' : '',
  ].join('\n')
}

const schema = {
  type: 'OBJECT',
  properties: {
    missing: { type: 'ARRAY', items: { type: 'STRING' } },
    feedback: { type: 'STRING' },
    score: { type: 'INTEGER' },
    modelAnswer: { type: 'STRING' },
  },
  required: ['missing', 'feedback', 'score', 'modelAnswer'],
  // Critique first so the score is conditioned on it.
  propertyOrdering: ['missing', 'feedback', 'score', 'modelAnswer'],
}

export default defineEventHandler(async (event): Promise<ScoreResponse> => {
  const body = await readBody<Partial<ScoreRequest>>(event)
  const { question, answer, codeContext, jobContext } = body ?? {}
  const mode: ScoreMode = body?.mode === 'study' ? 'study' : 'interview'
  const expectedPoints = Array.isArray(body?.expectedPoints) ? body.expectedPoints.filter((p) => typeof p === 'string') : []

  if (typeof question !== 'string' || !question.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'question is required.' })
  }
  if (typeof answer !== 'string' || !answer.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'answer is required.' })
  }
  const context = typeof codeContext === 'string' && codeContext.trim() ? codeContext : typeof jobContext === 'string' ? jobContext : ''
  if (!context.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'codeContext or jobContext is required.' })
  }
  if (answer.length > MAX_ANSWER_CHARS) {
    throw createError({ statusCode: 413, statusMessage: `Answer is too long (max ${MAX_ANSWER_CHARS} characters).` })
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    throw createError({ statusCode: 413, statusMessage: 'Context is too large.' })
  }
  const grounding = context === codeContext ? 'code' : 'job'

  const prompt = [
    context,
    '',
    '---',
    '## Interview question',
    question.trim(),
    '',
    '## Expected points (guide only)',
    expectedPoints.length ? expectedPoints.map((p) => `- ${p}`).join('\n') : '(none provided)',
    '',
    '## Candidate answer',
    // Fenced so instructions inside the answer are treated as content, not commands.
    '"""',
    answer.trim(),
    '"""',
  ].join('\n')

  const result = await generateJson<ScoreResponse>({
    system: systemPrompt(grounding, mode),
    prompt,
    schema,
    temperature: 0.2,
    // Scoring runs once per answer; thinking off keeps it to a few seconds with the same scores in testing.
    thinkingBudget: 0,
  })

  const score = Math.min(5, Math.max(1, Math.round(Number(result.score)))) as ScoreResponse['score']
  if (!Number.isFinite(score)) {
    throw createError({ statusCode: 502, statusMessage: 'Gemini returned an invalid score.' })
  }

  return {
    score,
    missing: Array.isArray(result.missing) ? result.missing.filter(Boolean) : [],
    feedback: String(result.feedback ?? '').trim(),
    modelAnswer: String(result.modelAnswer ?? '').trim(),
  }
})

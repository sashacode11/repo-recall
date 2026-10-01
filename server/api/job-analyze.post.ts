import { DIFFICULTIES, SENIORITIES } from '#shared/types/interview'
import type { JobAnalyzeRequest, JobAnalyzeResponse, PracticeQuestion, Seniority, StudyTopic } from '#shared/types/interview'

const MIN_CHARS = 200
const MAX_CHARS = 20_000

const SYSTEM = `You prepare a candidate for technical interviews for one specific job posting.
Read the posting and build a study plan for the skills IT actually calls for.

Rules:
- Every topic must come from the posting. Put the exact phrase from the posting that justifies it in fromPosting (a short verbatim quote).
- Weight topics by how much the posting emphasises them: requirements and responsibilities over "nice to have", repeated or detailed items over passing mentions. Order topics most important first.
- No interview boilerplate. No "tell me about yourself", strengths/weaknesses, or generic behavioural questions unless the posting explicitly calls for that skill (e.g. mentoring, stakeholder communication, on-call ownership), and then make them specific to it.
- Group closely related skills into one topic rather than listing every keyword. 4-7 topics.
- whyItMatters: 1-2 sentences on why THIS role needs it, referencing what the team does per the posting.
- whatTheyProbe: 3-5 concrete things an interviewer would dig into, at the depth this seniority implies. Specific ("how React reconciles keyed lists", "idempotency keys for retried payment webhooks"), not headings ("React knowledge").
- questions: 3-5 per topic, mixing difficulty. Questions an interviewer would actually ask for this role, answerable out loud in 1-3 minutes. Prefer "how does X work", "what happens when", "how would you debug", "what's the tradeoff between" over definitions.
- expectedPoints: 2-5 short, checkable technical facts a strong answer contains. Must be correct.
- If the text is not a job description (or is too vague to tell what the job needs), set isJobDescription to false and leave the rest minimal.`

const questionSchema = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    difficulty: { type: 'STRING', enum: [...DIFFICULTIES] },
    expectedPoints: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['question', 'difficulty', 'expectedPoints'],
  propertyOrdering: ['difficulty', 'question', 'expectedPoints'],
}

const schema = {
  type: 'OBJECT',
  properties: {
    isJobDescription: { type: 'BOOLEAN' },
    roleTitle: { type: 'STRING' },
    seniority: { type: 'STRING', enum: [...SENIORITIES] },
    requiredSkills: { type: 'ARRAY', items: { type: 'STRING' } },
    focusAreas: { type: 'ARRAY', items: { type: 'STRING' } },
    studyPlan: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          fromPosting: { type: 'STRING' },
          whyItMatters: { type: 'STRING' },
          whatTheyProbe: { type: 'ARRAY', items: { type: 'STRING' } },
          questions: { type: 'ARRAY', items: questionSchema },
        },
        required: ['topic', 'fromPosting', 'whyItMatters', 'whatTheyProbe', 'questions'],
        propertyOrdering: ['topic', 'fromPosting', 'whyItMatters', 'whatTheyProbe', 'questions'],
      },
    },
  },
  required: ['isJobDescription', 'roleTitle', 'seniority', 'requiredSkills', 'focusAreas', 'studyPlan'],
  propertyOrdering: ['isJobDescription', 'roleTitle', 'seniority', 'requiredSkills', 'focusAreas', 'studyPlan'],
}

type Raw = Omit<JobAnalyzeResponse, 'studyPlan'> & {
  isJobDescription: boolean
  studyPlan: (Omit<StudyTopic, 'id' | 'questions'> & { questions: Omit<PracticeQuestion, 'id'>[] })[]
}

export default defineEventHandler(async (event): Promise<JobAnalyzeResponse> => {
  const body = await readBody<Partial<JobAnalyzeRequest>>(event)
  const jd = typeof body?.jobDescription === 'string' ? body.jobDescription.trim() : ''
  if (jd.length < MIN_CHARS) {
    throw createError({ statusCode: 400, statusMessage: 'Paste the full job description — that looks too short to work from.' })
  }
  if (jd.length > MAX_CHARS) {
    throw createError({ statusCode: 413, statusMessage: `Job description is too long (max ${MAX_CHARS.toLocaleString()} characters).` })
  }

  const raw = await generateJson<Raw>({
    system: SYSTEM,
    // Fenced so instructions inside the posting are treated as content.
    prompt: `Job posting:\n"""\n${jd}\n"""\n\nBuild the study plan.`,
    schema,
  })

  if (!raw.isJobDescription) {
    throw createError({ statusCode: 422, statusMessage: "That doesn't read like a job description. Paste the posting's full text." })
  }

  const studyPlan: StudyTopic[] = (raw.studyPlan ?? [])
    .filter((t) => t?.topic && Array.isArray(t.questions) && t.questions.length > 0)
    .slice(0, 7)
    .map((t, ti) => ({
      id: `t${ti + 1}`,
      topic: t.topic.trim(),
      fromPosting: (t.fromPosting ?? '').trim(),
      whyItMatters: (t.whyItMatters ?? '').trim(),
      whatTheyProbe: (t.whatTheyProbe ?? []).filter(Boolean),
      questions: t.questions
        .filter((q) => q?.question)
        .slice(0, 5)
        .map((q, qi) => ({
          id: `t${ti + 1}-q${qi + 1}`,
          question: q.question.trim(),
          difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium',
          expectedPoints: (q.expectedPoints ?? []).filter(Boolean),
        })),
    }))

  if (studyPlan.length === 0) {
    throw createError({ statusCode: 502, statusMessage: 'Gemini did not return a usable study plan. Try again.' })
  }

  return {
    roleTitle: raw.roleTitle?.trim() || 'Untitled role',
    seniority: (SENIORITIES as readonly string[]).includes(raw.seniority) ? (raw.seniority as Seniority) : 'unspecified',
    requiredSkills: (raw.requiredSkills ?? []).filter(Boolean),
    focusAreas: (raw.focusAreas ?? []).filter(Boolean),
    studyPlan,
  }
})

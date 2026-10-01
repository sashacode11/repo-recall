import type { JobAnalyzeResponse, MockQuestion, ScoreResponse, Seniority, StudyTopic } from '#shared/types/interview'

export interface StudyRecord {
  answer: string
  result: ScoreResponse
}

/** One answer in the mock interview, to a main question or a follow-up. */
export interface MockResponse {
  /** Typed text, or the Gemini transcript for a spoken answer. Empty if skipped or timed out. */
  answer: string
  via: 'text' | 'voice'
  secondsUsed: number
  timedOut: boolean
  leftTab: boolean
  result?: ScoreResponse
  /** Set when the answer couldn't be scored (or transcribed); it is left out of averages. */
  error?: string
}

export interface FollowUpRecord {
  question: string
  expectedPoints: string[]
  response?: MockResponse
}

export interface MockRecord extends MockResponse {
  /** Up to MAX_FOLLOW_UPS probes asked after a weak answer. Not counted in the interview score. */
  followUps?: FollowUpRecord[]
  /** Follow-up generation failed; the interview moves on without more follow-ups. */
  followUpError?: string
}

export interface MockAttempt {
  id: string
  questions: MockQuestion[]
  answers: Record<string, MockRecord>
  current: number
  /** Answer by voice (Gemini transcription) instead of typing. */
  voice?: boolean
  /** When the current turn's timer started; null while the question is being read out. Survives reloads. */
  questionStartedAt: number | null
  /** Turn key of a recording in progress. Recording commits the answer, so a reload mid-recording scores it as interrupted. */
  recordingTurn?: string | null
  leftTabCurrent: boolean
  finishedAt?: number
}

export const MAX_FOLLOW_UPS = 2
export const FOLLOW_UP_THRESHOLD = 3
export const FOLLOW_UP_SECONDS = 90

/** One question the candidate is (or was) answering: a main question or one of its follow-ups. */
export interface Turn {
  key: string
  parent: MockQuestion
  /** null for the main question, else the follow-up's index. */
  followUpIndex: number | null
  question: string
  expectedPoints: string[]
  limit: number
}

export type MockStage =
  | { kind: 'answer'; turn: Turn }
  | { kind: 'scoring'; turn: Turn; response: MockResponse }
  | { kind: 'follow-up'; turn: Turn; response: MockResponse }
  | { kind: 'review'; turn: Turn; response: MockResponse }
  | { kind: 'done' }

/** Where the interview is, derived purely from stored state so it resumes correctly after a reload. */
export function mockStage(a: MockAttempt): MockStage {
  const q = a.questions[a.current]
  if (!q || a.finishedAt) return { kind: 'done' }
  const parentTurn: Turn = { key: q.id, parent: q, followUpIndex: null, question: q.question, expectedPoints: q.expectedPoints, limit: timeLimit(q) }
  const rec = a.answers[q.id]
  if (!rec) return { kind: 'answer', turn: parentTurn }

  const followUps = rec.followUps ?? []
  const i = followUps.length - 1
  const last = followUps[i]
  const turn: Turn = last
    ? { key: `${q.id}-f${i + 1}`, parent: q, followUpIndex: i, question: last.question, expectedPoints: last.expectedPoints, limit: FOLLOW_UP_SECONDS }
    : parentTurn
  const response = last ? last.response : rec
  if (!response) return { kind: 'answer', turn }
  if (!response.result && !response.error) return { kind: 'scoring', turn, response }
  if (response.result && response.result.score <= FOLLOW_UP_THRESHOLD && followUps.length < MAX_FOLLOW_UPS && !rec.followUpError) {
    return { kind: 'follow-up', turn, response }
  }
  return { kind: 'review', turn, response }
}

/** Every answer in an attempt (main and follow-up) with the question it answered. */
export function allResponses(a: MockAttempt) {
  return a.questions.flatMap((q) => {
    const rec = a.answers[q.id]
    if (!rec) return []
    return [
      { q, question: q.question, expectedPoints: q.expectedPoints, response: rec as MockResponse },
      ...(rec.followUps ?? []).flatMap((f) => (f.response ? [{ q, question: f.question, expectedPoints: f.expectedPoints, response: f.response }] : [])),
    ]
  })
}

export interface JobSession {
  id: string
  createdAt: number
  jobDescription: string
  plan: JobAnalyzeResponse
  study: Record<string, StudyRecord>
  mock: MockAttempt | null
}

export interface TopicStats {
  topicId: string
  topic: string
  study: number | null
  studyCount: number
  mock: number | null
  mockCount: number
  read: string
}

export interface HistoryEntry {
  id: string
  savedAt: number
  roleTitle: string
  seniority: Seniority
  study: number | null
  mock: number | null
  topics: { topic: string; study: number | null; mock: number | null; read: string }[]
}

export const SESSION_KEY = 'repo-recall:session'
export const HISTORY_KEY = 'repo-recall:history'

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the session still works in memory.
  }
}

/** Per-question time limit in the mock interview. */
export function timeLimit(q: { difficulty: string }): number {
  return q.difficulty === 'easy' ? 120 : q.difficulty === 'hard' ? 240 : 180
}

/** What the study-vs-interview gap says about a topic. */
export function readGap(study: number | null, mock: number | null): string {
  if (mock == null) return study == null ? 'Not practised' : 'Not interviewed yet'
  if (study == null) return mock >= 3.5 ? 'Solid' : 'Not studied'
  if (study < 3) return "Doesn't know it yet"
  if (study - mock >= 1) return "Knows it, can't recall under pressure"
  if (mock >= 3.5) return 'Solid'
  return 'Shaky'
}

export function jobContext(session: JobSession, topic: StudyTopic | undefined): string {
  const { plan } = session
  return [
    `Role: ${plan.roleTitle} (${plan.seniority})`,
    topic ? `Topic: ${topic.topic}` : '',
    topic ? `Why it matters: ${topic.whyItMatters}` : '',
    topic ? `Interviewers probe:\n${topic.whatTheyProbe.map((p) => `- ${p}`).join('\n')}` : '',
    '',
    `Job posting:\n"""\n${session.jobDescription.slice(0, 12_000)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n')
}

let scoringRun: Promise<void> | null = null

export function useJobSession() {
  // Loaded once from localStorage (ssr is off); persisted by plugins/persist.client.ts.
  const session = useState<JobSession | null>('job-session', () => loadJson<JobSession | null>(SESSION_KEY, null))

  const topicById = computed(() => new Map(session.value?.plan.studyPlan.map((t) => [t.id, t]) ?? []))

  const stats = computed<TopicStats[]>(() => {
    const s = session.value
    if (!s) return []
    return s.plan.studyPlan.map((t) => {
      const studyScores = t.questions.map((q) => s.study[q.id]?.result.score).filter((x): x is ScoreResponse['score'] => !!x)
      const mockScores = (s.mock?.questions ?? [])
        .filter((q) => q.topicId === t.id)
        .map((q) => s.mock!.answers[q.id]?.result?.score)
        .filter((x): x is ScoreResponse['score'] => !!x)
      const study = avg(studyScores)
      const mock = avg(mockScores)
      return { topicId: t.id, topic: t.topic, study, studyCount: studyScores.length, mock, mockCount: mockScores.length, read: readGap(study, mock) }
    })
  })

  const studyAvg = computed(() =>
    avg(Object.values(session.value?.study ?? {}).map((r) => r.result.score)),
  )
  const mockAvg = computed(() =>
    avg(Object.values(session.value?.mock?.answers ?? {}).flatMap((r) => (r.result ? [r.result.score] : []))),
  )

  function start(jobDescription: string, plan: JobAnalyzeResponse) {
    session.value = { id: crypto.randomUUID(), createdAt: Date.now(), jobDescription, plan, study: {}, mock: null }
  }

  function clear() {
    session.value = null
  }

  /**
   * Scores any mock answers that don't have a result yet, one at a time (the Gemini free tier is
   * rate limited). Safe to call repeatedly; resumes after a reload.
   */
  function scorePendingMock(): Promise<void> {
    // .finally() always runs after this assignment, unlike a finally block inside an async body that
    // can return before its first await.
    scoringRun ??= drainMockQueue().finally(() => {
      scoringRun = null
    })
    return scoringRun
  }

  async function drainMockQueue() {
    while (true) {
      const s = session.value
      const attempt = s?.mock
      if (!s || !attempt) return
      const next = allResponses(attempt).find(({ response }) => !response.result && !response.error)
      if (!next) return
      const { q, question, expectedPoints, response } = next
      try {
        response.result = response.answer.trim()
          ? await postScore({
              questionId: q.id,
              question,
              expectedPoints,
              answer: response.answer,
              jobContext: jobContext(s, topicById.value.get(q.topicId)),
              mode: 'interview',
            })
          : blankScore('No answer given.')
      } catch (err) {
        response.error = apiError(err)
      }
    }
  }

  function retryFailedMock() {
    const attempt = session.value?.mock
    if (!attempt) return Promise.resolve()
    // Only answers with text can be rescored; a failed transcription has nothing to retry.
    for (const { response } of allResponses(attempt)) if (response.answer.trim()) delete response.error
    return scorePendingMock()
  }

  return { session, topicById, stats, studyAvg, mockAvg, start, clear, scorePendingMock, retryFailedMock }
}

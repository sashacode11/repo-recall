import type { JobAnalyzeResponse, MockQuestion, ScoreResponse, Seniority, StudyTopic } from '#shared/types/interview'

export interface StudyRecord {
  answer: string
  result: ScoreResponse
}

export interface MockRecord {
  answer: string
  secondsUsed: number
  timedOut: boolean
  leftTab: boolean
  result?: ScoreResponse
  error?: string
}

export interface MockAttempt {
  id: string
  questions: MockQuestion[]
  answers: Record<string, MockRecord>
  current: number
  /** When the current question was shown; the timer keeps running across reloads. */
  questionStartedAt: number
  leftTabCurrent: boolean
  finishedAt?: number
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
      const q = attempt.questions.find((q) => attempt.answers[q.id] && !attempt.answers[q.id]!.result && !attempt.answers[q.id]!.error)
      if (!q) return
      const rec = attempt.answers[q.id]!
      try {
        rec.result = await postScore({
          questionId: q.id,
          question: q.question,
          expectedPoints: q.expectedPoints,
          answer: rec.answer,
          jobContext: jobContext(s, topicById.value.get(q.topicId)),
          mode: 'interview',
        })
      } catch (err) {
        rec.error = apiError(err)
      }
    }
  }

  function retryFailedMock() {
    for (const rec of Object.values(session.value?.mock?.answers ?? {})) delete rec.error
    return scorePendingMock()
  }

  return { session, topicById, stats, studyAvg, mockAvg, start, clear, scorePendingMock, retryFailedMock }
}

export const TOPICS = ['architecture', 'decisions', 'debugging', 'tradeoffs', 'implementation'] as const
export type Topic = (typeof TOPICS)[number]

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface Question {
  id: string
  question: string
  topic: Topic
  difficulty: Difficulty
  expectedPoints: string[]
}

export interface AnalyzeRequest {
  repoUrl: string
}

export interface AnalyzeResponse {
  repoName: string
  questions: Question[]
  /** README, file tree and selected source files, sent back to /api/score. */
  codeContext: string
  /** Paths of the source files that were read, for display. */
  files: string[]
}

// ---- Job-description flow ----

export const SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'unspecified'] as const
export type Seniority = (typeof SENIORITIES)[number]

export interface PracticeQuestion {
  id: string
  question: string
  difficulty: Difficulty
  expectedPoints: string[]
}

export interface StudyTopic {
  id: string
  topic: string
  /** Short quote from the posting that this topic is based on. */
  fromPosting: string
  whyItMatters: string
  whatTheyProbe: string[]
  questions: PracticeQuestion[]
}

export interface JobAnalyzeRequest {
  jobDescription: string
}

export interface JobAnalyzeResponse {
  roleTitle: string
  seniority: Seniority
  requiredSkills: string[]
  focusAreas: string[]
  studyPlan: StudyTopic[]
}

export interface MockQuestionsRequest {
  studyPlan: StudyTopic[]
  roleTitle?: string
  seniority?: Seniority
}

export interface MockQuestion extends PracticeQuestion {
  topicId: string
}

export interface MockQuestionsResponse {
  questions: MockQuestion[]
}

// ---- Scoring (shared by both flows) ----

export type ScoreMode = 'study' | 'interview'

export interface ScoreRequest {
  questionId: string
  question: string
  expectedPoints: string[]
  answer: string
  /** Repo flow: source code is the ground truth. */
  codeContext?: string
  /** Job flow: role, topic and posting the question was drawn from. */
  jobContext?: string
  /** 'study' gives teaching-oriented feedback; scores use the same rubric either way. Default 'interview'. */
  mode?: ScoreMode
}

export interface ScoreResponse {
  score: 1 | 2 | 3 | 4 | 5
  missing: string[]
  feedback: string
  modelAnswer: string
}

// ---- Voice mode and follow-ups (mock interview) ----

export interface TranscribeResponse {
  transcript: string
  /** False when the recording had no intelligible speech. */
  speechDetected: boolean
}

export interface FollowUpRequest {
  question: string
  answer: string
  missing: string[]
  feedback: string
  jobContext: string
  /** Follow-ups already asked on this question, in order, so the next one digs somewhere new. */
  previous?: { question: string; answer: string }[]
}

export interface FollowUpResponse {
  question: string
  expectedPoints: string[]
}

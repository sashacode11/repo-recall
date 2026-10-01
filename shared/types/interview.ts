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

export interface ScoreRequest {
  questionId: string
  question: string
  expectedPoints: string[]
  answer: string
  codeContext: string
}

export interface ScoreResponse {
  score: 1 | 2 | 3 | 4 | 5
  missing: string[]
  feedback: string
  modelAnswer: string
}

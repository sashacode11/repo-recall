import type { ScoreRequest, ScoreResponse } from '#shared/types/interview'

/** Readable message from a $fetch error (our server routes put it in statusMessage). */
export function apiError(err: unknown): string {
  const e = err as { data?: { statusMessage?: string; message?: string }; statusMessage?: string; message?: string }
  return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || e?.message || 'Something went wrong.'
}

export function postScore(body: ScoreRequest) {
  return $fetch<ScoreResponse>('/api/score', { method: 'POST', body })
}

/** Score for an answer left blank or timed out with nothing typed — no API call needed. */
export function blankScore(reason: string): ScoreResponse {
  return { score: 1, missing: [], feedback: reason, modelAnswer: '' }
}

export function avg(scores: number[]): number | null {
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}

export function fmtScore(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(1)
}

export function scoreColor(n: number | null | undefined): string {
  if (n == null) return 'text-neutral-500'
  if (n < 2.5) return 'text-red-300'
  if (n < 3.5) return 'text-amber-200'
  return 'text-emerald-300'
}

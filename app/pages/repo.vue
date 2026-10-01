<script setup lang="ts">
import type { AnalyzeResponse, ScoreResponse } from '#shared/types/interview'

// Repo flow: in-memory only (not persisted), per the original phase-1 spec.
interface RepoState {
  repoUrl: string
  data: AnalyzeResponse
  current: number
  results: Record<string, { answer: string; result: ScoreResponse }>
}
const state = useState<RepoState | null>('repo-session', () => null)

const repoUrl = ref(state.value?.repoUrl ?? '')
const loading = ref(false)
const scoring = ref(false)
const error = ref('')
const elapsed = ref(0)
const draft = ref('')

const question = computed(() => state.value?.data.questions[state.value.current])
const currentResult = computed(() => (question.value ? state.value?.results[question.value.id] : undefined))
const done = computed(() => !!state.value && state.value.current >= state.value.data.questions.length)

async function analyze(url = repoUrl.value) {
  if (loading.value || !url.trim()) return
  error.value = ''
  loading.value = true
  elapsed.value = 0
  const timer = setInterval(() => elapsed.value++, 1000)
  try {
    const data = await $fetch<AnalyzeResponse>('/api/analyze', { method: 'POST', body: { repoUrl: url } })
    state.value = { repoUrl: url, data, current: 0, results: {} }
    draft.value = ''
  } catch (err) {
    error.value = apiError(err)
  } finally {
    clearInterval(timer)
    loading.value = false
  }
}

async function submit() {
  const s = state.value
  const q = question.value
  if (!s || !q || !draft.value.trim() || scoring.value) return
  error.value = ''
  scoring.value = true
  try {
    const result = await postScore({
      questionId: q.id,
      question: q.question,
      expectedPoints: q.expectedPoints,
      answer: draft.value,
      codeContext: s.data.codeContext,
      mode: 'interview',
    })
    s.results[q.id] = { answer: draft.value.trim(), result }
  } catch (err) {
    error.value = apiError(err)
  } finally {
    scoring.value = false
  }
}

function skip() {
  const s = state.value
  const q = question.value
  if (!s || !q) return
  s.results[q.id] = { answer: '', result: blankScore('Skipped.') }
}

function next() {
  if (!state.value) return
  state.value.current++
  draft.value = ''
  error.value = ''
}

function retrySame() {
  if (!state.value) return
  state.value.current = 0
  state.value.results = {}
  draft.value = ''
}

function reset() {
  state.value = null
  error.value = ''
}

const summary = computed(() => {
  const s = state.value
  if (!s) return { overall: null as number | null, topics: [] as { topic: string; avg: number | null }[] }
  const byTopic = new Map<string, number[]>()
  for (const q of s.data.questions) {
    const r = s.results[q.id]
    if (r) byTopic.set(q.topic, [...(byTopic.get(q.topic) ?? []), r.result.score])
  }
  const topics = [...byTopic].map(([topic, scores]) => ({ topic, avg: avg(scores) })).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0))
  return { overall: avg(Object.values(s.results).map((r) => r.result.score)), topics }
})
const weakAreas = computed(() => summary.value.topics.filter((t) => (t.avg ?? 5) < 3.5).slice(0, 2))
</script>

<template>
  <div class="space-y-8">
    <!-- Input -->
    <template v-if="!state">
      <section class="space-y-3">
        <h1 class="text-2xl font-semibold text-neutral-100">Practise on your own repo</h1>
        <p class="muted">
          Paste a public GitHub repo you wrote. You'll get 10 questions about specific decisions in the code, answered from
          memory and scored against the real source.
        </p>
      </section>
      <form class="space-y-3" @submit.prevent="analyze()">
        <label for="repo" class="label">Repository URL</label>
        <input id="repo" v-model="repoUrl" class="field" placeholder="https://github.com/owner/repo" :disabled="loading" autocomplete="off" />
        <div class="flex items-center gap-4">
          <button type="submit" class="btn-primary" :disabled="loading || !repoUrl.trim()">{{ loading ? 'Reading the code…' : 'Start' }}</button>
          <span v-if="loading" class="muted text-sm">{{ elapsed }}s — usually 30–40s.</span>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </template>

    <!-- Summary -->
    <template v-else-if="done">
      <section class="space-y-2">
        <p class="label">Results · {{ state.data.repoName }}</p>
        <p class="text-3xl font-semibold tabular-nums" :class="scoreColor(summary.overall)">{{ fmtScore(summary.overall) }} / 5</p>
      </section>
      <section v-if="summary.topics.length" class="space-y-2">
        <h2 class="label">Weakest areas</h2>
        <ul v-if="weakAreas.length" class="space-y-1">
          <li v-for="t in weakAreas" :key="t.topic">
            <span class="text-amber-200">{{ t.topic }}</span> <span class="tabular-nums text-neutral-400">{{ fmtScore(t.avg) }}</span>
          </li>
        </ul>
        <p v-else class="muted">No area averaged below 3.5.</p>
      </section>
      <section class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-neutral-500">
            <tr>
              <th class="py-2 pr-3 font-medium">#</th>
              <th class="py-2 pr-3 font-medium">Question</th>
              <th class="py-2 pr-3 font-medium">Topic</th>
              <th class="py-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-800">
            <tr v-for="(q, i) in state.data.questions" :key="q.id" class="align-top">
              <td class="py-2 pr-3 text-neutral-500">{{ i + 1 }}</td>
              <td class="py-2 pr-3">{{ q.question }}</td>
              <td class="py-2 pr-3 text-neutral-400">{{ q.topic }}</td>
              <td class="py-2 text-right tabular-nums" :class="scoreColor(state.results[q.id]?.result.score)">
                {{ state.results[q.id]?.result.score ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <div class="flex flex-wrap gap-3">
        <button class="btn-primary" @click="retrySame">Retry same questions</button>
        <button class="btn-ghost" :disabled="loading" @click="analyze(state.repoUrl)">
          {{ loading ? 'Generating…' : 'New questions, same repo' }}
        </button>
        <button class="btn-ghost" @click="reset">Different repo</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </template>

    <!-- Question -->
    <template v-else-if="question">
      <div class="flex items-baseline justify-between text-sm">
        <span class="text-neutral-400">{{ state.data.repoName }}</span>
        <span class="text-neutral-400">{{ state.current + 1 }} of {{ state.data.questions.length }}</span>
      </div>
      <p class="label">{{ question.topic }} · {{ question.difficulty }}</p>
      <p class="text-lg text-neutral-100">{{ question.question }}</p>

      <template v-if="!currentResult">
        <AnswerBox v-model="draft" :disabled="scoring" placeholder="Answer from memory — no peeking at the code." @submit="submit" />
        <div class="flex items-center gap-3">
          <button class="btn-primary" :disabled="scoring || !draft.trim()" @click="submit">{{ scoring ? 'Scoring…' : 'Submit' }}</button>
          <button class="btn-ghost" :disabled="scoring" @click="skip">Skip</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </template>
      <template v-else>
        <ScoreCard :result="currentResult.result" />
        <button class="btn-primary" @click="next">
          {{ state.current + 1 >= state.data.questions.length ? 'See results' : 'Next question' }}
        </button>
      </template>
    </template>
  </div>
</template>

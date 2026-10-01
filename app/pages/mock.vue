<script setup lang="ts">
import type { MockQuestionsResponse } from '#shared/types/interview'

const { session, topicById, scorePendingMock } = useJobSession()
if (!session.value) await navigateTo('/', { replace: true })

const attempt = computed(() => session.value?.mock ?? null)
const active = computed(() => !!attempt.value && !attempt.value.finishedAt)
const question = computed(() => (active.value ? attempt.value!.questions[attempt.value!.current] : undefined))
const studied = computed(() => Object.keys(session.value?.study ?? {}).length)

const loading = ref(false)
const error = ref('')
const draft = ref('')
const now = ref(Date.now())

// ---- start ----

async function begin() {
  const s = session.value
  if (!s || loading.value) return
  error.value = ''
  loading.value = true
  try {
    const { questions } = await $fetch<MockQuestionsResponse>('/api/mock-questions', {
      method: 'POST',
      body: { studyPlan: s.plan.studyPlan, roleTitle: s.plan.roleTitle, seniority: s.plan.seniority },
    })
    s.mock = { id: crypto.randomUUID(), questions, answers: {}, current: 0, questionStartedAt: Date.now(), leftTabCurrent: false }
    draft.value = ''
  } catch (err) {
    error.value = apiError(err)
  } finally {
    loading.value = false
  }
}

function newAttempt() {
  if (!session.value) return
  if (!confirm('Start a new mock interview with new questions? The current interview results will be replaced (saved results stay).')) return
  session.value.mock = null
}

// ---- timer ----

const limit = computed(() => (question.value ? timeLimit(question.value) : 0))
const remaining = computed(() => {
  if (!attempt.value || !question.value) return 0
  const elapsed = Math.max(0, Math.floor((now.value - attempt.value.questionStartedAt) / 1000))
  return Math.max(0, limit.value - elapsed)
})
const clock = computed(() => {
  const s = remaining.value
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  tick = setInterval(() => (now.value = Date.now()), 250)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
})
onBeforeUnmount(() => {
  clearInterval(tick)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pagehide', onPageHide)
})

// ---- no looking things up ----

// Reloading or closing the page also fires visibilitychange (after pagehide); that isn't looking things up.
let unloading = false
const onPageHide = () => (unloading = true)

function onVisibility() {
  if (document.hidden && !unloading && active.value && attempt.value) attempt.value.leftTabCurrent = true
}

// ---- answer ----

const answerBox = ref<{ stop: () => void } | null>(null)

function submit(timedOut = false) {
  const a = attempt.value
  const q = question.value
  if (!a || !q || a.answers[q.id]) return
  answerBox.value?.stop()
  const answer = draft.value.trim()
  a.answers[q.id] = {
    answer,
    secondsUsed: Math.min(limit.value, Math.round((Date.now() - a.questionStartedAt) / 1000)),
    timedOut,
    leftTab: a.leftTabCurrent,
    result: answer ? undefined : blankScore(timedOut ? 'Time ran out with no answer.' : 'Skipped.'),
  }
  draft.value = ''
  if (a.current + 1 >= a.questions.length) {
    a.finishedAt = Date.now()
    scorePendingMock()
    navigateTo('/results')
    return
  }
  a.current++
  a.questionStartedAt = Date.now()
  a.leftTabCurrent = false
  // Score in the background so results are ready at the end; nothing is shown now.
  scorePendingMock()
}

function skip() {
  if (draft.value.trim() && !confirm('Skip and discard what you have written?')) return
  draft.value = ''
  submit(false)
}

// Declared after submit() and answerBox: immediate runs during setup, and on a reload after the
// time already ran out, remaining starts at 0 and never changes.
watch(remaining, (r) => {
  if (active.value && question.value && r === 0) submit(true)
}, { immediate: true })
</script>

<template>
  <div v-if="session" class="space-y-8">
    <!-- Intro -->
    <section v-if="!attempt" class="space-y-4">
      <p class="label">Mock interview</p>
      <h1 class="text-2xl font-semibold text-neutral-100">{{ session.plan.roleTitle }}</h1>
      <ul class="list-disc space-y-1 pl-5 text-neutral-300">
        <li>10 new questions on the topics you studied, one at a time.</li>
        <li>A timer per question: 2 minutes for easy, 3 for medium, 4 for hard. When it runs out, what you've written is submitted.</li>
        <li>No notes, no lookups. Leaving this tab is recorded and shown in your results.</li>
        <li>No feedback or model answers until the end.</li>
      </ul>
      <p v-if="studied === 0" class="text-sm text-amber-200">
        You haven't answered any study questions, so there's no study score to compare against. You can still go ahead.
      </p>
      <div class="flex items-center gap-4">
        <button class="btn-primary" :disabled="loading" @click="begin">{{ loading ? 'Preparing questions…' : 'Start interview' }}</button>
        <NuxtLink to="/study" class="text-sm text-neutral-400 hover:text-neutral-200">Back to study</NuxtLink>
      </div>
      <p v-if="loading" class="muted text-sm">This takes about 20 seconds.</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <!-- Finished -->
    <section v-else-if="!active" class="space-y-4">
      <h1 class="text-2xl font-semibold text-neutral-100">Interview complete</h1>
      <div class="flex gap-3">
        <NuxtLink to="/results" class="btn-primary">See results</NuxtLink>
        <button class="btn-ghost" @click="newAttempt">New mock interview</button>
      </div>
    </section>

    <!-- Active -->
    <section v-else-if="question && attempt" class="space-y-5">
      <div class="flex items-baseline justify-between text-sm">
        <span class="text-neutral-400">Question {{ attempt.current + 1 }} of {{ attempt.questions.length }}</span>
        <span
          class="font-mono text-lg tabular-nums"
          :class="remaining <= 30 ? 'text-red-300' : remaining <= 60 ? 'text-amber-200' : 'text-neutral-200'"
          role="timer"
          :aria-label="`${remaining} seconds left`"
        >
          {{ clock }}
        </span>
      </div>
      <div class="h-1 overflow-hidden rounded bg-neutral-800">
        <div class="h-full bg-neutral-400 transition-[width] duration-300" :style="{ width: `${(remaining / limit) * 100}%` }" />
      </div>
      <p class="label">{{ topicById.get(question.topicId)?.topic }} · {{ question.difficulty }}</p>
      <p class="text-lg text-neutral-100">{{ question.question }}</p>
      <AnswerBox ref="answerBox" v-model="draft" :rows="9" placeholder="Answer as you would out loud." @submit="submit()" />
      <div class="flex items-center gap-3">
        <button class="btn-primary" :disabled="!draft.trim()" @click="submit()">Submit</button>
        <button class="btn-ghost" @click="skip">Skip</button>
        <span v-if="attempt.leftTabCurrent" class="ml-auto text-sm text-amber-200">Left the tab during this question</span>
      </div>
    </section>
  </div>
</template>

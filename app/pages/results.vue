<script setup lang="ts">
const { session, topicById, stats, studyAvg, mockAvg, clear, scorePendingMock, retryFailedMock } = useJobSession()
if (!session.value) await navigateTo('/', { replace: true })

const attempt = computed(() => session.value?.mock ?? null)
const answers = computed(() => attempt.value?.questions.map((q) => ({ q, rec: attempt.value!.answers[q.id] })) ?? [])
const pending = computed(() => answers.value.filter((a) => a.rec && !a.rec.result && !a.rec.error).length)
const failed = computed(() => answers.value.filter((a) => a.rec?.error))
const complete = computed(() => !!attempt.value?.finishedAt && pending.value === 0 && failed.value.length === 0)
const leftTabCount = computed(() => answers.value.filter((a) => a.rec?.leftTab).length)
const gap = computed(() => (studyAvg.value != null && mockAvg.value != null ? studyAvg.value - mockAvg.value : null))

const weakest = computed(() =>
  [...stats.value]
    .filter((t) => t.mock != null || t.study != null)
    .sort((a, b) => (a.mock ?? a.study ?? 5) - (b.mock ?? b.study ?? 5))
    .filter((t) => (t.mock ?? t.study ?? 5) < 3.5)
    .slice(0, 3),
)

const READ_HELP: Record<string, string> = {
  "Doesn't know it yet": 'Low even with lookups allowed. Go back to the material.',
  "Knows it, can't recall under pressure": 'You got there with help but not without it. Practise answering out loud, from memory.',
  Shaky: 'Middling in both. Patchy understanding.',
  'Not studied': 'Weak in the interview and never studied.',
}

// Resume scoring after a reload, then save once everything is scored.
onMounted(() => scorePendingMock())
const saved = ref(false)
watch(
  complete,
  (done) => {
    const s = session.value
    const a = attempt.value
    if (!done || !s || !a) return
    const history = loadJson<HistoryEntry[]>(HISTORY_KEY, [])
    const entry: HistoryEntry = {
      id: `${s.id}:${a.id}`,
      savedAt: a.finishedAt ?? Date.now(),
      roleTitle: s.plan.roleTitle,
      seniority: s.plan.seniority,
      study: studyAvg.value,
      mock: mockAvg.value,
      topics: stats.value.map(({ topic, study, mock, read }) => ({ topic, study, mock, read })),
    }
    saveJson(HISTORY_KEY, [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, 50))
    saved.value = true
  },
  { immediate: true },
)

function retake() {
  if (!session.value) return
  session.value.mock = null
  navigateTo('/mock')
}

function startOver() {
  if (!confirm('Start over with a new job description? This session is discarded; saved results stay.')) return
  clear()
  navigateTo('/')
}
</script>

<template>
  <div v-if="session" class="space-y-10">
    <section class="space-y-2">
      <p class="label">Results</p>
      <h1 class="text-2xl font-semibold text-neutral-100">{{ session.plan.roleTitle }}</h1>
    </section>

    <section class="grid grid-cols-3 gap-3 text-center">
      <div class="rounded-md border border-neutral-800 p-3">
        <p class="label">Study</p>
        <p class="text-2xl font-semibold tabular-nums" :class="scoreColor(studyAvg)">{{ fmtScore(studyAvg) }}</p>
        <p class="text-xs text-neutral-500">{{ Object.keys(session.study).length }} answered</p>
      </div>
      <div class="rounded-md border border-neutral-800 p-3">
        <p class="label">Interview</p>
        <p class="text-2xl font-semibold tabular-nums" :class="scoreColor(mockAvg)">{{ fmtScore(mockAvg) }}</p>
        <p class="text-xs text-neutral-500">{{ answers.filter((a) => a.rec?.result).length }} scored</p>
      </div>
      <div class="rounded-md border border-neutral-800 p-3">
        <p class="label">Gap</p>
        <p class="text-2xl font-semibold tabular-nums" :class="gap != null && gap >= 1 ? 'text-amber-200' : 'text-neutral-200'">
          {{ gap == null ? '—' : (gap > 0 ? '−' : '+') + Math.abs(gap).toFixed(1) }}
        </p>
        <p class="text-xs text-neutral-500">interview vs study</p>
      </div>
    </section>

    <p v-if="!attempt" class="muted">
      No mock interview yet.
      <NuxtLink to="/mock" class="text-neutral-200 underline underline-offset-4">Take it</NuxtLink> to see the gap.
    </p>
    <p v-else-if="!attempt.finishedAt" class="muted">
      The interview isn't finished.
      <NuxtLink to="/mock" class="text-neutral-200 underline underline-offset-4">Continue it</NuxtLink>.
    </p>

    <div v-if="pending" class="muted text-sm">Scoring interview answers… {{ pending }} left.</div>
    <div v-if="failed.length && !pending" class="error flex items-center justify-between gap-4">
      <span>{{ failed.length }} answer{{ failed.length === 1 ? '' : 's' }} couldn't be scored: {{ failed[0]!.rec!.error }}</span>
      <button class="btn-ghost shrink-0" @click="retryFailedMock()">Retry</button>
    </div>
    <p v-if="leftTabCount" class="text-sm text-amber-200">
      You left the tab during {{ leftTabCount }} question{{ leftTabCount === 1 ? '' : 's' }}; those are marked below.
    </p>

    <section v-if="weakest.length" class="space-y-3">
      <h2 class="label">Weakest topics</h2>
      <ul class="space-y-3">
        <li v-for="t in weakest" :key="t.topicId" class="rounded-md border border-neutral-800 p-3">
          <p class="font-medium text-neutral-100">{{ t.topic }}</p>
          <p class="text-sm">
            <span class="text-amber-200">{{ t.read }}.</span>{{ ' ' }}<span class="muted">{{ READ_HELP[t.read] }}</span>
          </p>
        </li>
      </ul>
    </section>

    <section class="space-y-3">
      <h2 class="label">By topic</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-neutral-500">
            <tr>
              <th class="py-2 pr-3 font-medium">Topic</th>
              <th class="py-2 pr-3 text-right font-medium">Study</th>
              <th class="py-2 pr-3 text-right font-medium">Interview</th>
              <th class="py-2 font-medium">Read</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-800">
            <tr v-for="t in stats" :key="t.topicId">
              <td class="py-2 pr-3">{{ t.topic }}</td>
              <td class="py-2 pr-3 text-right tabular-nums" :class="scoreColor(t.study)">{{ fmtScore(t.study) }}</td>
              <td class="py-2 pr-3 text-right tabular-nums" :class="scoreColor(t.mock)">{{ fmtScore(t.mock) }}</td>
              <td class="py-2 text-neutral-400">{{ t.read }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="attempt?.finishedAt" class="space-y-6">
      <h2 class="label">Interview answers</h2>
      <article v-for="({ q, rec }, i) in answers" :key="q.id" class="space-y-3 border-t border-neutral-800 pt-4">
        <p class="text-xs text-neutral-500">
          {{ i + 1 }}. {{ topicById.get(q.topicId)?.topic }} · {{ q.difficulty }}
          <template v-if="rec">
            · {{ rec.secondsUsed }}s
            <span v-if="rec.timedOut" class="text-amber-200"> · timed out</span>
            <span v-if="rec.leftTab" class="text-amber-200"> · left the tab</span>
          </template>
        </p>
        <p class="text-neutral-100">{{ q.question }}</p>
        <template v-if="rec">
          <p v-if="rec.answer" class="whitespace-pre-wrap text-neutral-400">{{ rec.answer }}</p>
          <ScoreCard v-if="rec.result" :result="rec.result" />
          <p v-else-if="rec.error" class="text-sm text-red-300">Not scored: {{ rec.error }}</p>
          <p v-else class="muted text-sm">Scoring…</p>
        </template>
      </article>
    </section>

    <section class="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-6">
      <button v-if="attempt?.finishedAt" class="btn-primary" @click="retake">Retake interview (new questions)</button>
      <NuxtLink to="/study" class="btn-ghost">Back to study</NuxtLink>
      <button class="btn-ghost" @click="startOver">New job description</button>
      <span v-if="saved" class="text-sm text-neutral-500">Saved to this browser.</span>
    </section>
  </div>
</template>

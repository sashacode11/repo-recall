<script setup lang="ts">
import type { JobAnalyzeResponse } from '#shared/types/interview'

const { session, start, clear } = useJobSession()
const jd = ref('')
const loading = ref(false)
const error = ref('')
const elapsed = ref(0)
const history = ref<HistoryEntry[]>(loadJson<HistoryEntry[]>(HISTORY_KEY, []))

const studyProgress = computed(() => {
  const s = session.value
  if (!s) return ''
  const total = s.plan.studyPlan.reduce((n, t) => n + t.questions.length, 0)
  return `${Object.keys(s.study).length} of ${total} study questions answered`
})

async function analyze() {
  if (loading.value) return
  if (session.value && !confirm('Start over with a new job description? Your current session will be discarded.')) return
  error.value = ''
  loading.value = true
  elapsed.value = 0
  const timer = setInterval(() => elapsed.value++, 1000)
  try {
    const plan = await $fetch<JobAnalyzeResponse>('/api/job-analyze', {
      method: 'POST',
      body: { jobDescription: jd.value },
    })
    start(jd.value.trim(), plan)
    await navigateTo('/study')
  } catch (err) {
    error.value = apiError(err)
  } finally {
    clearInterval(timer)
    loading.value = false
  }
}

function discard() {
  if (confirm('Discard this session? Saved results stay.')) clear()
}

function clearHistory() {
  if (!confirm('Delete all saved results from this browser?')) return
  saveJson(HISTORY_KEY, null)
  history.value = []
}
</script>

<template>
  <div class="space-y-10">
    <section class="space-y-3">
      <h1 class="text-2xl font-semibold text-neutral-100">Prepare for a specific job</h1>
      <p class="muted">
        Paste a job description. First you <strong class="text-neutral-200">study</strong> the topics it calls for, with
        lookups encouraged and feedback after every answer. Then you take a timed
        <strong class="text-neutral-200">mock interview</strong> on the same ground with no help.
      </p>
      <p class="muted">
        The gap between the two scores is the point: low in both means you don't know it yet; high in study but low in
        the interview means you know it but can't recall it under pressure.
      </p>
    </section>

    <section v-if="session" class="space-y-3 rounded-md border border-neutral-800 p-4">
      <p class="label">In progress</p>
      <p class="font-medium text-neutral-100">{{ session.plan.roleTitle }}</p>
      <p class="muted text-sm">{{ studyProgress }}{{ session.mock?.finishedAt ? ' · mock interview done' : session.mock ? ' · mock interview started' : '' }}</p>
      <div class="flex flex-wrap gap-2">
        <NuxtLink to="/study" class="btn-primary">Continue studying</NuxtLink>
        <NuxtLink :to="session.mock?.finishedAt ? '/results' : '/mock'" class="btn-ghost">
          {{ session.mock?.finishedAt ? 'Results' : 'Mock interview' }}
        </NuxtLink>
        <button class="btn-ghost" @click="discard">Discard</button>
      </div>
    </section>

    <form class="space-y-3" @submit.prevent="analyze">
      <label for="jd" class="label">Job description</label>
      <textarea
        id="jd"
        v-model="jd"
        class="field"
        rows="12"
        placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
        :disabled="loading"
      />
      <div class="flex items-center gap-4">
        <button type="submit" class="btn-primary" :disabled="loading || jd.trim().length < 200">
          {{ loading ? 'Reading the posting…' : 'Start' }}
        </button>
        <span v-if="loading" class="muted text-sm">{{ elapsed }}s — building a study plan usually takes 30–60s.</span>
        <span v-else-if="jd && jd.trim().length < 200" class="text-sm text-neutral-500">Paste the whole posting.</span>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </form>

    <p class="muted text-sm">
      Prefer to be quizzed on your own code?
      <NuxtLink to="/repo" class="text-neutral-200 underline underline-offset-4">Practise on a GitHub repo</NuxtLink>.
    </p>

    <section v-if="history.length" class="space-y-3">
      <div class="flex items-baseline justify-between">
        <h2 class="label">Saved results</h2>
        <button class="text-xs text-neutral-500 hover:text-neutral-300" @click="clearHistory">Clear</button>
      </div>
      <ul class="divide-y divide-neutral-800 text-sm">
        <li v-for="h in history" :key="h.id" class="flex items-baseline justify-between gap-4 py-2">
          <span>
            {{ h.roleTitle }}
            <span class="text-neutral-500">· {{ new Date(h.savedAt).toLocaleDateString() }}</span>
          </span>
          <span class="shrink-0 tabular-nums">
            study <span :class="scoreColor(h.study)">{{ fmtScore(h.study) }}</span>
            · interview <span :class="scoreColor(h.mock)">{{ fmtScore(h.mock) }}</span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

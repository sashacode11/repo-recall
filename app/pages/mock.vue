<script setup lang="ts">
import type { FollowUpResponse, MockQuestionsResponse, TranscribeResponse } from '#shared/types/interview'

const { session, topicById, scorePendingMock } = useJobSession()
if (!session.value) await navigateTo('/', { replace: true })

const VOICE_PREF = 'repo-recall:voice'

const attempt = computed(() => session.value?.mock ?? null)
const stage = computed<MockStage>(() => (attempt.value ? mockStage(attempt.value) : { kind: 'done' }))
const turn = computed(() => (stage.value.kind === 'done' ? null : stage.value.turn))
const answering = computed(() => (stage.value.kind === 'answer' ? stage.value.turn : null))
/** The current turn once its answer is in: being scored, awaiting a follow-up, or ready to move on. */
const answered = computed(() => (stage.value.kind !== 'done' && stage.value.kind !== 'answer' ? stage.value : null))
const studied = computed(() => Object.keys(session.value?.study ?? {}).length)

const loading = ref(false)
const error = ref('')
const draft = ref('')
const now = ref(Date.now())

// ---- voice mode ----

const voiceSupported = ref(false)
const wantVoice = ref(false)
/** Shown when voice falls back to typing (no mic, permission denied, ...). */
const voiceNotice = ref('')
const speaking = ref(false)
const recording = ref(false)
const transcribing = ref(false)
const transcribeError = ref('')
let recorder: Recording | null = null
/** A stopped recording waiting for (or retrying) transcription. */
const pending = shallowRef<{ blob: Blob; turnKey: string; timedOut: boolean; secondsUsed: number; leftTab: boolean } | null>(null)
const voiceOn = computed(() => !!attempt.value?.voice)
const inputLocked = computed(() => recording.value || transcribing.value || !!pending.value)

onMounted(() => {
  voiceSupported.value = canRecord()
  wantVoice.value = voiceSupported.value && loadJson<boolean>(VOICE_PREF, false)
})

async function setVoice(on: boolean) {
  voiceNotice.value = ''
  if (on) {
    try {
      await checkMicrophone()
    } catch (err) {
      voiceNotice.value = (err as Error).message
      on = false
    }
  }
  saveJson(VOICE_PREF, on)
  if (attempt.value) attempt.value.voice = on
  else wantVoice.value = on
}

// The checkbox's DOM state must be reset when the mic check fails; :checked alone won't re-render an unchanged value.
async function onVoiceCheckbox(e: Event) {
  const box = e.target as HTMLInputElement
  await setVoice(box.checked)
  box.checked = wantVoice.value
}

function vocabulary(t: Turn) {
  const topic = topicById.value.get(t.parent.topicId)
  return topic ? [topic.topic, ...topic.whatTheyProbe].join('\n') : ''
}

// ---- start ----

async function begin() {
  const s = session.value
  if (!s || loading.value) return
  error.value = ''
  loading.value = true
  try {
    let voice = wantVoice.value
    if (voice) {
      try {
        await checkMicrophone()
      } catch (err) {
        voiceNotice.value = (err as Error).message
        voice = false
      }
    }
    const { questions } = await $fetch<MockQuestionsResponse>('/api/mock-questions', {
      method: 'POST',
      body: { studyPlan: s.plan.studyPlan, roleTitle: s.plan.roleTitle, seniority: s.plan.seniority },
    })
    s.mock = { id: crypto.randomUUID(), questions, answers: {}, current: 0, voice, questionStartedAt: null, recordingTurn: null, leftTabCurrent: false }
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

// ---- each turn: read the question out (voice), then start the clock ----

async function startTurn(t: Turn) {
  const a = attempt.value
  if (!a) return
  a.leftTabCurrent = false
  draft.value = ''
  if (a.voice && canSpeak()) {
    speaking.value = true
    await speak(t.question)
    speaking.value = false
  }
  // Tapping "Start answering" mid-read starts the clock early; don't reset it.
  if (answering.value?.key === t.key && a.questionStartedAt == null) a.questionStartedAt = Date.now()
}

function repeatQuestion() {
  if (answering.value && !inputLocked.value) speak(answering.value.question)
}

// ---- timer ----

const limit = computed(() => turn.value?.limit ?? 0)
const elapsed = computed(() => {
  const start = attempt.value?.questionStartedAt
  return start == null ? 0 : Math.max(0, Math.floor((now.value - start) / 1000))
})
const remaining = computed(() => Math.max(0, limit.value - elapsed.value))
const clock = computed(() => `${Math.floor(remaining.value / 60)}:${String(remaining.value % 60).padStart(2, '0')}`)

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
  stopSpeaking()
  recorder?.stop()
})

// ---- no looking things up ----

// Reloading or closing the page also fires visibilitychange (after pagehide); that isn't looking things up.
let unloading = false
const onPageHide = () => (unloading = true)

function onVisibility() {
  if (document.hidden && !unloading && answering.value && attempt.value) attempt.value.leftTabCurrent = true
}

// ---- recording an answer ----

function commit(t: Turn, response: MockResponse) {
  const a = attempt.value
  if (!a) return
  if (t.followUpIndex == null) a.answers[t.parent.id] = { ...response, followUps: [] }
  else a.answers[t.parent.id]!.followUps![t.followUpIndex]!.response = response
  a.recordingTurn = null
  draft.value = ''
}

async function startAnswer() {
  const a = attempt.value
  const t = answering.value
  if (!a || !t || inputLocked.value) return
  if (a.questionStartedAt == null) a.questionStartedAt = Date.now()
  stopSpeaking()
  voiceNotice.value = ''
  // From here the answer is committed: no pause, no re-record.
  a.recordingTurn = t.key
  try {
    recorder = await startRecording()
    recording.value = true
  } catch (err) {
    a.recordingTurn = null
    a.voice = false
    voiceNotice.value = (err as Error).message
  }
}

async function stopAnswer(timedOut = false) {
  const a = attempt.value
  const t = answering.value
  if (!a || !t || !recorder || !recording.value) return
  recording.value = false
  const secondsUsed = Math.min(t.limit, elapsed.value)
  const blob = await recorder.stop()
  recorder = null
  pending.value = { blob, turnKey: t.key, timedOut, secondsUsed, leftTab: a.leftTabCurrent }
  await transcribe()
}

async function transcribe() {
  const p = pending.value
  const t = answering.value
  if (!p || !t || t.key !== p.turnKey) return
  transcribing.value = true
  transcribeError.value = ''
  try {
    const form = new FormData()
    const ext = p.blob.type.includes('ogg') ? 'ogg' : p.blob.type.includes('mp4') ? 'm4a' : 'webm'
    form.append('audio', p.blob, `answer.${ext}`)
    form.append('question', t.question)
    form.append('vocabulary', vocabulary(t))
    const r = await $fetch<TranscribeResponse>('/api/transcribe', { method: 'POST', body: form })
    commit(t, {
      answer: r.speechDetected ? r.transcript : '',
      via: 'voice',
      secondsUsed: p.secondsUsed,
      timedOut: p.timedOut,
      leftTab: p.leftTab,
      result: r.speechDetected ? undefined : blankScore('No speech was detected in the recording.'),
    })
    pending.value = null
  } catch (err) {
    transcribeError.value = apiError(err)
  } finally {
    transcribing.value = false
  }
}

/** Gives up on a recording that can't be transcribed. It's left unscored rather than scored as a blank. */
function moveOnUntranscribed() {
  const p = pending.value
  const t = answering.value
  if (!p || !t) return
  commit(t, {
    answer: '',
    via: 'voice',
    secondsUsed: p.secondsUsed,
    timedOut: p.timedOut,
    leftTab: p.leftTab,
    error: `The recording couldn't be transcribed (${transcribeError.value}).`,
  })
  pending.value = null
  transcribeError.value = ''
}

// ---- typing an answer ----

function submitText(timedOut = false) {
  const a = attempt.value
  const t = answering.value
  if (!a || !t || inputLocked.value) return
  if (a.questionStartedAt == null) a.questionStartedAt = Date.now()
  const answer = draft.value.trim()
  commit(t, {
    answer,
    via: 'text',
    secondsUsed: Math.min(t.limit, elapsed.value),
    timedOut,
    leftTab: a.leftTabCurrent,
    result: answer ? undefined : blankScore(timedOut ? 'Time ran out with no answer.' : 'Skipped.'),
  })
}

function skip() {
  if (draft.value.trim() && !confirm('Skip and discard what you have written?')) return
  draft.value = ''
  submitText(false)
}

function timeUp() {
  const a = attempt.value
  const t = answering.value
  if (!a || !t || transcribing.value || pending.value) return
  if (recording.value) stopAnswer(true)
  else if (a.voice && !draft.value.trim()) {
    commit(t, { answer: '', via: 'voice', secondsUsed: t.limit, timedOut: true, leftTab: a.leftTabCurrent, result: blankScore('Time ran out before you started answering.') })
  } else submitText(true)
}

// ---- follow-ups ----

const generating = ref(false)

async function generateFollowUp() {
  const s = session.value
  const a = attempt.value
  const st = stage.value
  if (!s || !a || st.kind !== 'follow-up' || generating.value || !st.response.result) return
  const rec = a.answers[st.turn.parent.id]!
  generating.value = true
  try {
    const fu = await $fetch<FollowUpResponse>('/api/follow-up', {
      method: 'POST',
      body: {
        question: st.turn.question,
        answer: st.response.answer,
        missing: st.response.result.missing,
        feedback: st.response.result.feedback,
        jobContext: jobContext(s, topicById.value.get(st.turn.parent.topicId)),
        previous: (rec.followUps ?? []).filter((f) => f.response).map((f) => ({ question: f.question, answer: f.response!.answer })),
      },
    })
    a.questionStartedAt = null
    rec.followUps = [...(rec.followUps ?? []), { question: fu.question, expectedPoints: fu.expectedPoints }]
  } catch (err) {
    rec.followUpError = apiError(err)
  } finally {
    generating.value = false
  }
}

function next() {
  const a = attempt.value
  if (!a || stage.value.kind !== 'review') return
  a.current++
  a.questionStartedAt = null
  draft.value = ''
  if (a.current >= a.questions.length) {
    a.finishedAt = Date.now()
    scorePendingMock()
    navigateTo('/results')
  }
}

// ---- drive the interview from its stage (declared last: immediate watchers call the functions above) ----

// A reload while recording loses the audio. Recording commits the answer, so there's no second try; like a failed
// transcription, the answer is left unscored (and gets no follow-up) rather than scored as a blank.
onMounted(() => {
  const a = attempt.value
  const t = answering.value
  if (!a?.recordingTurn) return
  if (t && t.key === a.recordingTurn) {
    commit(t, {
      answer: '',
      via: 'voice',
      secondsUsed: Math.min(t.limit, elapsed.value),
      timedOut: false,
      leftTab: a.leftTabCurrent,
      error: 'The recording was interrupted by a page reload, so there was nothing to transcribe.',
    })
  } else a.recordingTurn = null
})

watch(
  () => answering.value?.key,
  () => {
    if (answering.value && attempt.value?.questionStartedAt == null && !attempt.value?.recordingTurn) startTurn(answering.value)
  },
  { immediate: true },
)

watch(
  () => stage.value.kind,
  (kind) => {
    if (kind === 'scoring') scorePendingMock()
    if (kind === 'follow-up') generateFollowUp()
  },
  { immediate: true },
)

watch(
  remaining,
  (r) => {
    if (r === 0 && answering.value && attempt.value?.questionStartedAt != null) timeUp()
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="session" class="space-y-8">
    <!-- Intro -->
    <section v-if="!attempt" class="space-y-4">
      <p class="label">Mock interview</p>
      <h1 class="text-2xl font-semibold text-neutral-100">{{ session.plan.roleTitle }}</h1>
      <ul class="list-disc space-y-1 pl-5 text-neutral-300">
        <li>10 new questions on the topics you studied, one at a time.</li>
        <li>A timer per question: 2 minutes for easy, 3 for medium, 4 for hard. When it runs out, your answer is submitted.</li>
        <li>A weak answer gets up to two follow-up questions (90 seconds each), like a real interviewer probing.</li>
        <li>No notes, no lookups. Leaving this tab is recorded and shown in your results.</li>
        <li>No feedback or model answers until the end.</li>
      </ul>

      <div v-if="voiceSupported" class="space-y-2 rounded-md border border-neutral-800 p-3">
        <label class="flex cursor-pointer items-center gap-3">
          <input type="checkbox" class="h-4 w-4 accent-neutral-200" :checked="wantVoice" @change="onVoiceCheckbox" />
          <span class="text-neutral-100">Voice mode</span>
        </label>
        <p class="muted text-sm">
          Questions are read aloud and you answer out loud. Tap to start, tap to finish. There's no pause and no re-record:
          once you start, that's your answer. You'll see what was heard before moving on. You can switch to typing between
          questions.
        </p>
      </div>
      <p v-if="voiceNotice" class="text-sm text-amber-200">{{ voiceNotice }}</p>

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
    <section v-else-if="stage.kind === 'done'" class="space-y-4">
      <h1 class="text-2xl font-semibold text-neutral-100">Interview complete</h1>
      <div class="flex gap-3">
        <NuxtLink to="/results" class="btn-primary">See results</NuxtLink>
        <button class="btn-ghost" @click="newAttempt">New mock interview</button>
      </div>
    </section>

    <!-- In progress -->
    <section v-else-if="turn && attempt" class="space-y-5">
      <div class="flex items-baseline justify-between gap-4 text-sm">
        <span class="text-neutral-400">
          Question {{ attempt.current + 1 }} of {{ attempt.questions.length }}
          <span v-if="turn.followUpIndex != null" class="text-neutral-200"> · follow-up {{ turn.followUpIndex + 1 }}</span>
        </span>
        <span
          v-if="answering"
          class="font-mono text-lg tabular-nums"
          :class="remaining <= 30 ? 'text-red-300' : remaining <= 60 ? 'text-amber-200' : 'text-neutral-200'"
          role="timer"
          :aria-label="`${remaining} seconds left`"
        >
          {{ clock }}
        </span>
      </div>
      <div v-if="answering" class="h-1 overflow-hidden rounded bg-neutral-800">
        <div class="h-full bg-neutral-400 transition-[width] duration-300" :style="{ width: `${(remaining / limit) * 100}%` }" />
      </div>

      <p class="label">{{ topicById.get(turn.parent.topicId)?.topic }} · {{ turn.parent.difficulty }}</p>
      <p class="text-lg text-neutral-100">{{ turn.question }}</p>

      <!-- Answering -->
      <template v-if="answering">
        <!-- Voice -->
        <div v-if="voiceOn" class="space-y-4">
          <p v-if="speaking" class="muted text-sm">Reading the question… you can start answering any time.</p>

          <div v-if="!recording && !pending" class="flex flex-wrap items-center gap-3">
            <button class="btn-primary" @click="startAnswer">
              <span class="inline-block h-2 w-2 rounded-full bg-red-500" /> Start answering
            </button>
            <button v-if="!speaking" class="btn-ghost" @click="repeatQuestion">Repeat question</button>
          </div>
          <p v-if="!recording && !pending" class="text-xs text-neutral-500">No pause and no re-record once you start.</p>

          <div v-if="recording" class="flex items-center gap-4">
            <button class="btn-primary" @click="stopAnswer()">Finish answer</button>
            <span class="flex items-center gap-2 text-sm text-red-300">
              <span class="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> Recording
            </span>
          </div>

          <p v-if="transcribing" class="muted text-sm">Transcribing your answer…</p>
          <div v-if="transcribeError" class="error space-y-2">
            <p>Couldn't transcribe the recording: {{ transcribeError }}</p>
            <div class="flex flex-wrap gap-2">
              <button class="btn-ghost" :disabled="transcribing" @click="transcribe">Try transcribing again</button>
              <button class="btn-ghost" :disabled="transcribing" @click="moveOnUntranscribed">Move on (leave this answer unscored)</button>
            </div>
          </div>
        </div>

        <!-- Typing -->
        <template v-else>
          <AnswerBox v-model="draft" :rows="9" :speech="false" placeholder="Answer as you would out loud." @submit="submitText()" />
          <div class="flex items-center gap-3">
            <button class="btn-primary" :disabled="!draft.trim()" @click="submitText()">Submit</button>
            <button class="btn-ghost" @click="skip">Skip</button>
          </div>
        </template>

        <p v-if="voiceNotice" class="text-sm text-amber-200">{{ voiceNotice }}</p>
        <div class="flex flex-wrap items-center gap-4 text-sm">
          <button
            v-if="voiceSupported && !inputLocked"
            class="text-neutral-400 underline underline-offset-4 hover:text-neutral-200"
            @click="setVoice(!voiceOn)"
          >
            {{ voiceOn ? 'Switch to typing' : 'Switch to voice' }}
          </button>
          <span v-if="attempt.leftTabCurrent" class="ml-auto text-amber-200">Left the tab during this question</span>
        </div>
      </template>

      <!-- Answered: show what was heard / written, read-only -->
      <template v-else-if="answered">
        <div class="space-y-1">
          <p class="label">{{ answered.response.via === 'voice' ? 'What was heard' : 'Your answer' }}</p>
          <p v-if="answered.response.answer" class="whitespace-pre-wrap rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-neutral-300">
            {{ answered.response.answer }}
          </p>
          <p v-else class="muted text-sm">{{ answered.response.result?.feedback || answered.response.error || 'No answer.' }}</p>
        </div>
        <p v-if="answered.kind === 'scoring' || answered.kind === 'follow-up'" class="muted text-sm">The interviewer is thinking…</p>
        <template v-else>
          <p v-if="answered.response.error && answered.response.answer" class="text-sm text-amber-200">
            This answer couldn't be scored yet. It will be retried on the results page.
          </p>
          <button class="btn-primary" @click="next">
            {{ attempt.current + 1 >= attempt.questions.length ? 'Finish interview' : 'Next question' }}
          </button>
        </template>
      </template>
    </section>
  </div>
</template>

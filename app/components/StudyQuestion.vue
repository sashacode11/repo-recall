<script setup lang="ts">
import type { PracticeQuestion, StudyTopic } from '#shared/types/interview'

const props = defineProps<{ question: PracticeQuestion; topic: StudyTopic; index: number; open: boolean }>()
const emit = defineEmits<{ open: []; done: [] }>()

const { session } = useJobSession()
const record = computed(() => session.value?.study[props.question.id])
const draft = ref('')
const loading = ref(false)
const error = ref('')
const retrying = ref(false)

async function submit() {
  const s = session.value
  if (!s || !draft.value.trim() || loading.value) return
  error.value = ''
  loading.value = true
  try {
    const result = await postScore({
      questionId: props.question.id,
      question: props.question.question,
      expectedPoints: props.question.expectedPoints,
      answer: draft.value,
      jobContext: jobContext(s, props.topic),
      mode: 'study',
    })
    s.study[props.question.id] = { answer: draft.value.trim(), result }
    retrying.value = false
    emit('done')
  } catch (err) {
    error.value = apiError(err)
  } finally {
    loading.value = false
  }
}

function tryAgain() {
  draft.value = record.value?.answer ?? ''
  retrying.value = true
  emit('open')
}
</script>

<template>
  <li class="space-y-3 border-t border-neutral-800 pt-4">
    <div class="flex gap-3">
      <span class="w-5 shrink-0 text-neutral-500 tabular-nums">{{ index + 1 }}.</span>
      <div class="flex-1 space-y-1">
        <p class="text-neutral-100">{{ question.question }}</p>
        <p class="text-xs text-neutral-500">
          {{ question.difficulty }}
          <template v-if="record && !retrying">
            · scored <span :class="scoreColor(record.result.score)">{{ record.result.score }}/5</span>
          </template>
        </p>
      </div>
    </div>

    <div class="pl-8">
      <template v-if="record && !retrying">
        <template v-if="open">
          <p class="label mb-1">Your answer</p>
          <p class="mb-3 whitespace-pre-wrap text-neutral-400">{{ record.answer }}</p>
          <ScoreCard :result="record.result" missing-label="To learn" />
          <button class="btn-ghost mt-3" @click="tryAgain">Answer again</button>
        </template>
        <button v-else class="text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-200" @click="emit('open')">
          Show feedback
        </button>
      </template>

      <template v-else-if="open">
        <AnswerBox v-model="draft" :disabled="loading" @submit="submit" />
        <div class="mt-3 flex items-center gap-3">
          <button class="btn-primary" :disabled="loading || !draft.trim()" @click="submit">
            {{ loading ? 'Scoring…' : 'Submit' }}
          </button>
          <button v-if="retrying" class="btn-ghost" :disabled="loading" @click="retrying = false">Cancel</button>
        </div>
        <p v-if="error" class="error mt-3">{{ error }}</p>
      </template>

      <button v-else class="btn-ghost" @click="emit('open')">Answer</button>
    </div>
  </li>
</template>

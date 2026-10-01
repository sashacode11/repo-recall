<script setup lang="ts">
// Textarea with optional voice input. The mic button only appears when the browser supports
// SpeechRecognition; typing always works.
const model = defineModel<string>({ required: true })
const props = withDefaults(
  // speech: offer browser dictation. The mock interview turns it off; its voice mode uses Gemini transcription.
  defineProps<{ disabled?: boolean; placeholder?: string; rows?: number; speech?: boolean }>(),
  { placeholder: 'Type your answer, or use the mic.', rows: 7, speech: true },
)
const emit = defineEmits<{ submit: [] }>()

const supported = ref(false)
const listening = ref(false)
const interim = ref('')
const voiceError = ref('')
let recognition: any = null
let base = ''
let finals = ''

onMounted(() => {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR || !props.speech) return
  supported.value = true
  recognition = new SR()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-US'

  recognition.onresult = (event: any) => {
    let pending = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript
      if (event.results[i].isFinal) finals += text
      else pending += text
    }
    interim.value = pending
    model.value = join(base, finals)
  }
  recognition.onerror = (event: any) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') voiceError.value = 'Microphone access was blocked.'
    else if (event.error !== 'no-speech' && event.error !== 'aborted') voiceError.value = `Voice input stopped (${event.error}).`
  }
  recognition.onend = () => {
    listening.value = false
    interim.value = ''
  }
})

function join(a: string, b: string) {
  const t = b.trim()
  if (!t) return a
  return a && !/\s$/.test(a) ? `${a} ${t}` : a + t
}

function toggle() {
  if (!recognition) return
  if (listening.value) {
    recognition.stop()
    return
  }
  voiceError.value = ''
  base = model.value
  finals = ''
  try {
    recognition.start()
    listening.value = true
  } catch {
    listening.value = false
  }
}

function stop() {
  if (listening.value) recognition?.stop()
}

watch(() => props.disabled, (d) => d && stop())
onBeforeUnmount(() => recognition?.abort())
defineExpose({ stop })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <div>
    <textarea
      v-model="model"
      class="field resize-y"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      @keydown="onKeydown"
      @input="listening && stop()"
    />
    <p v-if="interim" class="mt-1 text-sm italic text-neutral-500">{{ interim }}…</p>
    <div class="mt-2 flex items-center gap-3 text-sm">
      <button
        v-if="supported"
        type="button"
        class="btn-ghost px-3 py-1.5"
        :class="listening && 'border-red-700 text-red-200'"
        :disabled="disabled"
        :aria-pressed="listening"
        @click="toggle"
      >
        <span class="inline-block h-2 w-2 rounded-full" :class="listening ? 'animate-pulse bg-red-400' : 'bg-neutral-500'" />
        {{ listening ? 'Stop' : 'Speak' }}
      </button>
      <span v-if="voiceError" class="text-red-300">{{ voiceError }}</span>
      <span class="ml-auto text-neutral-600">Ctrl+Enter to submit</span>
    </div>
  </div>
</template>

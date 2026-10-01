// Browser voice helpers for the mock interview: speaking questions (SpeechSynthesis) and
// recording answers (MediaRecorder). Transcription happens server-side via /api/transcribe.

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function canRecord(): boolean {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia
}

/** Speaks text and resolves when it finishes (or is cancelled). Resolves immediately if unsupported. */
export function speak(text: string): Promise<void> {
  if (!canSpeak()) return Promise.resolve()
  return new Promise((resolve) => {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 1
    // Chrome sometimes never fires onend; don't let the interview hang on it.
    const fallback = setTimeout(done, 3_000 + text.length * 90)
    function done() {
      clearTimeout(fallback)
      resolve()
    }
    u.onend = done
    u.onerror = done
    window.speechSynthesis.speak(u)
  })
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
}

/** Explains a getUserMedia failure in terms the user can act on. */
export function micErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "Microphone permission was denied, so you'll answer by typing. Allow the mic in your browser's site settings to use voice."
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return "No microphone was found, so you'll answer by typing."
  }
  if (name === 'NotReadableError') {
    return "The microphone is in use by another app, so you'll answer by typing."
  }
  return "The microphone isn't available, so you'll answer by typing."
}

/** Asks for mic permission up front, then releases the device. Throws a readable message on failure. */
export async function checkMicrophone(): Promise<void> {
  if (!canRecord()) throw new Error("This browser can't record audio, so you'll answer by typing.")
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch (err) {
    throw new Error(micErrorMessage(err))
  }
}

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

export interface Recording {
  /** Stops recording and resolves with the captured audio. */
  stop: () => Promise<Blob>
}

/** Starts recording from the microphone. Throws a readable message if the mic can't be opened. */
export async function startRecording(): Promise<Recording> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (err) {
    throw new Error(micErrorMessage(err))
  }
  const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start(1_000)

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }))
        }
        if (recorder.state === 'inactive') recorder.onstop(new Event('stop'))
        else recorder.stop()
      }),
  }
}

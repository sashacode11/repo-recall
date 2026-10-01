import type { TranscribeResponse } from '#shared/types/interview'

// Vercel caps request bodies at 4.5 MB; a 4-minute Opus recording is well under 2 MB.
const MAX_AUDIO_BYTES = 4_000_000

const SYSTEM = `You transcribe a candidate's spoken answer in a technical job interview. The transcript will be graded, so it must be faithful.

Rules:
- Transcribe exactly what was said. Never add, complete, correct or improve content. If the candidate says something technically wrong, transcribe it wrong.
- Spell technical terms, product names and code identifiers correctly when that is clearly what was said (e.g. "Postgres", "idempotency key", "useState", "Kafka consumer group"). Speech recognition often splits jargon into common words ("item potency" for "idempotency", "post gress" for "Postgres", "cube control" for "kubectl"); when a phrase makes no sense literally but matches a term from the topic vocabulary, write the term.
- The interview question and topic vocabulary are given only to help you recognise terms - never take content from them. If the candidate did not say something, it must not appear in the transcript.
- Drop filler sounds (um, uh, er) and false starts that were immediately restarted. Keep everything else, including hedges like "I think" or "I'm not sure".
- Accented English is expected; transcribe what was meant phonetically, not what a similar-sounding common word would be.
- If a stretch is unintelligible, write [inaudible] rather than guessing.
- If there is no intelligible speech at all, set speechDetected to false and transcript to "".`

const schema = {
  type: 'OBJECT',
  properties: {
    speechDetected: { type: 'BOOLEAN' },
    transcript: { type: 'STRING' },
  },
  required: ['speechDetected', 'transcript'],
  propertyOrdering: ['speechDetected', 'transcript'],
}

export default defineEventHandler(async (event): Promise<TranscribeResponse> => {
  const form = await readMultipartFormData(event)
  const audio = form?.find((p) => p.name === 'audio')
  const question = form?.find((p) => p.name === 'question')?.data.toString('utf8').slice(0, 2_000) ?? ''
  const vocabulary = form?.find((p) => p.name === 'vocabulary')?.data.toString('utf8').slice(0, 3_000) ?? ''

  if (!audio?.data?.length) {
    throw createError({ statusCode: 400, statusMessage: 'No audio received.' })
  }
  if (audio.data.length > MAX_AUDIO_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Recording is too long to transcribe.' })
  }
  // Browsers report e.g. "audio/webm;codecs=opus"; Gemini wants the bare type.
  const mimeType = (audio.type ?? '').split(';')[0]!.trim()
  if (!mimeType.startsWith('audio/')) {
    throw createError({ statusCode: 415, statusMessage: `Unsupported audio type "${audio.type ?? 'unknown'}".` })
  }

  const result = await generateJson<TranscribeResponse>({
    system: SYSTEM,
    prompt: [
      {
        text: [
          question && `Interview question (for recognising terms only):\n"""\n${question}\n"""`,
          vocabulary && `Topic vocabulary (for recognising terms only):\n"""\n${vocabulary}\n"""`,
          'Transcribe the answer.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
      { inlineData: { mimeType, data: audio.data.toString('base64') } },
    ],
    schema,
    temperature: 0,
    // A small budget lets the model map mis-heard jargon to the right term; 0 produced "item potency key".
    thinkingBudget: 512,
  })

  const transcript = String(result.transcript ?? '').trim()
  return { transcript, speechDetected: !!result.speechDetected && transcript.length > 0 }
})

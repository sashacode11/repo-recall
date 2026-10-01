const MODEL = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

/**
 * Calls Gemini with a JSON response schema and returns the parsed result.
 * The API key is read from the server environment only and never leaves this module.
 */
export async function generateJson<T>(opts: {
  system: string
  prompt: string
  schema: Record<string, unknown>
  temperature?: number
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'GEMINI_API_KEY is not set on the server.' })
  }

  const request = () => fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: opts.schema,
        temperature: opts.temperature ?? 0.4,
      },
    }),
  })

  // Gemini returns transient 500/503s under load; retry those a couple of times.
  let res = await request()
  for (let attempt = 1; attempt <= 2 && (res.status === 500 || res.status === 503); attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt))
    res = await request()
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[gemini] ${res.status}: ${body.slice(0, 500)}`)
    const statusMessage =
      res.status === 429
        ? 'Gemini rate limit or quota reached. Wait a minute and try again.'
        : res.status === 503
          ? 'Gemini is overloaded right now. Try again shortly.'
          : `Gemini request failed (${res.status}).`
    throw createError({ statusCode: 502, statusMessage })
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) {
    console.error('[gemini] empty response', JSON.stringify(data).slice(0, 500))
    throw createError({ statusCode: 502, statusMessage: 'Gemini returned an empty response.' })
  }

  try {
    return JSON.parse(text) as T
  } catch {
    console.error('[gemini] invalid JSON', text.slice(0, 500))
    throw createError({ statusCode: 502, statusMessage: 'Gemini returned malformed JSON.' })
  }
}

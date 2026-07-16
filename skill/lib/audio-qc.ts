/**
 * Chiron — Audio QC via Gemini API (best-effort, never blocks a bake).
 *
 * Sends a synthesized mp3 (base64-inline) to Gemini Flash and asks it to
 * check for TTS defects: missing/garbled words, static, truncation.
 * Accent, pace, and extra filler words are NOT flagged — only real defects.
 *
 * Graceful: every error path returns { clean: true, defects: [] } so a
 * QC failure never fails the bake.
 */

const QC_MAX_BYTES = 18 * 1024 * 1024; // 18 MB — Gemini inline_data limit
const QC_TIMEOUT_MS = 25_000;
const GEMINI_MODEL = 'gemini-flash-latest'; // always resolves to newest Flash

export interface QcResult {
  clean: boolean;
  heard?: string;
  defects: string[];
}

/** True iff a Gemini API key is configured in the environment. */
export function qcAvailable(): boolean {
  return !!(process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY']);
}

/**
 * QC one mp3 clip against its expected text.
 *
 * Returns a QcResult. Never throws — any error (missing key, file too large,
 * HTTP error, timeout, JSON parse failure) yields { clean: true, defects: [] }.
 */
export async function qcAudioClip(mp3Path: string, expectedText: string): Promise<QcResult> {
  const key = process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY'];
  if (!key) return { clean: true, defects: [] };

  let mp3Bytes: Buffer;
  try {
    const { readFileSync, statSync } = await import('node:fs');
    const size = statSync(mp3Path).size;
    if (size > QC_MAX_BYTES) return { clean: true, defects: [] };
    mp3Bytes = readFileSync(mp3Path);
  } catch {
    return { clean: true, defects: [] };
  }

  const b64 = mp3Bytes.toString('base64');

  const prompt =
    `You are a TTS quality-control checker. The expected spoken text is:\n` +
    `"${expectedText}"\n\n` +
    `Listen to the audio and return STRICT JSON (no markdown, no commentary):\n` +
    `{"clean":true|false,"heard":"<what you actually heard>","defects":["<description with rough timestamp if known>"]}\n\n` +
    `Flag ONLY real TTS defects: missing or garbled words, static/noise, truncation, or abrupt cut-off.\n` +
    `Do NOT flag: accent, speaking pace, minor prosody variation, or legitimate extra filler words.\n` +
    `"defects" must be an empty array when clean is true.`;

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'audio/mp3', data: b64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });

  try {
    // Canonical header auth (`x-goog-api-key`) — the legacy `?key=` query is being
    // phased out and unrestricted AIza keys now 400. Do NOT silently pass on a bad
    // response: a dead key must be visible, not swallowed as "clean".
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body,
      signal: AbortSignal.timeout(QC_TIMEOUT_MS),
    });

    if (!resp.ok) {
      process.stderr.write(
        `[audio-qc] WARNING: Gemini QC HTTP ${resp.status} — clip treated as clean (QC unavailable). ` +
        `Verify the key with: cred verify gemini\n`,
      );
      return { clean: true, defects: [] };
    }

    const json = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return { clean: true, defects: [] };

    const parsed = JSON.parse(text) as {
      clean?: boolean;
      heard?: string;
      defects?: string[];
    };

    return {
      clean: parsed.clean !== false,
      heard: typeof parsed.heard === 'string' ? parsed.heard : undefined,
      defects: Array.isArray(parsed.defects)
        ? (parsed.defects as unknown[]).filter((d): d is string => typeof d === 'string')
        : [],
    };
  } catch {
    return { clean: true, defects: [] };
  }
}

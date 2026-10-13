/**
 * Bridges dictated/typed free text to a structured assignment via the
 * Gemini API. The speech-to-text itself is just the iOS keyboard's native
 * dictation — nothing here handles audio; this only parses whatever text
 * already landed in the input box.
 */

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY as string;
// gemini-1.5-flash was fully retired in 2026 (confirmed via search, not
// assumed) — gemini-3.8-flash is the current Flash-tier model as of this
// writing. If Google moves the line again, calls here will fail with a
// clear "model not found" error rather than something cryptic.
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are a data extractor for a student assignment tracker. Convert the user's text into a strict JSON object with these exact keys:
- "title" (string): a short name for the assignment, e.g. "Chapter 4 problem set". Required — never leave blank.
- "subject" (string): the class or subject, e.g. "Physics". Use an empty string if not mentioned.
- "dueDate" (string): an ISO 8601 date-time. If the user doesn't give a clear date, make your best reasonable guess relative to today; never leave it blank.
- "difficulty" (integer, 1-5)
- "estimatedMinutes" (integer, minutes)
Return ONLY the raw JSON object. No markdown formatting, no backticks, no conversational text.`;

export interface ParsedAssignment {
  title: string;
  subject: string;
  dueDate: string;
  difficulty: number;
  estimatedMinutes: number;
}

/** Safety net in case the model wraps output in a code fence despite instructions not to. */
function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function parseAssignment(text: string): Promise<ParsedAssignment> {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is not configured. Add EXPO_PUBLIC_GEMINI_API_KEY to your .env file.');
  }

  const today = new Date().toDateString();
  const systemPrompt = `${SYSTEM_PROMPT}\nToday's date is ${today}. Use this exact date as your reference point to accurately calculate any relative dates (e.g., 'this Friday', 'next week', 'tomorrow'). Ensure the calculated dueDate is in the future.`;

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseMimeType: 'application/json' }, // asks Gemini for guaranteed-parseable JSON, not just a prompt instruction
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini returned an empty or unexpected response.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch {
    throw new Error("Could not understand Gemini's response as JSON. Try rephrasing.");
  }

  return parsed as ParsedAssignment;
}
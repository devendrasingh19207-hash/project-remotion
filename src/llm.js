const config = require('./config');
const { GoogleGenAI } = require('@google/genai');
const { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt, computeTargetSeconds } = require('./prompt');
const { validateAndNormalize, validateSourceGrounding, stripCodeFences } = require('./validate');

const NARRATION_SYSTEM_PROMPT = `You are a concise educational voiceover editor. Preserve the facts and important concepts in the authoritative source. Keep each narration segment aligned with its corresponding scene. Do not add a greeting, outro, headings, or facts not supported by the source. Return only valid JSON in this shape: {"segments":["short spoken segment for scene 1"]}.`;

async function callGemini(prompt, systemPrompt = SYSTEM_PROMPT) {
  if (!config.GEMINI_API_KEY) {
    const error = new Error('Gemini API key is not configured.');
    error.code = 'LLM_UNAVAILABLE';
    throw error;
  }
  try {
    const ai = new GoogleGenAI({
      apiKey: config.GEMINI_API_KEY,
      httpOptions: { timeout: config.GEMINI_TIMEOUT_MS }
    });
    const result = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 8192
      }
    });
    if (result.promptFeedback && result.promptFeedback.blockReason) {
      const error = new Error('Gemini blocked this content.');
      error.code = 'CONTENT_BLOCKED';
      throw error;
    }
    const candidate = result.candidates && result.candidates[0];
    if (candidate && candidate.finishReason === 'SAFETY') {
      const error = new Error('Gemini blocked this content.');
      error.code = 'CONTENT_BLOCKED';
      throw error;
    }
    if (candidate && candidate.finishReason === 'MAX_TOKENS') {
      const error = new Error('Gemini output exceeded its token limit.');
      error.code = 'MAX_TOKENS';
      throw error;
    }
    const text = result.text || '';
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  } catch (cause) {
    if (cause.code === 'CONTENT_BLOCKED' || cause.code === 'MAX_TOKENS') throw cause;
    const status = cause.status || cause.statusCode;
    const timedOut = cause.name === 'AbortError' || cause.name === 'TimeoutError' ||
      /timeout|timed out/i.test(cause.message || '');
    const error = new Error(timedOut ? 'Gemini request timed out.' : 'Gemini request failed.');
    error.code = timedOut ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE';
    error.status = status;
    error.cause = cause;
    throw error;
  }
}

async function generateConciseNarration(sourceText, sceneNarrations, targetWordCount) {
  const prompt = [
    `Shorten the narration to no more than ${targetWordCount} words total.`,
    `Return exactly ${sceneNarrations.length} non-empty segments in the same scene order.`,
    'Keep the main teaching point of each scene, remove repetition and unnecessary phrasing, and use natural spoken language.',
    `Authoritative PDF source: ${JSON.stringify(sourceText)}`,
    `Current narration segments: ${JSON.stringify(sceneNarrations)}`
  ].join('\n\n');

  let raw;
  try {
    raw = await callGemini(prompt, NARRATION_SYSTEM_PROMPT);
  } catch (cause) {
    const error = new Error('Gemini could not shorten the narration.');
    error.userCode = 'NARRATION_REWRITE_FAILED';
    error.status = cause.status;
    throw error;
  }

  let result;
  try {
    result = JSON.parse(stripCodeFences(raw));
  } catch {
    const error = new Error('Gemini returned invalid shortened narration.');
    error.userCode = 'NARRATION_REWRITE_FAILED';
    throw error;
  }

  if (!result || !Array.isArray(result.segments) || result.segments.length !== sceneNarrations.length) {
    const error = new Error('Gemini returned narration segments that do not match the scenes.');
    error.userCode = 'NARRATION_REWRITE_FAILED';
    throw error;
  }

  const segments = result.segments.map((segment) => typeof segment === 'string' ? segment.trim() : '');
  const wordCount = segments.reduce((total, segment) => total + (segment.match(/\S+/g) || []).length, 0);
  const currentWordCount = sceneNarrations.reduce((total, segment) => total + (segment.match(/\S+/g) || []).length, 0);
  if (segments.some((segment) => !segment) || wordCount > targetWordCount || wordCount >= currentWordCount) {
    const error = new Error('Gemini returned narration that did not meet the shorter word budget.');
    error.userCode = 'NARRATION_REWRITE_FAILED';
    throw error;
  }
  return segments;
}

async function generateScenes(text) {
  if (!config.GEMINI_API_KEY) {
    const error = new Error('Gemini API key is not configured.');
    error.userCode = 'LLM_UNAVAILABLE';
    throw error;
  }
  const targetSeconds = computeTargetSeconds(text);
  let previous = '';
  let errors = [];
  let finalErrorCode = 'LLM_INVALID_OUTPUT';
  let groundingRetried = false;
  let maxAttempts = config.LLM_MAX_RETRIES + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = attempt === 0
      ? buildUserPrompt(text, targetSeconds, config.MAX_VIDEO_SECONDS)
      : buildRetryPrompt(text, errors, previous);
    try {
      previous = await callGemini(prompt, SYSTEM_PROMPT);
    } catch (error) {
      if (error.code === 'CONTENT_BLOCKED') {
        error.userCode = 'CONTENT_BLOCKED';
        throw error;
      }
      if (error.code === 'LLM_UNAVAILABLE') {
        errors = [error.message];
        if ([400, 401, 403, 404].includes(error.status) || attempt === config.LLM_MAX_RETRIES) {
          error.userCode = 'LLM_UNAVAILABLE';
          throw error;
        }
        continue;
      }
      if (error.code === 'LLM_TIMEOUT' && attempt === config.LLM_MAX_RETRIES) {
        error.userCode = 'LLM_TIMEOUT';
        throw error;
      }
      if (error.code === 'LLM_INVALID_OUTPUT' && attempt === config.LLM_MAX_RETRIES) {
        error.userCode = 'LLM_INVALID_OUTPUT';
        throw error;
      }
      errors = [error.message];
      continue;
    }
    const validation = validateAndNormalize(previous);
    if (validation.ok) {
      const grounding = validateSourceGrounding(text, validation.data);
      if (grounding.ok) return { ...validation, targetSeconds, attempt };
      errors = grounding.errors;
      finalErrorCode = 'SOURCE_MISMATCH';
      if (groundingRetried) break;
      groundingRetried = true;
      if (attempt === maxAttempts - 1) maxAttempts += 1;
    } else {
      errors = validation.errors;
      finalErrorCode = 'LLM_INVALID_OUTPUT';
    }
    previous = stripCodeFences(previous);
  }
  const error = new Error('Gemini output could not be validated against the source after retries.');
  error.userCode = finalErrorCode;
  error.errors = errors;
  throw error;
}

module.exports = { generateScenes, generateConciseNarration };

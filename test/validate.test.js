const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GEMINI_API_KEY = 'test-key';
const { validateAndNormalize, validateSourceGrounding, parseJSON } = require('../src/validate');
const config = require('../src/config');
const { generateScenes, generateConciseNarration } = require('../src/llm');
const { buildRetryPrompt, buildUserPrompt } = require('../src/prompt');

function sample() {
  return {
    meta: { title: 'Test notes', width: 1920, height: 1080, fps: 30 },
    scenes: [0, 1, 2].map((index) => ({
      id: `s${index + 1}`,
      role: index === 0 ? 'intro' : index === 2 ? 'summary' : 'explanation',
      duration: 5,
      background: '#101010',
      transition: 'fade',
      elements: [{
        type: 'text', style: 'body', text: `Scene ${index + 1}`, x: 960, y: 200,
        fontSize: 44, color: '#ffffff', align: 'center', bold: false, appearAt: 0
      }]
    }))
  };
}

test('parses JSON in optional markdown fences', () => {
  assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'), { ok: true });
});

test('normalizes bounded scene data for the Remotion composition', () => {
  const result = validateAndNormalize(sample());
  assert.equal(result.ok, true);
  assert.equal(result.sceneCount, 3);
  assert.equal(result.data.meta.width, 1920);
  assert.equal(result.data.scenes[0].elements[0].text, 'Scene 1');
  assert.equal(result.data.scenes[0].background, '#101010');
});

test('normalizes concise scene scripts and retains optional visual hints', () => {
  const result = validateAndNormalize({
    scenes: [
      { id: 's1', text: 'Note-making organizes lecture notes.', visualHint: 'Notebook page with highlighted terms' },
      { id: 's2', text: 'Organize key ideas for later review.' },
      { id: 's3', text: 'Review notes to remember the ideas.' }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.meta.title, 'Note-making organizes lecture notes.');
  assert.equal(result.data.scenes[0].elements[0].text, 'Note-making organizes lecture notes.');
  assert.equal(result.data.scenes[0].visualHint, 'Notebook page with highlighted terms');
});

test('rejects too few scenes and caps total video duration', () => {
  const tooFew = sample();
  tooFew.scenes.pop();
  assert.equal(validateAndNormalize(tooFew).ok, false);

  const long = sample();
  long.scenes = Array.from({ length: 60 }, (_, index) => ({
    ...sample().scenes[index % 3],
    id: `s${index + 1}`,
    duration: 12
  }));
  const result = validateAndNormalize(long);
  assert.equal(result.ok, true);
  assert.ok(result.totalDuration <= 300);
  assert.ok(result.sceneCount <= 75);
});

test('keeps the PDF source in first and retry prompts', () => {
  const notes = 'Note-making organizes lecture notes into key ideas for later review.';
  assert.match(buildUserPrompt(notes, 30, 300), /authoritative/);
  assert.match(buildRetryPrompt(notes, ['wrong subject'], '{}'), /Note-making organizes lecture notes/);
});

test('creates concise narration segments grounded in the PDF and scene order', async () => {
  const originalKey = config.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  config.GEMINI_API_KEY = 'test-key';
  global.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = await request.clone().json();
    assert.match(body.systemInstruction.parts[0].text, /voiceover editor/);
    assert.match(body.contents[0].parts[0].text, /Authoritative PDF source/);
    assert.match(body.contents[0].parts[0].text, /no more than 6 words/);
    return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ segments: ['Keep key ideas.', 'Review them.'] }) }] },
          finishReason: 'STOP'
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const segments = await generateConciseNarration(
      'Note-making keeps useful ideas for later review.',
      ['This scene introduces the note-making idea.', 'This scene explains reviewing notes.'],
      6
    );
    assert.deepEqual(segments, ['Keep key ideas.', 'Review them.']);
  } finally {
    config.GEMINI_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('rejects narration rewrites that exceed the measured word budget', async () => {
  const originalKey = config.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  config.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify({ segments: ['These four words exceed.', 'Also too long.'] }) }] },
        finishReason: 'STOP'
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(
      generateConciseNarration('Source notes.', ['First segment with words.', 'Second segment with words.'], 4),
      (error) => error.userCode === 'NARRATION_REWRITE_FAILED'
    );
  } finally {
    config.GEMINI_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('rejects a valid but unrelated script and accepts note-making scenes', () => {
  const source = 'Note-making organizes lecture notes into key ideas for later review.';
  const unrelated = sample();
  unrelated.meta.title = 'Understanding Photosynthesis';
  unrelated.scenes.forEach((scene) => {
    scene.elements[0].text = 'Plants use sunlight to create glucose and oxygen.';
  });
  assert.equal(validateSourceGrounding(source, unrelated).ok, false);

  const grounded = sample();
  grounded.meta.title = 'Note-Making';
  grounded.scenes.forEach((scene) => {
    scene.elements[0].text = 'Note-making organizes lecture notes for review.';
  });
  assert.equal(validateSourceGrounding(source, grounded).ok, true);
});

test('retries unrelated Gemini output with the source PDF text', async () => {
  const originalKey = config.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  const unrelated = sample();
  unrelated.meta.title = 'Understanding Photosynthesis';
  unrelated.scenes.forEach((scene) => {
    scene.elements[0].text = 'Plants use sunlight to create glucose and oxygen.';
  });
  let callCount = 0;
  const prompts = [];
  config.GEMINI_API_KEY = 'test-key';
  global.fetch = async (input, init) => {
    const request = new Request(input, init);
    callCount += 1;
    prompts.push((await request.clone().json()).contents[0].parts[0].text);
    return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(unrelated) }] }, finishReason: 'STOP' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await assert.rejects(
      generateScenes('Note-making organizes lecture notes into key ideas for later review.'),
      (error) => error.userCode === 'SOURCE_MISMATCH'
    );
    assert.equal(callCount, 2);
    assert.match(prompts[1], /Note-making organizes lecture notes/);
    assert.match(prompts[1], /does not match the source topic/i);
  } finally {
    config.GEMINI_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('reports a missing Gemini key as an unavailable service', async () => {
  const originalKey = config.GEMINI_API_KEY;
  config.GEMINI_API_KEY = '';
  try {
    await assert.rejects(generateScenes('test notes'), (error) => error.userCode === 'LLM_UNAVAILABLE');
  } finally {
    config.GEMINI_API_KEY = originalKey;
  }
});

test('reports Gemini API model errors as service unavailable', async () => {
  const originalKey = config.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  config.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'model not found' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  });
  try {
    await assert.rejects(
      generateScenes('test notes'),
      (error) => error.userCode === 'LLM_UNAVAILABLE' && error.status === 404
    );
  } finally {
    config.GEMINI_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

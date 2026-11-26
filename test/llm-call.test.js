const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { generateScenes } = require('../src/llm');

const sourceText = [
  'Note-making turns lecture notes into organized key ideas.',
  'Grouping related details helps students review information later.',
  'Regular review makes important concepts easier to remember.'
].join(' ');

function responseScenes() {
  return {
    scenes: [
      { id: 's1', text: 'Note-making organizes lecture notes into key ideas.' },
      { id: 's2', text: 'Group related details to review information later.' },
      { id: 's3', text: 'Review important concepts regularly to remember them.' }
    ]
  };
}

test('calls Gemini and returns validated normalized scenes', async () => {
  const originalKey = config.GEMINI_API_KEY;
  const originalFetch = global.fetch;
  config.GEMINI_API_KEY = 'test-key';
  global.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json();
    assert.match(body.contents[0].parts[0].text, /authoritative/i);
    assert.match(body.contents[0].parts[0].text, /Note-making turns lecture notes/);
    assert.doesNotMatch(JSON.stringify(body), /"labels"\s*:/);
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(responseScenes()) }] },
        finishReason: 'STOP'
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await generateScenes(sourceText);
    assert.equal(result.ok, true);
    assert.equal(result.sceneCount, 3);
    assert.equal(result.data.scenes.length, 3);
    assert.equal(result.data.scenes[0].elements[0].text, responseScenes().scenes[0].text);
    assert.equal(result.attempt, 0);
    assert.ok(result.totalDuration > 0);
    assert.ok(result.targetSeconds > 0);
  } finally {
    config.GEMINI_API_KEY = originalKey;
    global.fetch = originalFetch;
  }
});

test('reports the configured Gemini provider error from a live call', {
  skip: process.env.RUN_GEMINI_INTEGRATION !== '1'
}, async () => {
  const redact = (value) => String(value || '')
    .replace(config.GEMINI_API_KEY, '[REDACTED_API_KEY]')
    .slice(0, 1000);

  try {
    const result = await generateScenes(sourceText);
    console.log('LIVE_GEMINI_SUCCESS ' + JSON.stringify({
      model: config.GEMINI_MODEL,
      sceneCount: result.sceneCount,
      attempt: result.attempt,
      returnValue: {
        title: result.data.meta.title,
        scenes: result.data.scenes.map((scene) => ({
          id: scene.id,
          text: scene.elements.map((element) => element.text).join(' ')
        }))
      }
    }));
  } catch (error) {
    const providerError = error.cause || {};
    const details = {
      code: error.userCode || error.code || null,
      status: error.status || providerError.status || providerError.statusCode || null,
      providerCode: providerError.code || null,
      providerMessage: redact(providerError.message || error.message)
    };
    console.error('LIVE_GEMINI_FAILURE ' + JSON.stringify(details));
    throw new Error(
      `Gemini call failed (${details.code || 'unknown'}, HTTP ${details.status || 'unknown'}): ${details.providerMessage}`
    );
  }
});

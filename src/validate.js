const Ajv = require('ajv');
const config = require('./config');
const schema = require('./schema');

const validateSchema = new Ajv({ allErrors: true }).compile(schema);
const transitions = new Set(['none', 'fade', 'slide_left', 'slide_up', 'zoom']);
const styles = { title: 72, subtitle: 56, body: 44, caption: 32 };
const safeColor = /^#[0-9a-f]{6}$/i;
const commonWords = new Set([
  'about', 'above', 'after', 'again', 'also', 'among', 'because', 'been', 'before', 'being',
  'between', 'both', 'could', 'does', 'each', 'from', 'have', 'into', 'just', 'more', 'most',
  'other', 'over', 'same', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'very', 'were', 'what', 'when', 'where',
  'which', 'while', 'with', 'would', 'your', 'will', 'shall', 'should', 'must', 'using', 'used',
  'make', 'made', 'main', 'important', 'information', 'different', 'example', 'examples', 'topic',
  'subject', 'explain', 'explains', 'explained', 'understand', 'understanding', 'concept', 'concepts'
]);

function stripCodeFences(raw) {
  if (typeof raw !== 'string') return raw;
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parseJSON(raw) {
  return JSON.parse(stripCodeFences(raw));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeElement(element) {
  const style = Object.hasOwn(styles, element.style) ? element.style : 'body';
  return {
    type: 'text',
    style,
    text: (typeof element.text === 'string' ? element.text : ' ').trim().slice(0, 90) || ' ',
    x: clamp(Math.round(Number(element.x) || 960), 120, 1800),
    y: clamp(Math.round(Number(element.y) || 540), 100, 980),
    fontSize: clamp(Math.round(Number(element.fontSize) || styles[style]), 28, 96),
    color: safeColor.test(element.color) ? element.color : '#e8eaf0',
    align: ['left', 'center', 'right'].includes(element.align) ? element.align : 'center',
    bold: Boolean(element.bold),
    appearAt: Math.max(0, Number(element.appearAt) || 0)
  };
}

function normalizeScene(scene, index) {
  const sourceElements = Array.isArray(scene.elements)
    ? scene.elements
    : typeof scene.text === 'string'
      ? [{ text: scene.text, x: 960, y: 480, fontSize: 56, color: '#ffffff', align: 'center', bold: true }]
      : [];
  const elements = sourceElements
    .slice(0, 8)
    .map(normalizeElement)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < elements.length; i += 1) {
    const minY = elements[i - 1].y + Math.round(elements[i - 1].fontSize * 1.6);
    if (elements[i].y < minY) elements[i].y = Math.min(minY, 980);
  }
  return {
    id: `s${index + 1}`,
    role: ['intro', 'section_title', 'explanation', 'example', 'summary'].includes(scene.role)
      ? scene.role : 'explanation',
    duration: clamp(Number(scene.duration) || 5, config.MIN_SCENE_SEC, config.MAX_SCENE_SEC),
    background: safeColor.test(scene.background) ? scene.background : '#0f1115',
    ...(typeof scene.visualHint === 'string' ? { visualHint: scene.visualHint.trim().slice(0, 160) } : {}),
    transition: transitions.has(scene.transition) ? scene.transition : 'fade',
    elements: elements.length ? elements : [normalizeElement({ text: ' ' })]
  };
}

function fitDuration(scenes) {
  const maxScenes = Math.max(3, Math.min(config.MAX_SCENES, Math.floor(config.MAX_VIDEO_SECONDS / config.MIN_SCENE_SEC)));
  if (scenes.length > maxScenes) {
    const summary = scenes[scenes.length - 1];
    scenes.splice(maxScenes - 1);
    scenes.push(summary);
  }
  let total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  while (total > config.MAX_VIDEO_SECONDS) {
    const longest = scenes.reduce((best, scene, index) =>
      scene.duration > scenes[best].duration ? index : best, 0);
    if (scenes[longest].duration <= config.MIN_SCENE_SEC) break;
    scenes[longest].duration -= 1;
    total -= 1;
  }
}

function validateAndNormalize(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? parseJSON(rawInput) : rawInput;
  } catch (error) {
    return { ok: false, errors: [`JSON parse error: ${error.message}`], data: null };
  }

  if (!data || typeof data !== 'object' || !Array.isArray(data.scenes)) {
    return { ok: false, errors: ['Expected a scenes array in the JSON object.'], data: null };
  }

  const invalidSceneIndex = data.scenes.findIndex((scene) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene) ||
        typeof scene.id !== 'string' || !/^s[0-9]{1,3}$/.test(scene.id)) {
      return true;
    }
    const hasText = typeof scene.text === 'string' && scene.text.trim().length > 0;
    const hasElements = Array.isArray(scene.elements) && scene.elements.length > 0 &&
      scene.elements.every((element) =>
        element && typeof element === 'object' && typeof element.text === 'string' && element.text.trim().length > 0
      );
    return (!hasText && !hasElements) ||
      (scene.visualHint !== undefined && typeof scene.visualHint !== 'string');
  });
  if (invalidSceneIndex !== -1) {
    return {
      ok: false,
      errors: [`Scene ${invalidSceneIndex + 1} must have an id and non-empty text.`],
      data: null
    };
  }

  const scenes = data.scenes.slice(0, config.MAX_SCENES).map(normalizeScene);
  if (scenes.length < 3) {
    return { ok: false, errors: [`Must have at least 3 scenes, got ${scenes.length}.`], data: null };
  }
  fitDuration(scenes);
  const normalized = {
    meta: {
      title: (typeof data.meta?.title === 'string'
        ? data.meta.title
        : typeof data.scenes[0]?.text === 'string'
          ? data.scenes[0].text
          : data.scenes[0]?.elements?.[0]?.text || 'Untitled Video').slice(0, 120) || 'Untitled Video',
      width: config.CANVAS_WIDTH,
      height: config.CANVAS_HEIGHT,
      fps: data.meta && data.meta.fps === 24 ? 24 : 30
    },
    scenes
  };

  if (!validateSchema(normalized)) {
    return {
      ok: false,
      errors: (validateSchema.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`),
      data: null
    };
  }
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  return { ok: true, errors: [], data: normalized, totalDuration, sceneCount: scenes.length };
}

function validateSourceGrounding(sourceText, canonical) {
  const counts = new Map();
  for (const term of (sourceText.toLowerCase().match(/[a-z]{4,}/g) || [])) {
    if (commonWords.has(term)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  const keyTerms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 20)
    .map(([term]) => term);
  if (keyTerms.length < 2) return { ok: true, errors: [] };

  const generatedText = [
    canonical.meta.title,
    ...canonical.scenes.flatMap((scene) => [
      ...(scene.visualHint ? [scene.visualHint] : []),
      ...scene.elements.map((element) => element.text)
    ])
  ].join(' ').toLowerCase();
  const generatedTerms = new Set(generatedText.match(/[a-z]{4,}/g) || []);
  const matchedTerms = keyTerms.filter((term) => generatedTerms.has(term));
  if (matchedTerms.length >= 2) return { ok: true, errors: [] };

  return {
    ok: false,
    errors: [
      `The script does not match the source topic. Include at least two of these source terms: ${keyTerms.slice(0, 8).join(', ')}.`
    ]
  };
}

module.exports = { validateAndNormalize, validateSourceGrounding, parseJSON, stripCodeFences };

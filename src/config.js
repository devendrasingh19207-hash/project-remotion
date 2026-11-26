require('dotenv').config();
const path = require('path');
const { z } = require('zod');

const positiveInteger = (fallback) => z.preprocess(
  (value) => value === undefined || value === '' ? fallback : Number(value),
  z.number().int().positive()
);

const envSchema = z.object({
  PORT: positiveInteger(3000),
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.6-flash'),
  GEMINI_TTS_MODEL: z.string().min(1).default('gemini-3.8-flash-tts'),
  GEMINI_TTS_VOICE: z.string().min(1).default('Charon'),
  MAX_UPLOAD_MB: positiveInteger(10),
  MIN_TEXT_CHARS: positiveInteger(200),
  MAX_INPUT_CHARS: positiveInteger(60000),
  MAX_VIDEO_SECONDS: positiveInteger(300),
  MIN_SCENE_SEC: positiveInteger(4),
  MAX_SCENE_SEC: positiveInteger(12),
  MAX_SCENES: positiveInteger(120),
  LLM_MAX_RETRIES: positiveInteger(2),
  GEMINI_TIMEOUT_MS: positiveInteger(120000),
  RENDER_TIMEOUT_MS: positiveInteger(600000),
  MAX_CONCURRENT_RENDERS: positiveInteger(1),
  FILE_TTL_HOURS: positiveInteger(24),
  MIN_FREE_DISK_MB: positiveInteger(500),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
}).superRefine((values, context) => {
  if (values.MAX_SCENE_SEC < values.MIN_SCENE_SEC) {
    context.addIssue({
      code: 'custom',
      path: ['MAX_SCENE_SEC'],
      message: 'must be greater than or equal to MIN_SCENE_SEC'
    });
  }
  if (values.MAX_VIDEO_SECONDS < values.MIN_SCENE_SEC * 3) {
    context.addIssue({
      code: 'custom',
      path: ['MAX_VIDEO_SECONDS'],
      message: 'must allow at least three minimum-length scenes'
    });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${issues}`);
}

const values = parsed.data;
const videosDir = path.resolve(__dirname, '..', 'videos');

module.exports = {
  ...values,
  CANVAS_WIDTH: 1920,
  CANVAS_HEIGHT: 1080,
  PROJECT_ROOT: path.resolve(__dirname, '..'),
  UPLOADS_DIR: path.resolve(__dirname, '..', 'uploads'),
  VIDEOS_DIR: videosDir,
  TEMP_DIR: path.join(videosDir, '.tmp')
};

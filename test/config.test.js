const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('fails fast when an environment setting has an invalid value', () => {
  const result = spawnSync(process.execPath, [
    '-e',
    "process.env.PORT = 'not-a-port'; require('./src/config')"
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, PORT: 'not-a-port', GEMINI_API_KEY: 'test-key' }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid environment configuration: PORT/);
});

test('fails fast when the Gemini API key is missing', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(path.join(projectRoot, 'src', 'config.js'))})`
  ], {
    cwd: require('node:os').tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, GEMINI_API_KEY: '' }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid environment configuration: GEMINI_API_KEY/);
});

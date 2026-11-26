const fs = require('fs');
const path = require('path');
const { bundle } = require('@remotion/bundler');
const { ensureBrowser, renderMedia, selectComposition } = require('@remotion/renderer');
const config = require('./config');
const { getSceneFrameRanges } = require('./remotion/timeline');

const REMOTION_ENTRY = path.join(config.PROJECT_ROOT, 'src', 'remotion', 'index.tsx');
const COMPOSITION_ID = 'NotesToVideo';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let activeRenders = 0;
let serveUrlPromise;

function acquireSlot() {
  if (activeRenders >= config.MAX_CONCURRENT_RENDERS) return false;
  activeRenders += 1;
  return true;
}

function releaseSlot() {
  activeRenders = Math.max(0, activeRenders - 1);
}

async function getServeUrl() {
  if (!serveUrlPromise) {
    serveUrlPromise = bundle({
      entryPoint: REMOTION_ENTRY,
      publicDir: path.join(config.PROJECT_ROOT, 'public')
    }).catch((error) => {
      serveUrlPromise = null;
      throw error;
    });
  }
  return serveUrlPromise;
}

function checkRemotionAvailable() {
  return fs.existsSync(REMOTION_ENTRY);
}

async function writeSceneJson(jobId, canonicalData) {
  const jsonPath = path.join(config.VIDEOS_DIR, `${jobId}.json`);
  const temporaryPath = `${jsonPath}.tmp`;
  const sceneData = { meta: canonicalData.meta, scenes: canonicalData.scenes };
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(sceneData, null, 2), 'utf8');
    await fs.promises.rename(temporaryPath, jsonPath);
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
  return jsonPath;
}

function createRenderError(error) {
  if (error && ['RENDER_UNAVAILABLE', 'RENDER_TIMEOUT', 'RENDER_FAILED'].includes(error.code)) return error;
  const failure = new Error(error && error.message ? error.message : 'Remotion render failed.');
  failure.code = /timeout|timed out/i.test(failure.message)
    ? 'RENDER_TIMEOUT'
    : /chromium|browser|download/i.test(failure.message)
      ? 'RENDER_UNAVAILABLE'
      : 'RENDER_FAILED';
  failure.cause = error;
  return failure;
}

async function render(jobId, canonicalData, audioPath) {
  if (!UUID_REGEX.test(jobId)) throw new Error('Invalid job ID.');
  if (typeof audioPath !== 'string' ||
      path.resolve(audioPath) !== path.join(config.VIDEOS_DIR, `${jobId}.wav`)) {
    throw new Error('Narration audio does not match the render job.');
  }
  if (!acquireSlot()) {
    const error = new Error('Server is busy rendering another video.');
    error.code = 'BUSY';
    throw error;
  }

  const tempDir = path.join(config.TEMP_DIR, jobId);
  const tempMp4Path = path.join(tempDir, `${jobId}.mp4`);
  const mp4Path = path.join(config.VIDEOS_DIR, `${jobId}.mp4`);
  const audioSrc = `http://127.0.0.1:${config.PORT}/videos/${jobId}.wav`;
  let jsonPath = null;

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(config.VIDEOS_DIR, { recursive: true });
    jsonPath = await writeSceneJson(jobId, canonicalData);
    const browser = await ensureBrowser();
    if (browser.type === 'no-browser' || browser.type === 'version-mismatch') {
      const error = new Error('Remotion could not find or install Chromium.');
      error.code = 'RENDER_UNAVAILABLE';
      throw error;
    }

    const serveUrl = await getServeUrl();
    const inputProps = {
      scenes: canonicalData.scenes,
      audioSrc,
      fps: canonicalData.meta.fps
    };
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      logLevel: 'error'
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      outputLocation: tempMp4Path,
      inputProps,
      timeoutInMilliseconds: config.RENDER_TIMEOUT_MS,
      logLevel: 'error'
    });
    const stats = await fs.promises.stat(tempMp4Path);
    if (!stats.isFile() || stats.size === 0) {
      const error = new Error('Remotion did not produce an MP4 file.');
      error.code = 'RENDER_FAILED';
      throw error;
    }
    await fs.promises.rename(tempMp4Path, mp4Path);
    return {
      jsonPath,
      mp4Path,
      size: stats.size,
      durationSeconds: composition.durationInFrames / composition.fps
    };
  } catch (error) {
    await fs.promises.unlink(tempMp4Path).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    });
    if (jsonPath) {
      await fs.promises.unlink(jsonPath).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') throw cleanupError;
      });
    }
    throw createRenderError(error);
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } finally {
      releaseSlot();
    }
  }
}

module.exports = {
  render,
  checkRemotionAvailable,
  acquireSlot,
  releaseSlot,
  getSceneFrameRanges
};

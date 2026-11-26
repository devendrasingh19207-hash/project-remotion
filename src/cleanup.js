const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

const ttlMs = config.FILE_TTL_HOURS * 60 * 60 * 1000;

async function cleanDirectory(directory, removeOldDirectories = false) {
  let cleaned = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const filePath = require('path').join(directory, entry.name);
    const stats = await fs.promises.stat(filePath);
    if (Date.now() - stats.mtimeMs > ttlMs) {
      if (entry.isFile()) {
        await fs.promises.unlink(filePath);
        cleaned += 1;
      } else if (removeOldDirectories && entry.isDirectory()) {
        await fs.promises.rm(filePath, { recursive: true });
        cleaned += 1;
      }
    }
  }
  return cleaned;
}

async function runCleanup() {
  const uploads = await cleanDirectory(config.UPLOADS_DIR);
  const videos = await cleanDirectory(config.VIDEOS_DIR);
  const temporary = await cleanDirectory(config.TEMP_DIR, true);
  return { uploads, videos, temporary };
}

function startInterval() {
  const timer = setInterval(() => {
    runCleanup()
      .then((counts) => logger.log(null, 'cleanup', 'ok', undefined, counts))
      .catch((error) => logger.log(null, 'cleanup', 'error', undefined, { error: error.message }));
  }, 60 * 60 * 1000);
  timer.unref();
}

async function checkDiskSpace() {
  if (typeof fs.promises.statfs !== 'function') return { ok: true };
  const stats = await fs.promises.statfs(config.VIDEOS_DIR);
  const freeMB = Math.floor((stats.bavail * stats.bsize) / (1024 * 1024));
  return { ok: freeMB >= config.MIN_FREE_DISK_MB, freeMB };
}

module.exports = { runCleanup, startInterval, checkDiskSpace };

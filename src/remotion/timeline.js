function getSceneFrameRanges(scenes, totalFrames) {
  if (!Array.isArray(scenes) || scenes.length === 0 || !Number.isInteger(totalFrames) || totalFrames < scenes.length) {
    throw new Error('Invalid scene timing input.');
  }

  const weights = scenes.map((scene) => Number(scene.duration));
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error('Every scene must have a positive duration.');
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;
  let start = 0;
  return weights.map((weight, index) => {
    elapsedWeight += weight;
    const end = index === weights.length - 1
      ? totalFrames
      : Math.round(elapsedWeight / totalWeight * totalFrames);
    const range = { from: start, durationInFrames: end - start };
    start = end;
    return range;
  });
}

module.exports = { getSceneFrameRanges };

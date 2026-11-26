const test = require('node:test');
const assert = require('node:assert/strict');
const { getSceneFrameRanges } = require('../src/remotion/timeline');

test('allocates contiguous scene ranges that exactly fill the narration duration', () => {
  const scenes = [
    { duration: 4 },
    { duration: 8 },
    { duration: 4 }
  ];
  const ranges = getSceneFrameRanges(scenes, 480);

  assert.deepEqual(ranges, [
    { from: 0, durationInFrames: 120 },
    { from: 120, durationInFrames: 240 },
    { from: 360, durationInFrames: 120 }
  ]);
  assert.equal(ranges.reduce((total, range) => total + range.durationInFrames, 0), 480);
});

test('rejects scene ranges that cannot fit into the available frames', () => {
  assert.throws(
    () => getSceneFrameRanges([{ duration: 4 }, { duration: 5 }], 1),
    /Invalid scene timing input/
  );
});

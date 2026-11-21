import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const bundle = readFileSync(require.resolve('@paddlejs-models/ocr'), 'utf8');
const useUpstream = process.argv.includes('--upstream');
const source = useUpstream ? bundle : (await import('./lib/ocr-source-reuse.mjs')).reuseOcrSourceImage(bundle);
const endHelpers = source.lastIndexOf(',U=960,S=320');
const startHelpers = source.lastIndexOf('var y=function(', endHelpers);
const startRecognize = source.lastIndexOf('function d(A,I){');
const endRecognize = source.indexOf('function q(A,I)', startRecognize);
assert.ok(startHelpers >= 0 && endHelpers > startHelpers);
assert.ok(startRecognize > endHelpers && endRecognize > startRecognize);
const recognition = source.slice(startHelpers, endHelpers) + ';' + source.slice(startRecognize, endRecognize);

let reads = 0;
let releasedSources = 0;
let releasedTransforms = 0;
let predictionFailure = false;
class Mat {
  matSize = [32, 120];
  delete() {}
}
const cv = {
  Mat,
  Size: class {},
  Scalar: class {},
  matFromArray: () => new Mat(),
  getPerspectiveTransform: () => ({ delete() { releasedTransforms++; } }),
  imread: () => {
    reads++;
    return { delete() { releasedSources++; } };
  },
  warpPerspective() {},
  resize() {},
  imshow() {},
};
const points = [[[0, 0], [120, 0], [120, 32], [0, 32]], [[0, 50], [120, 50], [120, 82], [0, 82]], [[0, 100], [120, 100], [120, 132], [0, 132]]];
const context = vm.createContext({
  h: () => cv,
  e: values => values.flat(),
  G: Math.round,
  q: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  K: async () => structuredClone(points),
  M: {},
  k: { getContext() { return { clearRect() {}, drawImage() {} }; } },
  S: 320,
  N: class { outputResult() { return { text: 'sample' }; } },
  l: {
    async predict() {
      if (predictionFailure) throw new Error('recognition failed');
      return [];
    },
  },
});
vm.runInContext(recognition, context);
const result = await vm.runInContext('d({})', context);
assert.deepEqual([...result.text], ['sample', 'sample', 'sample']);
assert.equal(reads, 1, '3 detected text boxes should share one whole-image OpenCV decode');
assert.equal(releasedSources, 1);
assert.equal(releasedTransforms, 3);
predictionFailure = true;
await assert.rejects(vm.runInContext('d({})', context), /recognition failed/);
assert.equal(reads, 2, 'a later screenshot needs its own source image');
assert.equal(releasedSources, 2, 'failed recognition must free the retained image');
assert.equal(releasedTransforms, 4);
console.log('OCR reuses and frees one source image per screenshot');

import { readFile } from 'node:fs/promises';

const ocrEntry = /[\\/]@paddlejs-models[\\/]ocr[\\/]lib[\\/]index\.js$/;

// The locked PaddleOCR 1.2.4 package ships only a bundled recognizer. It
// decodes the full image inside the text-box loop. Keep one read-only Mat per
// recognition call, while retaining upstream detection, cropping and inference.
export function reuseOcrSourceImage(source) {
  const replacements = [
    ['function d(A,I){return y(', 'function d(A,I){var retainedSource;return y('],
    ['o=h().imread(A),D=new', 'o=retainedSource||(retainedSource=h().imread(A)),D=new'],
    ['h().imshow(M,r),o.delete(),D.delete(),r.delete(),Q.delete(),E.delete()', 'h().imshow(M,r),D.delete(),r.delete(),Q.delete(),E.delete(),i.delete()'],
    ['case 8:return[2,{text:B,points:g}]}}))}))}function q(A,I)', 'case 8:return[2,{text:B,points:g}]}}))})).finally(function(){if(retainedSource)retainedSource.delete()})}function q(A,I)'],
  ];
  for (const [upstream, optimized] of replacements) {
    const index = source.indexOf(upstream);
    if (index < 0 || index !== source.lastIndexOf(upstream)) {
      throw new Error('PaddleOCR bundle changed. Recheck the OpenCV source-image reuse patch.');
    }
    source = source.replace(upstream, optimized);
  }
  return source;
}

export function ocrProductionPlugin() {
  return {
    name: 'paddle-ocr-reuse-source',
    enforce: 'pre',
    transform(code, id) {
      if (ocrEntry.test(id)) return { code: reuseOcrSourceImage(code), map: null };
    },
  };
}

export function ocrPrebundlePlugin() {
  return {
    name: 'paddle-ocr-reuse-source',
    setup(build) {
      build.onLoad({ filter: ocrEntry }, async ({ path }) => ({
        contents: reuseOcrSourceImage(await readFile(path, 'utf8')),
        loader: 'js',
      }));
    },
  };
}

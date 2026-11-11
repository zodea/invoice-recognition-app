import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupPdfTextLines } from '../../src/lib/pdf-lines.js';

const require = createRequire(import.meta.url);
const cmapsDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps');
class NodeCMapReaderFactory {
  async fetch({ name }) {
    return { cMapData: new Uint8Array(fs.readFileSync(path.join(cmapsDir, `${name}.bcmap`))), isCompressed: true };
  }
}

// 手动批处理和回归脚本共用同一套中文字体映射、分行及资源回收逻辑。
export async function extractText(fileOrBytes) {
  const data = new Uint8Array(typeof fileOrBytes === 'string' ? fs.readFileSync(fileOrBytes) : fileOrBytes);
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0, cMapUrl: cmapsDir, cMapPacked: true, CMapReaderFactory: NodeCMapReaderFactory }).promise;
  try {
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try { out.push(...groupPdfTextLines((await page.getTextContent()).items).map(line => line.text)); }
      finally { page.cleanup(); }
    }
    return out.join('\n');
  } finally { await pdf.destroy(); }
}

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, resolveConfig } from 'vite';
import { cleanBuildOutput } from './lib/clean-build-output.mjs';

const root = await mkdtemp(path.join(tmpdir(), '构建清理-'));
try {
  const dist = path.join(root, 'dist');
  const assets = path.join(dist, 'assets');
  const models = path.join(root, 'public', 'ocr-models');
  await mkdir(assets, { recursive: true });
  await mkdir(models, { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<script type="module" src="./app.js"></script>');
  await writeFile(path.join(root, 'app.js'), 'console.log("build fixture")');
  await writeFile(path.join(models, 'model.json'), '{}');
  await writeFile(path.join(assets, 'stale.js'), '');
  await writeFile(path.join(dist, 'obsolete.css'), '');
  const config = { root, configFile: false, logLevel: 'silent', plugins: [cleanBuildOutput()], build: { emptyOutDir: true } };
  await resolveConfig(config, 'build');
  assert.deepEqual(await readdir(assets), ['stale.js']);
  await build(config);
  assert.deepEqual((await readdir(dist)).sort(), ['assets', 'index.html', 'ocr-models']);
  const [entry] = (await readFile(path.join(dist, 'index.html'), 'utf8')).match(/index-[\w-]+\.js/);
  assert.deepEqual(await readdir(assets), [entry]);
  assert.equal(await readFile(path.join(dist, 'ocr-models', 'model.json'), 'utf8'), '{}');
  await assert.rejects(build({ ...config, build: { ...config.build, outDir: root } }), /不安全的构建输出目录/);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('生产构建已清除旧 JS/CSS，保留本次入口并重新复制 OCR 模型');

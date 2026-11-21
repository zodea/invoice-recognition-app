import { existsSync } from 'node:fs';
import { cp, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

// Vite 5 uses recursive rmSync, which can leave files behind on Windows
// under a non-ASCII path. Wait for async removal before Vite copies public/.
export function cleanBuildOutput() {
  let config;
  return {
    name: 'clean-build-output',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async buildStart() {
      const { root, build, publicDir } = config;
      if (!build.write || !build.emptyOutDir) return;
      const outDir = path.resolve(root, build.outDir);
      let actual;
      try {
        actual = await realpath(outDir);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      const project = await realpath(root);
      const expected = path.resolve(project, path.relative(root, outDir));
      const toProject = path.relative(actual, project);
      const aboveProject = !path.isAbsolute(toProject) && toProject.split(path.sep)[0] !== '..';
      if (actual === path.parse(actual).root || aboveProject || path.relative(actual, expected) !== '') {
        throw new Error(`不安全的构建输出目录：${outDir}`);
      }
      for (const name of await readdir(actual)) {
        if (name !== '.git') await rm(path.join(actual, name), { recursive: true, force: true, maxRetries: 3 });
      }
      // In watch mode Vite copies public/ at BUNDLE_START, before this hook.
      if (this.meta.watchMode && build.copyPublicDir && publicDir && existsSync(publicDir)) {
        await cp(publicDir, actual, { recursive: true });
      }
    },
  };
}

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = new URL('./', import.meta.url);
// e2e 依赖本机真实票据，需手动运行；其余自测只用虚构数据，并自动纳入默认检查。
const scripts = readdirSync(directory)
  .filter(name => /(?:^|-)selftest\.mjs$/.test(name) && name !== 'e2e-selftest.mjs')
  .sort();

for (const script of scripts) {
  console.log(`\n▶ ${script}`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, directory))], {
    cwd: fileURLToPath(new URL('../', directory)),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`\n全部 ${scripts.length} 组自测通过。`);

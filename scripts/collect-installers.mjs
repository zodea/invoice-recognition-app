// npm run tauri:build 成功后自动归档安装包；不复制到项目根目录或预览截图目录。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const output = path.resolve(root, '../安装包');
const history = path.join(output, '历史版本');
const prefix = `${config.productName}_${config.version}_`;
const isInstaller = name => name.startsWith(`${config.productName}_`) && (name.endsWith('-setup.exe') || name.endsWith('.msi'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function assertRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`不是普通安装包文件：${file}`);
}
function ensureDirectory(directory) {
  if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw new Error(`安装包目录不可用：${directory}`);
  fs.mkdirSync(directory, { recursive: true });
}
function moveVerified(source, destination) {
  assertRegular(source);
  const before = hash(source);
  // 支持 Cargo 构建目录与安装包目录在不同磁盘。核对成功后才移除源副本。
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  if (hash(destination) !== before) throw new Error(`文件校验失败，源文件已保留：${source}`);
  fs.unlinkSync(source);
}
function archive(file) {
  ensureDirectory(history);
  const ext = path.extname(file), name = path.basename(file, ext);
  let target = path.join(history, path.basename(file));
  for (let i = 1; fs.existsSync(target); i++) target = path.join(history, `${name}_副本${i}${ext}`);
  moveVerified(file, target);
}

let sources = process.argv.slice(2).map(file => path.resolve(file));
if (!sources.length) {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml')], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || '无法读取 Cargo 输出目录');
  const target = JSON.parse(result.stdout).target_directory;
  for (const format of ['nsis', 'msi']) {
    const directory = path.join(target, 'release/bundle', format);
    if (fs.existsSync(directory)) sources.push(...fs.readdirSync(directory).filter(name => name.startsWith(prefix) && isInstaller(name)).map(name => path.join(directory, name)));
  }
}

for (const file of sources) {
  if (!isInstaller(path.basename(file)) || !path.basename(file).startsWith(prefix)) throw new Error(`不是当前版本的项目安装包：${file}`);
  assertRegular(file);
}
if (!sources.length) {
  console.log('未发现当前版本的 Windows 安装包；调试或仅编译模式无需归档。');
} else {
  ensureDirectory(output);
  for (const name of fs.readdirSync(output)) {
    if (isInstaller(name) && !name.startsWith(prefix)) archive(path.join(output, name));
  }
  for (const source of sources) {
    const destination = path.join(output, path.basename(source));
    if (source === destination) continue;
    if (fs.existsSync(destination)) archive(destination);
    moveVerified(source, destination);
    console.log(`安装包已统一保存：${destination}`);
  }
}

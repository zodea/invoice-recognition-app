import { fileHash } from './file-utils.js';
import { invokeTauri } from './platform.js';

export function isSystemFile(name) {
  return /^(?:~\$|\.DS_Store$|Thumbs\.db$)/i.test(name || '');
}

export function intakeFile(file, relativePath = file.webkitRelativePath || file.name) {
  const parts = String(relativePath).replaceAll('\\', '/').split('/').filter(Boolean);
  return { file, name: file.name, relativePath: parts.join('/'), parentFolder: parts.slice(0, -1).join('/'), ext: file.name.match(/\.([^.]+)$/)?.[1].toLowerCase() || '' };
}

export async function identifyIntakeFile(file) {
  const data = intakeFile(file);
  const sha256 = await fileHash(file);
  return { ...data, sha256, sha256Short: sha256.slice(0, 8) };
}

export function supplementFolder(parentFolder) {
  return /(?:^|\/)[^/]*(?:行程单|附件|明细)[^/]*(?:\/|$)/.test(parentFolder);
}

export function paymentEvidenceFolder(file) {
  return intakeFile(file).parentFolder.split('/').some(part => /^(?:垫资)?(?:付款|支付)(?:凭证|截图)(?:$|[（(\s])/.test(part));
}

export async function pickDesktopIntakeFolder() {
  const selection = await invokeTauri('pick_intake_folder');
  if (!selection) return null;
  const files = [];
  let skipped = selection.skipped;
  try {
    for (const [index, entry] of selection.files.entries()) {
      try {
        const bytes = await invokeTauri('read_intake_file', { selection: selection.id, index });
        const file = new File([new Uint8Array(bytes)], entry.name);
        Object.defineProperty(file, 'webkitRelativePath', { value: entry.path });
        files.push(file);
      } catch {
        skipped++;
      }
    }
  } finally {
    await invokeTauri('release_intake_folder', { selection: selection.id });
  }
  return { files, skipped };
}

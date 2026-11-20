import { fileHash } from './file-utils.js';

export function isSystemFile(name) {
  return /^(?:~\$|\.DS_Store$|Thumbs\.db$)/i.test(name || '');
}

export function intakeFile(file, relativePath = file.webkitRelativePath || file.name) {
  const parts = String(relativePath).replaceAll('\\', '/').split('/').filter(Boolean);
  return { file, name: file.name, relativePath: parts.join('/'), parentFolder: parts.slice(0, -1).join('/'), ext: file.name.match(/\.([^.]+)$/)?.[1].toLowerCase() || '' };
}

export async function identifyIntakeFile(file) {
  const data = intakeFile(file);
  return { ...data, sha256Short: (await fileHash(file)).slice(0, 8) };
}

export function supplementFolder(parentFolder) {
  return /(?:^|\/)[^/]*(?:行程单|附件|明细)[^/]*(?:\/|$)/.test(parentFolder);
}

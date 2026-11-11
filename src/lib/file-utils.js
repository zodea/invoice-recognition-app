// 文件基础操作：供识别、附件、打印和导出共用，不依赖 PDF/Excel 引擎。
export function isPdf(file) {
  return (file?.type || file?.blob?.type) === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

export async function fileHash(file) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes
    : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes || []);
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function downloadBytes(bytes, name, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // 给浏览器留出接管下载的时间，再释放文件内容。
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
}

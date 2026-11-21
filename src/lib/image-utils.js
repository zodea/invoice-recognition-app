// 取图片自然尺寸（用于横向自动旋转判断）。
export function imgNaturalSize(url) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve({ w: 0, h: 0 });
    im.src = url;
  });
}

// 把一张图片按 deg(顺时针 0/90/180/270) 旋转，返回新的对象 URL；deg=0 原样返回。
export async function rotateImageUrl(url, deg = 0) {
  const r = ((deg % 360) + 360) % 360;
  if (!url || r === 0) return url;
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  const swap = r === 90 || r === 270;
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return await new Promise((resolve) => {
    canvas.toBlob((blob) => {
      canvas.width = canvas.height = 0;
      resolve(blob ? URL.createObjectURL(blob) : url);
    }, 'image/png');
  });
}

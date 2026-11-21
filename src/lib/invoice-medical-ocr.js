import { parseInvoiceFilename } from './invoice-filename.js';

const medicalHeaderCrops = [
  { x: 0.43, y: 0.19, width: 0.55, height: 0.26 },
  { x: 0.43, y: 0, width: 0.55, height: 0.25 },
];

export function shouldRetryMedicalNumber(fields, filename) {
  if (fields.number) return false;
  return fields.docType === '医疗票据' || ((!fields.docType || fields.docType === '未识别') && parseInvoiceFilename(filename).type === '医疗票据');
}

export async function recoverMedicalReceiptNumber(page, recognizeRegion) {
  if (!page?.dataUrl) return null;
  for (const crop of medicalHeaderCrops) {
    const regions = [];
    try {
      const lines = await recognizeRegion(page, crop, hits => regions.push(...hits));
      const matches = lines.join('\n').normalize('NFKC').matchAll(/^[^\S\r\n]*(?:票\s*据|发\s*票|[桑垂栗景]\s*据|承\s*接)\s*号\s*码[ \t]*[:：]?[ \t]*(?:\r?\n[ \t]*)?(\d(?:[ \t]*\d){7,11})(?![ \t]*\d)/gm);
      const numbers = new Map(Array.from(matches, match => [match[1].replace(/\s/g, ''), match[0].trim()]));
      if (numbers.size > 1) return null;
      if (numbers.size === 1) {
        const [[number, text]] = numbers;
        return { number, text, regions };
      }
    } catch {
      continue;
    }
  }
  return null;
}

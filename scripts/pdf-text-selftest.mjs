import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { extractText } from './lib/pdf-text.mjs';
import { parseInvoice } from '../src/lib/invoice-parse.js';

// 在内存中构造依赖中文 CMap 的 PDF，防止旧版压缩标志导致中文字层变成乱码。
const doc = await PDFDocument.create();
const context = doc.context;
const descriptor = context.register(context.obj({ Type: 'FontDescriptor', FontName: 'STSong-Light', Flags: 6, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 880, StemV: 80 }));
const descendant = context.register(context.obj({ Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'STSong-Light', CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('GB1'), Supplement: 4 }, FontDescriptor: descriptor, DW: 1000 }));
const font = context.register(context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'STSong-Light', Encoding: 'UniGB-UCS2-H', DescendantFonts: [descendant] }));
const lines = ['电子发票（普通发票）', '发票号码：26442000000012345678', '开票日期：2026年11月11日', '购买方：测试甲方有限公司', '销售方：测试乙方商贸有限公司', '金额 100.00', '税额 13.00', '价税合计（小写）113.00'];
for (let i = 0; i < 2; i++) {
  const page = doc.addPage([600, 400]);
  page.node.setFontDictionary(PDFName.of('F1'), font);
  const commands = lines.map((line, index) => {
    const hex = [...line].map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    return `BT /F1 12 Tf 30 ${360 - index * 35} Td <${hex}> Tj ET`;
  }).join('\n');
  page.node.addContentStream(context.register(context.flateStream(commands)));
}
const text = await extractText(await doc.save());
assert.equal(text.match(/购买方/g)?.length, 2, '中文字体映射和多页文字应完整抽取');
const fields = parseInvoice(text);
assert.equal(fields.number, '26442000000012345678');
assert.equal(fields.date, '2026-11-11');
assert.equal(fields.buyer, '测试甲方有限公司', '完整购买方标签不能混入名称');
assert.equal(fields.seller, '测试乙方商贸有限公司', '完整销售方标签不能混入名称');
assert.equal(Number(fields.total), 113);
console.log('中文 CMap、多页 PDF 抽取及完整买卖方标签回归检查通过');

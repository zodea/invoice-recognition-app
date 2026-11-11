import assert from 'node:assert/strict';
import { keyFieldRegions, ocrTextRegions, pdfTextRegions, rotateRegion } from '../src/lib/recognition-regions.js';

const regions = ocrTextRegions({
  text: ['发票号码：12345678', '日期：2026年3月9日', '价税合计 ¥1,234.50', '税额 12.30', '无坐标文字'],
  points: [
    [[10, 20], [200, 20], [200, 40], [10, 40]],
    [[10, 50], [200, 50], [200, 70], [10, 70]],
    [[10, 80], [200, 80], [200, 100], [10, 100]],
    [[10, 110], [200, 110], [200, 130], [10, 130]],
  ],
}, 400, 200);
assert.equal(regions.length, 4);
assert.deepEqual(regions[0], { x: .025, y: .1, width: .475, height: .1, text: '发票号码：12345678', page: 0 });
const boxes = keyFieldRegions({ number: '12345678', date: '2026-03-09', total: '1234.50', tax: 12.3 }, regions);
assert.deepEqual(boxes.map(box => box.key), ['number', 'date', 'tax', 'total']);
assert.equal(keyFieldRegions({ number: '345678' }, regions).length, 0, '不能将长号码的一段当成匹配');
assert.equal(keyFieldRegions({ total: 234.5 }, regions).length, 0, '金额必须完整匹配');
assert.equal(keyFieldRegions({ number: '87654321' }, regions).length, 0, '人工修改值或文件名补录无对应原文时不猜位置');
assert.equal(keyFieldRegions({ number: '12345678' }, regions, 1).length, 0, '页面之间不能串位');
assert.equal(ocrTextRegions({ text: ['文字'], points: [[[NaN, 2]]] }, 100, 100).length, 0);

const split = ['广东', '示例', '有限公司'].map((text, i) => ({ text, x: .1 + i * .1, y: .2, width: .1, height: .03, page: 0 }));
const merged = keyFieldRegions({ buyer: '广东示例有限公司' }, split);
assert.equal(merged.length, 1);
assert.equal(merged[0].text, '广东示例有限公司');
assert.ok(Math.abs(merged[0].width - .3) < 1e-9);

const original = { x: .1, y: .2, width: .3, height: .1 };
assert.deepEqual(rotateRegion(original, 90), { x: .7000000000000001, y: .1, width: .1, height: .3 });
const restored = rotateRegion(rotateRegion(original, 90), 270);
for (const key of Object.keys(original)) assert.ok(Math.abs(restored[key] - original[key]) < 1e-9);

const pdf = pdfTextRegions({ items: [{ str: '12345678', width: 80, height: 10, transform: [10, 0, 0, 10, 20, 150] }], styles: {} }, { width: 400, height: 200, transform: [1, 0, 0, -1, 0, 200] });
assert.equal(pdf.length, 1);
assert.equal(pdf[0].x, .05);
assert.equal(pdf[0].y, .21);
assert.equal(pdf[0].width, .2);
assert.equal(keyFieldRegions({ number: '12345678' }, pdf).length, 1);
assert.deepEqual(keyFieldRegions({}, pdf), []);
console.log('PDF / OCR 真实区域、字段匹配、跨文本块合并、页码隔离及旋转坐标检查通过');

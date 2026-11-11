import assert from 'node:assert/strict';
import { centerPreviewAt, previewCenter, visiblePreviewRegion } from '../src/lib/preview-navigation.js';

const viewport = { left: 100, top: 100, width: 400, height: 300 };
assert.deepEqual(visiblePreviewRegion(viewport, { left: 150, top: 120, width: 200, height: 200 }), { x: 0, y: 0, width: 1, height: 1 }, '居中留白时框住整张票面');
assert.deepEqual(visiblePreviewRegion(viewport, { left: -300, top: -200, width: 800, height: 600 }), { x: .5, y: .5, width: .5, height: .5 }, '拖至右下角时框线应与滚动位置一致');
assert.deepEqual(visiblePreviewRegion(viewport, { left: 100, top: 100, width: 400, height: 900 }), { x: 0, y: 0, width: 1, height: 1 / 3 }, '旋转为竖向后使用实际长宽');
assert.equal(visiblePreviewRegion(viewport, { left: 0, top: 0, width: 0, height: 0 }), null, '图片尚未加载时不显示无效鸟瞰框');
const page = { getBoundingClientRect: () => ({ left: -300, top: -200, width: 800, height: 600 }) };
const scroller = { scrollLeft: 400, scrollTop: 300, clientWidth: 400, clientHeight: 300, clientLeft: 0, clientTop: 0, getBoundingClientRect: () => viewport };
assert.deepEqual(previewCenter(viewport, page.getBoundingClientRect()), { x: .75, y: .75 });
centerPreviewAt(scroller, page, { x: .5, y: .5 });
assert.deepEqual([scroller.scrollLeft, scroller.scrollTop], [200, 150], '点击鸟瞰中心应把页面中心移到视口中心');
assert.deepEqual(previewCenter(viewport, { width: 0, height: 0 }), { x: .5, y: .5 });
console.log('鸟瞰可见区域、居中留白、滚动定位、旋转尺寸及缩放中心检查通过');

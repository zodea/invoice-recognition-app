import assert from "node:assert/strict";
import { createPreviewPan } from "../src/lib/preview-pan.js";

const captures = [];
const viewport = {
  scrollLeft: 100, scrollTop: 80,
  setPointerCapture(id) { captures.push(["set", id]); },
  releasePointerCapture(id) { captures.push(["release", id]); },
  hasPointerCapture() { return true; },
};
const states = [];
const pan = createPreviewPan(() => viewport, value => states.push(value));
const pointer = (id, x, y, button = 0) => ({ pointerId: id, clientX: x, clientY: y, button, preventDefault() { this.prevented = true; } });

const rightClick = pointer(3, 20, 20, 2);
pan.down(rightClick);
assert.equal(rightClick.prevented, undefined, "右键不应开始平移");
const start = pointer(4, 100, 100);
pan.down(start);
assert.equal(start.prevented, true, "左键拖动应阻止图片原生拖拽");
pan.move(pointer(9, 60, 70));
assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [100, 80], "其他指针不能移动预览");
pan.move(pointer(4, 60, 70));
assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [140, 110], "拖动时应按指针位移平移票面");
pan.up(pointer(4, 60, 70));
pan.move(pointer(4, 10, 10));
assert.deepEqual([viewport.scrollLeft, viewport.scrollTop], [140, 110], "释放后不再平移");
assert.deepEqual(captures, [["set", 4], ["release", 4]]);
assert.deepEqual(states, [true, false]);
console.log("票面拖拽平移测试通过");

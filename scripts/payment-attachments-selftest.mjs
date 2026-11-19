import assert from 'node:assert/strict';
import { activePaymentAttachments, paymentAttachmentItems } from '../src/lib/payment-attachments.js';
const original={name:'支付.png'},order={name:'订单.png'};
const list=paymentAttachmentItems({evidenceHash:'old'}, {blob:original,name:'原始截图',supplements:[{blob:order,name:'订单图',kind:'订单详情',hash:'order'}]});
assert.equal(list.length,2);assert.equal(list[0].blob,original);assert.equal(list[0].hash,'old');assert.equal(list[1].blob,order);assert.equal(list[1].kind,'订单详情');
const reverse=paymentAttachmentItems({evidenceKind:'订单详情',evidenceHash:'later'},{blob:order,supplements:[{blob:original,kind:'付款凭证',hash:'later'}]});
assert.equal(reverse[0].hash,'');assert.equal(reverse[1].hash,'later');
console.log('旧版原件和多附件独立打开、订单性质测试通过');

assert.deepEqual(activePaymentAttachments({duplicateAttachmentHashes:['old']},list).map(i=>i.blob),[order]);
assert.deepEqual(activePaymentAttachments({},list).map(i=>i.blob),[original,order]);

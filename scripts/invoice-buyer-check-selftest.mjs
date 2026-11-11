import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { createBuyerChecker, matchesBuyerCheck } from '../src/lib/invoice-buyer-check.js';
import { expenseOptions } from '../src/lib/expense-options.js';
import { useBuyerCheck } from '../src/composables/useBuyerCheck.js';
import { directory } from '../src/lib/expense-directory.js';

const buyer = '广东测试（广州）工程有限公司';
const check = createBuyerChecker([buyer]);
assert.equal(check({ buyer }), 'matched');
assert.equal(check({ buyer: ' 广东 测试(广州)工程有限公司\n' }), 'matched');
assert.equal(check({ buyer: '广东测试（广州）工程有限公同' }), 'unmatched');
assert.equal(check({ buyer: '广东测试' }), 'unmatched');
assert.equal(check({ buyer: '91440101MAXPYYU4M' }), 'unmatched');
assert.equal(check({ buyer: ' ' }), 'missing');
assert.equal(check({ type: '行程单' }), 'exempt');
assert.equal(check({ docType: '医疗票据' }), 'exempt');
assert.equal(createBuyerChecker([])({ buyer }), 'unconfigured');
assert.equal(matchesBuyerCheck('unconfigured', 'issues'), false);
assert.equal(matchesBuyerCheck('exempt', 'issues'), false);
assert.equal(matchesBuyerCheck('missing', 'issues'), true);
assert.equal(matchesBuyerCheck('unmatched', 'issues'), true);
assert.equal(matchesBuyerCheck('matched', 'issues'), false);
assert.equal(matchesBuyerCheck('missing', 'unmatched'), false);

const records = reactive([{ buyer }, { buyer: '另一家公司' }, { buyer: '' }, { type: '行程单' }]);
const originalBuyers = directory.buyers;
try {
  directory.buyers = [buyer];
  const { checker, counts } = useBuyerCheck(() => records);
  assert.deepEqual(counts.value, { missing: 1, unmatched: 1, issues: 2 });
  directory.buyers.push('另一家公司');
  assert.equal(counts.value.issues, 1, '新增档案后应即时重新匹配已有发票');
  records[2].buyer = buyer;
  assert.equal(counts.value.issues, 0, '修正购买方后应即时退出异常结果');
  assert.equal(checker.value(records[2]), 'matched');
  directory.buyers = [];
  assert.equal(counts.value.issues, 0, '未配置档案不能把所有票据误报为异常');
} finally { directory.buyers = originalBuyers; }

assert.deepEqual(expenseOptions({ buyers: [buyer] }, [{ buyer: '税号或识别噪声' }]).buyer, [buyer]);
assert.deepEqual(expenseOptions({}, [{ buyer }]).buyer, []);
console.log('购买方档案排查、格式归一、特殊票据豁免、实时更新和候选来源验证通过');

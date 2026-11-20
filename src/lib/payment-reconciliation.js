import { paymentRange } from './payment-transactions.js';
import { paymentAmountDifference, paymentSellerMatch } from './paymentFileMatcher.js';

const normalize = v => String(v ?? '').normalize('NFKC').replace(/\s+/g,'');
const hasAmount = v => v !== '' && v != null && Number.isFinite(Number(v));
const sameAmount = (a,b) => hasAmount(a) && hasAmount(b) && Math.round(Number(a)*100) === Math.round(Number(b)*100);

export function paymentEvidenceCandidates(record, files) {
  const range = paymentRange(record.dateRange);
  const candidates = [];
  const linkedOrders = new Set();
  for (const file of files) {
    const fields = file.fields || {};
    if (fields.direction==='income' || ['failed','pending'].includes(fields.paymentStatus)) continue;
    const sellerMatch = paymentSellerMatch(record.seller, fields.seller);
    const sameSeller = !!sellerMatch;
    const sameDate = !!record.date && fields.date===record.date;
    const sameTotal = fields.kind!=='order' && sameAmount(record.total,fields.total);
    const content = normalize((file.pages || []).map(p=>p.text).join(' '));
    const clues = [...new Set([record.purpose,record.project,record.note,...(record.lines||[]).map(l=>l.purpose)].map(normalize))]
      .filter(v=>v.length>=2 && content.includes(v));
    const stage = record.recordType==='阶段汇总';
    if (stage) {
      const observations = file.transactions?.length ? file.transactions.map(t=>t.fields||t) : [fields];
      if (!observations.some(t=>{
        if (t.direction==='income' || ['pending','failed'].includes(t.paymentStatus)) return false;
        if (t.date && ((range.start && t.date<range.start)||(range.end && t.date>range.end))) return false;
        return (t.date && (range.start || range.end)) || (record.seller && normalize(t.seller)===normalize(record.seller)) || clues.length;
      })) continue;
    } else {
      if (record.date && fields.date && !sameDate) continue;
      if (fields.kind !== 'order' && hasAmount(fields.total) && hasAmount(record.total) && !sameTotal) {
        const difference = paymentAmountDifference(record.total, fields.total);
        if (sameDate && (sameSeller || clues.length) && Math.abs(difference) <= 10) candidates.push({ file, sameSeller, score: 0, hint: `同日差额候选：${difference > 0 ? '+' : '−'}${Math.abs(difference).toFixed(2)} 元，需手动核对` });
        continue;
      }
      if (!(sameDate && sameTotal) && !(sameSeller && (sameTotal || sameDate || clues.length)) && !(clues.length && (sameTotal || sameDate))) continue;
    }
    const reasons=[sameDate && '日期',sameTotal && '金额',sameSeller && (sellerMatch === 'alias' ? '收款方别名' : '收款方'),clues.length && '用途、项目或备注'].filter(Boolean);
    const hint = reasons.length ? reasons.join('、')+'相符' : '符合阶段范围，请核对逐笔交易';
    candidates.push({file,sameSeller,score:reasons.length,hint});
    if (fields.orderId && sameSeller && sameTotal && sameDate && fields.kind==='payment') linkedOrders.add(fields.orderId);
  }
  for (const file of files) {
    if (file.fields?.kind==='order' && linkedOrders.has(file.fields.orderId) && !candidates.some(c=>c.file===file))
      candidates.push({file,sameSeller:false,score:2,hint:'订单号与付款候选相同，可作为补充附件'});
  }
  return candidates.sort((a,b)=>b.score-a.score || Number(b.sameSeller)-Number(a.sameSeller));
}
function sourceConflict(a,b) {
  return ['date','seller','payer','project','purpose','recordType','dateRange'].some(k=>normalize(a[k])!==normalize(b[k])) ||
    !sameAmount(a.total,b.total) || (a.rawRows && b.rawRows && JSON.stringify(a.rawRows)!==JSON.stringify(b.rawRows));
}
function sourceRows(record) {
  const m=record.id?.match(/^(.*\|)(\d+)$/);
  return m ? Array.from({length:Math.max(1,record.rawRows?.length||0)},(_,i)=>m[1]+(Number(m[2])+i)) : [record.id];
}
export function reviewPaymentImport(records,existing,files=[],period='',{confirmed=[],excluded=[]}={}) {
  const origins=new Map(existing.flatMap(r=>sourceRows(r).map(key=>[key,r])));
  const included=[...existing];
  return records.map(record=>{
    const keys=sourceRows(record);
    const prior=keys.map(key=>origins.get(key)).find(Boolean);
    const warnings=[...(record.importWarnings || [])];
    if (record.manualTotal && hasAmount(record.lineTotal) && !sameAmount(record.total,record.lineTotal)) warnings.push('调整后的实付与明细合计不一致');
    const issues=[];
    let status='可新增待核对', canImport=true;
    const stage=record.recordType==='阶段汇总';
    const complete=(stage || (record.date && record.seller)) && hasAmount(record.total);
    if (prior) {
      status=prior.id!==record.id || sourceConflict(prior,record) ? '来源内容冲突' : '来源已存在';
      issues.push('保留已有款项、归属、报销状态及附件'); canImport=false;
    } else if (record.recordType==='合计') {
      status='统计汇总行'; canImport=false;
    } else if (!complete) {
      status='信息不完整'; issues.push('请核对日期、收款方和实付金额，阶段汇总可保留未知日期'); canImport=false;
    } else {
      const similar=included.some(row=>row.date===record.date && normalize(row.seller)===normalize(record.seller) && sameAmount(row.total,record.total));
      if (similar) {status='疑似重复'; issues.push('其他款项的日期、金额、收款方相同，请确认是否独立付款');}
      else if (warnings.some(w=>/不一致|边界|为空/.test(w))) status='需人工核对';
      if (status!=='可新增待核对') {
        canImport=confirmed.includes(record.id);
        if (canImport) status='已人工核对';
      }
    }
    const candidates=paymentEvidenceCandidates(record,files);
    issues.push(...warnings);
    if (!record.payer) issues.push('付款名称未知');
    if (!candidates.length && record.recordType!=='合计' && record.recordType!=='现金无凭证' && !record.cashWithoutEvidence) issues.push('暂无匹配凭证，可手动选择');
    if (!excluded.includes(record.id)) {
      for (const key of keys) if (!origins.has(key)) origins.set(key,record);
      if (canImport) included.push(record);
    }
    return {record:{...record,reimbursementPeriod:period,evidenceConfirmed:false,...(status==='已人工核对'?{importManuallyReviewed:true}:{})},status,issues,candidates,canImport};
  });
}

import * as XLSX from 'xlsx/xlsx.mjs';

import { attachmentReferences, embeddedSheetFiles } from './payment-sheet-files.js';

const text = v => String(v ?? '').trim();
const pad = v => String(v).padStart(2, '0');
export function paymentDate(value, date1904 = false) {
  if (value instanceof Date) return Number.isFinite(+value) ? [value.getFullYear(), pad(value.getMonth()+1), pad(value.getDate())].join('-') : '';
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value, { date1904 });
    return d ? paymentDate([d.y, d.m, d.d].join('-')) : '';
  }
  const m = text(value).match(/((?:19|20)\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?!\d)/);
  if (!m) return '';
  const date = [m[1], pad(m[2]), pad(m[3])].join('-');
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().startsWith(date) ? date : '';
}

// SheetJS 0.18 converts ISO date cells through the machine's timezone, even with
// cellDates:false. Preserve the calendar part written in the worksheet for t="d".
function restoreIsoDates(book) {
  const xml = path => new TextDecoder().decode(book.files?.[path]?.content);
  const targets = new Map();
  const attr = (tag, name) => tag.match(new RegExp('\\b' + name + '=["\']([^"\']*)["\']'))?.[1];
  for (const [tag] of xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]+>/g)) {
    const target = attr(tag, 'Target');
    if (target) targets.set(attr(tag, 'Id'), target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  }
  for (const sheet of book.Workbook?.Sheets || []) {
    const data = xml(targets.get(sheet.id));
    for (const match of data.matchAll(/<c\b([^>]*\bt=["']d["'][^>]*)>\s*<v>([^<]+)<\/v>/g)) {
      const cell = book.Sheets[sheet.name]?.[attr(match[1], 'r')];
      if (cell) cell.v = match[2];
    }
  }
}

const columns = {
  date: ['付款日期','支付日期','下单日期','日期'], seller: ['收款名称','收款人','收款方','名字','姓名'],
  payer: ['付款名称','付款人'], project: ['使用项目','使用工地','项目','工地'], purpose: ['材料或费用名称','材料名称','费用名称','用途'],
  total: ['实付合计','实付金额','实际支付金额','付款总额','合计'], amount: ['明细金额','金额(元)','金额'],
  unit: ['单位'], quantity: ['数量'], price: ['单价'], type: ['记录类型'], range: ['日期范围'],
  start: ['期间开始'], end: ['期间结束'], evidence: ['凭证情况'], team: ['使用班组/单位'], number: ['送货单编号'],
  refund: ['退回金额'], note: ['备注'], status:['报销状态'], issue:['核对问题','需要调整的问题']
};
const header = v => text(v).normalize('NFKC').replace(/\s/g,'');
const summaryLabel = /^(?:本页|本期|本月|本季|本年|本次)?(?:合计|小计|总计|统计合计)[:：]?$/;
const numeric = v => typeof v === 'number' || /^[-+]?\d+(?:\.\d+)?$/.test(text(v));
const cents = v => Math.round(Number(v) * 100);

function readSheet(ws, sheet, source, epoch) {
  if (!ws['!ref']) return [];
  const area = XLSX.utils.decode_range(ws['!ref']);
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', range:{s:{r:area.s.r,c:0},e:area.e}});
  const i = rows.findIndex(row => {
    const h = row.map(header);
    return columns.seller.some(k => h.includes(k)) && (columns.date.some(k => h.includes(k)) || h.includes('日期范围') || h.includes('记录类型'));
  });
  if (i < 0) return [];
  const h = rows[i].map(header);
  const index = Object.fromEntries(Object.entries(columns).map(([key,names])=>[key,names.map(n=>h.indexOf(n)).find(n=>n>=0)]));
  const cell = (r,c) => c == null ? undefined : ws[XLSX.utils.encode_cell({r,c})];
  const raw = (r,key) => cell(r,index[key])?.v ?? '';
  const first = i + area.s.r + 1;
  const identity = ['date','payer','seller','project'];
  const vertical = (ws['!merges'] || []).filter(m=>m.s.c===m.e.c && m.e.r>m.s.r && m.e.r>=first);
  const groups = vertical.filter(m=>identity.some(k=>index[k]===m.s.c)).sort((a,b)=>a.s.r-b.s.r);
  const reimbursementBatches = new Map(vertical.filter(merge => {
    if (merge.s.c !== index.total || h[index.total] !== '实付合计' || merge.s.r < first || !numeric(raw(merge.s.r, 'total'))) return false;
    const overlapping = groups.filter(group => group.s.r <= merge.e.r && merge.s.r <= group.e.r);
    return overlapping.every(group => group.s.r >= merge.s.r && group.e.r <= merge.e.r) && !overlapping.some(group => group.s.r === merge.s.r && group.e.r === merge.e.r);
  }).map(merge => [merge.s.r, merge]));
  const read = (r,key) => {
    const m = vertical.find(m=>m.s.c===index[key] && m.s.r<=r && r<=m.e.r);
    return raw(m?.s.r ?? r,key);
  };
  const records = [];
  for (let start=first; start<=area.e.r;) {
    const reimbursementBatch = reimbursementBatches.get(start);
    let end=reimbursementBatch?.e.r ?? start;
    const spans=[];
    for (const m of groups) {
      if (m.s.r>end) break;
      if (m.e.r>=start) { spans.push(m); end=Math.max(end,Math.min(area.e.r,m.e.r)); }
    }
    const rowNumbers=Array.from({length:end-start+1},(_,i)=>start+i);
    const warnings=[];
    const values=key=>rowNumbers.map(r=>raw(r,key)).filter(v=>text(v)!=='');
    const boundaryConflict=!reimbursementBatch && (spans.some(m=>m.s.r!==start||m.e.r!==end)
      || [...identity,'type','range'].some(k=>new Set(values(k).map(text)).size>1)
      || vertical.some(m=>m.s.c===index.total && m.s.r<=end && m.e.r>=start && (m.s.r<start || m.e.r>end)));
    if (!reimbursementBatch && spans.length && rowNumbers.slice(1).some(r=>['date','seller','payer'].filter(k=>text(raw(r,k))).length>=2)) warnings.push('合并范围内再次填写付款信息，请核对边界');
    if (boundaryConflict) warnings.push('付款信息或实付金额的合并边界不一致，请对照原始行');
    const lines=rowNumbers.map(r=>({purpose:text(raw(r,'purpose')),unit:raw(r,'unit'),quantity:raw(r,'quantity'),unitPrice:raw(r,'price'),lineAmount:raw(r,'amount')}))
      .filter(line=>Object.values(line).some(v=>text(v)!==''));
    if (lines.length>1 && vertical.some(m=>m.s.c===index.amount && m.s.r<=end && m.e.r>=start)) warnings.push('明细金额单元格跨行合并，逐项金额边界需核对');
    const amounts=lines.map(l=>l.lineAmount).filter(v=>text(v)!=='');
    const lineTotal=amounts.length && amounts.every(numeric) ? amounts.reduce((sum,v)=>sum+cents(v),0)/100 : '';
    if (amounts.some(v=>!numeric(v))) warnings.push('明细金额格式不一致，请核对原始值');
    const explicitValues=values('total');
    const explicitTotal=explicitValues[0] ?? '';
    if (explicitValues.some(v=>!numeric(v)) || new Set(explicitValues.map(Number)).size>1) warnings.push('原表实付金额不一致或无效');
    const total=text(explicitTotal)!=='' ? (numeric(explicitTotal)?Number(explicitTotal):'') : lineTotal;
    if (text(explicitTotal)!=='' && lineTotal!=='' && cents(explicitTotal)!==cents(lineTotal)) warnings.push('原表实付 '+explicitTotal+' 元与明细合计 '+lineTotal+' 元不一致');
    if (text(explicitTotal)==='' && lineTotal!=='') warnings.push('按 '+amounts.length+' 条明细合计 '+lineTotal+' 元');
    if (amounts.length<lines.length && (amounts.length || text(explicitTotal)==='')) warnings.push('部分明细金额为空，请核对合计');
    if (rowNumbers.some(r=>['total','amount'].some(k=>cell(r,index[k])?.f && text(raw(r,k))===''))) warnings.push('金额公式的缓存值为空，请在 Excel 重算或人工填写');
    const get=k=>read(start,k);
    const dates = [...new Set(rowNumbers.map(row => paymentDate(read(row, 'date'), epoch)).filter(Boolean))].sort();
    const date=dates.length===1?dates[0]:paymentDate(get('date'),epoch);
    const sellers = [...new Set(rowNumbers.map(row => text(read(row, 'seller'))).filter(Boolean))];
    const seller=reimbursementBatch ? (sellers.length===1 ? sellers[0] : sheet) : text(get('seller'));
    if (reimbursementBatch) warnings.push('实付合计跨多行，请对照原表、收款方和凭证，确认报销批次边界');
    const originalType=text(get('type')), cash=text(get('evidence'))==='现金无凭证' || /(?:送礼金额|现金无凭证)$/.test(header(sheet));
    const labelFound=rowNumbers.some(r=>rows[r-area.s.r]?.some(v=>summaryLabel.test(text(v))));
    const summarySheet=/(?:汇总|统计)(?:表|页|清单)?$/.test(sheet);
    let recordType=originalType;
    if (originalType==='统计合计' || (!originalType && (labelFound || summarySheet))) recordType='合计';
    else if (['','明细','普通费用'].includes(originalType)) recordType=cash?'现金无凭证':reimbursementBatch?'报销批次':'';
    else if (!['合计','阶段汇总','现金无凭证'].includes(recordType)) warnings.push('记录类型与支持的类型不一致，请确认');
    const part=k=>paymentDate(get(k),epoch)||text(get(k));
    const rangeValue=get('range');
    const dateRange=typeof rangeValue==='number'?paymentDate(rangeValue,epoch):text(rangeValue) || ((part('start')||part('end'))?[part('start')||'未知',part('end')||'未知'].join('至'):'');
    let payer=text(get('payer'));
    if (!payer && index.payer==null && h[0]==='日期' && !h[1] && h[2]==='收款名称') {
      const value=text(cell(start,1)?.v);
      if (/^(建行|建设银行|工行|工商银行|农行|农业银行|中行|中国银行|交行|交通银行|招行|招商银行|现金|个人|私人)$/.test(value)) payer=value;
    }
    if (lines.length || seller || date || text(explicitTotal) || originalType || text(get('note')) || payer) {
      const rawRows=rowNumbers.map(r=>Object.fromEntries(h.map((name,c)=>[rows[i][c]||'列'+(c+1),cell(r,c)?.v ?? (cell(r,c)?.f?'='+cell(r,c).f:'')])));
      const attachmentRefs=attachmentReferences(ws,h,rowNumbers,cell);
      const sourceIssues=[...new Set(values('issue').map(text))];
      const originalStatus=text(get('status'));
      records.push({attachmentRefs,sourceFile:source,sourceSheet:sheet,firstRow:start+1,lastRow:end+1,sourceIssues,originalStatus,id:[source,sheet,start+1].join('|'), source:source+' / '+sheet+' / 行'+(start+1)+(end>start?'-'+(end+1):''),
        date,dateRange:dateRange || (reimbursementBatch && dates.length ? dates[0]+'至'+dates.at(-1) : ''),recordType,sourceRecordType:originalType,cashWithoutEvidence:cash,seller,total,payer,
        project:text(get('project')),purpose:lines.map(l=>l.purpose).filter(Boolean).join(' / '),lines,rawRows,
        team:text(get('team')),deliveryNumber:text(get('number')),buyer:'',refund:get('refund'),note:[...new Set(values('note').map(text))].join(' / '),
        reimbursement:'未核对',evidenceHash:'',evidenceConfirmed:false,importWarnings:warnings,explicitTotal,lineTotal});
    }
    start=end+1;
  }
  return records;
}
export function readPaymentExcel(bytes) {
  const book=XLSX.read(new Uint8Array(bytes),{type:'array',cellDates:false,bookFiles:true});
  restoreIsoDates(book);
  return book;
}
export function readPaymentBatch(bytes,source='') {
  const book=readPaymentExcel(bytes);
  if (book.SheetNames.some(name=>['发票归属','付款归属'].includes(name))) throw new Error('这是归属导入表，请使用“批量导入归属”入口');
  const records=[],embedded=[];
  for(const sheet of book.SheetNames){
    const rows=readSheet(book.Sheets[sheet],sheet,source,!!book.Workbook?.WBProps?.date1904);
    if(!rows.length)continue;
    for(const item of embeddedSheetFiles(book,sheet,source)){
      const record=rows.find(r=>r.firstRow<=item.row && item.row<=r.lastRow);
      if(record){record.attachmentRefs.push(item.path);embedded.push(item);}
    }
    records.push(...rows);
  }
  return {records,embedded};
}
export function parsePaymentWorkbook(bytes,source='') {
  return readPaymentBatch(bytes,source).records;
}

export function paymentDuplicate(a,b){return !!a.evidenceHash&&a.evidenceHash===b.evidenceHash&&a.date===b.date&&Math.round(Number(a.total)*100)===Math.round(Number(b.total)*100);}
export function allocationKind(e){if(e.allocation)return e.allocation;if(/汽油|柴油|加油|成品油/.test([e.purpose,e.service,e.category,e.remark].join(' ')))return '加油';if(e.payer==='个人')return '个人报账';return e.project?'指定工地':'待确认';}
export function allocationIssue(e){const kind=allocationKind(e);return kind==='待确认'?'请确认费用归属：办公室房租、水电、车辆维修、跨项目运费或代付退款等':kind==='指定工地'&&!e.project?'请选择工地':'';}

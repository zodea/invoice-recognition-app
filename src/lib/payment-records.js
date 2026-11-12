import * as XLSX from 'xlsx';
export function paymentDate(v) {
 if(v instanceof Date)return [v.getFullYear(),String(v.getMonth()+1).padStart(2,'0'),String(v.getDate()).padStart(2,'0')].join('-');
 if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);return d ? [d.y,String(d.m).padStart(2,'0'),String(d.d).padStart(2,'0')].join('-') : '';}
 const m=String(v||'').match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);if(!m)return '';const value=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?value:'';
}
export function parsePaymentWorkbook(bytes,source='',options={}) {
 const w=XLSX.read(bytes,{type:'array',cellDates:true}), out=[];
 for(const sheet of w.SheetNames){const rows=XLSX.utils.sheet_to_json(w.Sheets[sheet],{header:1,defval:''});const hi=rows.findIndex(r=>(r.includes('下单日期')&&r.includes('收款名称'))||(r.includes('日期')&&r.includes('名字')&&r.includes('金额')));if(hi<0)continue;
 const h=rows[hi];const get=(r,...keys)=>{const i=keys.map(k=>h.indexOf(k)).find(i=>i>=0);return i==null?'':r[i];};let current=null;
 rows.slice(hi+1).forEach((r,i)=>{const date=paymentDate(get(r,'下单日期','日期'));const seller=String(get(r,'收款名称','名字','职位')).trim();const purpose=String(get(r,'材料或费用名称'));const line={purpose,unit:get(r,'单位'),quantity:get(r,'数量'),unitPrice:get(r,'单价'),lineAmount:get(r,'金额（元）','金额')};
 if(!date&&!seller){if(current&&purpose){current.purpose+=' / '+purpose;current.lines.push(line);}return;}
 const raw=get(r,'实付合计','合计');const amount=raw!==''?raw:get(r,'金额（元）','金额');
 if((!date&&!seller)||/^(合计|总计|小计|收款名称|名字)$/.test(seller))return;
 const validAmount=amount!==''&&Number.isFinite(Number(amount));if(!validAmount&&!options.includeInvalid)return;
 current={id:source+'|'+sheet+'|'+(hi+i+2),source:source+' / '+sheet+' / 行'+(hi+i+2),date,seller,total:validAmount?Number(amount):'',payer:String(get(r,'付款名称')),project:String(get(r,'使用项目')),purpose,lines:[line],team:String(get(r,'使用班组/单位')),deliveryNumber:String(get(r,'送货单编号')),buyer:'',refund:get(r,'退回金额'),note:String(get(r,'备注')),reimbursement:'未核对',evidenceHash:'',evidenceConfirmed:false};out.push(current);
 });}return out;
}
export function paymentDuplicate(a,b){return !!a.evidenceHash&&a.evidenceHash===b.evidenceHash&&a.date===b.date&&Math.round(Number(a.total)*100)===Math.round(Number(b.total)*100);}
export function allocationKind(e){if(e.allocation)return e.allocation;if(/汽油|柴油|加油|成品油/.test([e.purpose,e.service,e.category,e.remark].join(' ')))return '加油';if(e.payer==='个人')return '个人报账';return e.project?'指定工地':'待确认';}
export function allocationIssue(e){const kind=allocationKind(e);return kind==='待确认'?'请确认费用归属：办公室房租、水电、车辆维修、跨项目运费或代付退款等':kind==='指定工地'&&!e.project?'请选择工地':'';}

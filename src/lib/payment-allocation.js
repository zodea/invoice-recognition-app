export function allocationKind(e){if(e.allocation)return e.allocation;if(/汽油|柴油|加油|成品油/.test([e.purpose,e.service,e.category,e.remark].join(' ')))return '加油';if(e.payer==='个人')return '个人报账';return e.project?'指定工地':'待确认';}
export function allocationIssue(e){const kind=allocationKind(e);return kind==='待确认'?'请确认费用归属：办公室房租、水电、车辆维修、跨项目运费或代付退款等':kind==='指定工地'&&!e.project?'请选择工地':'';}

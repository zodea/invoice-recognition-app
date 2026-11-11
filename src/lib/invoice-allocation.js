// 金额统一换算为整数分；占比仅供显示，不参与保存或计算。
export function moneyCents(value) {
  if (value == null || String(value).trim() === '' || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value).trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function isMultiProject(entry) {
  return entry?.allocation === '多工地分配';
}

export function projectAllocationState(entry, rows = entry?.projectAllocations || []) {
  const total = moneyCents(entry?.total);
  const errors = [];
  const seen = new Set();
  let allocated = 0;
  if (total === null) errors.push('请先补全有效的发票价税合计（最多两位小数）');
  for (const [index, row] of rows.entries()) {
    const project = String(row.project || '').trim();
    const cents = moneyCents(row.total);
    if (!project) errors.push(`第 ${index + 1} 行请选择工地`);
    else if (seen.has(project)) errors.push(`工地“${project}”重复，请合并金额`);
    seen.add(project);
    if (cents === null) errors.push(`第 ${index + 1} 行请输入有效金额（最多两位小数）`);
    else {
      allocated += cents;
      if (total !== null && (total > 0 ? cents <= 0 : total < 0 ? cents >= 0 : cents !== 0)) errors.push(`第 ${index + 1} 行金额须与发票金额同为正数或负数；零元发票只能分配零元`);
    }
  }
  if (!Number.isSafeInteger(allocated)) errors.push('分配金额超出可计算范围');
  if (total !== null && Math.abs(allocated) > Math.abs(total)) errors.push('分配金额超过发票价税合计');
  const remaining = total === null ? null : total - allocated;
  const complete = !errors.length && rows.length > 0 && remaining === 0;
  return { errors, allocated, remaining, complete, label: complete ? '已分配' : '待分配' };
}

export function projectNames(entry) {
  return isMultiProject(entry) ? (entry.projectAllocations || []).map(row => row.project).filter(Boolean).join(' / ') : entry?.project || '';
}

// 保存时从最新台账生成新记录，不触碰原件、抵扣或报销状态。
export function withProjectAllocation(entry, { mode, project = '', rows = [] }) {
  if (mode === 'single') {
    if (!String(project).trim()) throw new Error('请选择工地');
    return { ...entry, allocation: '指定工地', project: String(project).trim(), projectAllocations: [] };
  }
  if (mode !== 'multi') throw new Error('无效的工地分配');
  const state = projectAllocationState(entry, rows);
  if (state.errors.length) throw new Error(state.errors.join('；'));
  return { ...entry, allocation: '多工地分配', project: '', projectAllocations: rows.map(row => ({ project: String(row.project).trim(), total: moneyCents(row.total) / 100, remark: String(row.remark || '').trim() })) };
}

export function projectExpenseRows(entry) {
  if (!isMultiProject(entry)) return [{ project: entry.project || '', total: Number(entry.total) || 0, remark: '' }];
  const state = projectAllocationState(entry);
  // 导入改变票面金额或历史异常时，先整体列入待分配，避免生成错误工地费用。
  if (state.errors.length) return [{ project: '待分配', total: Number(entry.total) || 0, remark: state.errors.join('；') }];
  const rows = (entry.projectAllocations || []).map(row => ({ ...row }));
  if (state.remaining || !rows.length) rows.push({ project: '待分配', total: state.remaining / 100, remark: '尚未分配到工地' });
  return rows;
}

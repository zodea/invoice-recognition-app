export const invoiceTypes = ['电子发票（普通发票）', '电子发票（增值税专用发票）', '增值税普通发票', '增值税专用发票', '增值税电子普通发票', '增值税电子专用发票', '航空运输电子客票行程单', '铁路电子客票', '医疗收费电子票据', '通用机打/定额发票', '其他票据'];

export function recentInvoiceProjects(entries, projects, now = new Date()) {
  const allowed = new Set(projects);
  const day = 86_400_000;
  const scores = new Map();
  for (const entry of entries) {
    const age = Math.floor(now.getTime() / day) - Math.floor(Date.parse(entry.reviewedAt || entry.firstSeen || entry.date) / day);
    if (!Number.isFinite(age) || age < 0 || age > 90 || !allowed.has(entry.project)) continue;
    const score = scores.get(entry.project) || { recent: 0, total: 0 };
    score.total++;
    if (age <= 30) score.recent++;
    scores.set(entry.project, score);
  }
  return [...scores].sort(([name, score], [otherName, other]) => other.recent - score.recent || other.total - score.total || name.localeCompare(otherName, 'zh-CN')).slice(0, 5).map(([name]) => name);
}

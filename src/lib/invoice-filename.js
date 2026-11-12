function pad2(n) {
  return String(n).padStart(2, "0");
}

export function parseInvoiceFilename(name) {
  const base = String(name || "").replace(/\.(?:pdf|png|jpe?g|bmp|webp|gif|tiff?)$/i, "");
  const organized = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)-(\d+\.\d{2})元(?:-(行程单|快递邮寄明细|邮寄明细|行程及费用明细))?(?:-\d+)?$/);
  if (organized) return {date:organized[1],seller:organized[2],total:organized[3],number:'',type:organized[4]||'',source:'filename',hasSellerTruth:true};

  // 明确标明医院、日期和金额的文件名可作为待核对的兜底；未写年份时不猜年份。
  const medical = base.match(/^(.{2,60}医院)[：:]\s*(?:(\d{2}|\d{4})-)?(\d{1,2})-(\d{1,2})\s*=\s*(\d+(?:\.\d{1,2})?)元?$/);
  if (medical) {
    let date = "";
    if (medical[2]) {
      const year = medical[2].length === 2 ? 2000 + Number(medical[2]) : Number(medical[2]);
      const month = Number(medical[3]), day = Number(medical[4]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (year >= 1900 && year <= 2100 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) date = `${year}-${pad2(month)}-${pad2(day)}`;
    }
    return { date, total: medical[5], seller: medical[1], number: "", type: "医疗票据", source: "filename", hasSellerTruth: true };
  }

  let m = base.match(/^(\d{2})(\d{2})(\d{2})_([0-9]+(?:\.[0-9]+)?)_(.+)$/);
  if (m) {
    const tail = m[5];
    return {
      date: `20${m[1]}-${m[2]}-${m[3]}`,
      total: m[4],
      seller: tail.replace(/_行程单$/, ""),
      number: "",
      type: /行程单/.test(tail) ? "行程单" : "",
      source: "filename",
      hasSellerTruth: true,
    };
  }

  m = base.match(/^dzfp_(\d+)_(.+?)_\d{8,}$/);
  if (m) {
    return {
      date: "",
      total: "",
      seller: m[2],
      number: m[1],
      type: "",
      source: "filename",
      hasSellerTruth: true,
    };
  }

  m = base.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[：:：_\- ]+([0-9]+(?:\.[0-9]+)?)/);
  if (m) {
    return {
      date: `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`,
      total: m[4],
      seller: "",
      number: "",
      type: "",
      source: "filename",
      hasSellerTruth: false,
    };
  }

  return { date: "", total: "", seller: "", number: "", type: "", source: "", hasSellerTruth: false };
}

export function applyInvoiceFilenameFallback(fields, name) {
  const fallback = parseInvoiceFilename(name);
  const filled = [];

  const fill = (key, value) => {
    if ((fields[key] === "" || fields[key] == null) && value !== "" && value != null) {
      fields[key] = value;
      filled.push(key);
    }
  };

  fill("date", fallback.date);
  fill("dateText", fallback.date);
  fill("total", fallback.total);
  fill("seller", fallback.seller);
  fill("number", fallback.number);
  fill("type", fallback.type);

  return { fallback, filled };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function parseInvoiceFilename(name) {
  const base = String(name || "").replace(/\.pdf$/i, "");

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

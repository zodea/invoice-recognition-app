// 保留人工填写内容；只修复旧版明确将买卖方连写到销售方的识别结果。
export function applyParsedInvoiceFields(fields, parsed, rawText = "") {
  const compact = value => String(value || "").replace(/\s+/g, "");
  if (!fields.buyer && parsed.buyer && parsed.seller && compact(fields.seller) === compact(parsed.buyer) + compact(parsed.seller)) {
    fields.seller = parsed.seller;
  }
  if (parsed.docType === "医疗票据") {
    const text = String(rawText).normalize("NFKC");
    const insuranceNumber = text.match(/医保编号\s*[:：]\s*([0-9]{8,25})/);
    // 旧版可能将医保编号兜底当成票据号码；仅在原文能明确证实时修正。
    if (insuranceNumber && fields.number === insuranceNumber[1]) {
      fields.number = parsed.number || "";
      fields.docType = parsed.docType;
      fields.type = parsed.type;
    }
    const oldDate = String(fields.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (oldDate) {
      const [, y, m, d] = oldDate.map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        fields.date = parsed.date || "";
        fields.dateText = parsed.dateText || "";
      }
    }
    const grouped = text.match(/小写[)）]?\s*[:：]?\s*[¥￥]?\s*(\d{1,3})\.(\d{3})(?:\.\d{3})*\.\d{2}(?![\d.])/);
    if (grouped && Number(fields.total) === Number(`${grouped[1]}.${grouped[2].slice(0, 2)}`) && parsed.total !== "") {
      fields.total = parsed.total;
    }
  }
  for (const key of Object.keys(parsed)) {
    if ((fields[key] === "" || fields[key] == null) && parsed[key] !== "" && parsed[key] != null) fields[key] = parsed[key];
  }
}

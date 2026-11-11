import assert from "node:assert/strict";
import { parseInvoice } from "../src/lib/invoice-parse.js";
import { applyParsedInvoiceFields } from "../src/lib/invoice-fields.js";
import { bigCategory } from "../src/lib/invoice-reimburse.js";
import { inferExpenseTag } from "../src/lib/invoice-tags.js";
import { classifyReimburseKind } from "../src/lib/invoice-reimburse.js";
import { parseInvoiceFilename } from "../src/lib/invoice-filename.js";

// 电子发票将双方的“名称”标签排在一行，公司名称排在下一行。
const sample = [
  "电子发票（普通发票）",
  "购 名称： 销 名称：",
  "广东示例建设工程有限公司 广州示例能源技术有限公司",
  "买 售",
  "方 方",
  "信 统一社会信用代码/纳税人识别号： 信 统一社会信用代码/纳税人识别号：",
].join("\n");
const fields = parseInvoice(sample);
assert.equal(fields.buyer, "广东示例建设工程有限公司");
assert.equal(fields.seller, "广州示例能源技术有限公司");

const sameLine = parseInvoice("电子发票\n购 名称：广东示例建设工程有限公司 销 名称：广州示例能源技术有限公司");
assert.equal(sameLine.buyer, "广东示例建设工程有限公司");
assert.equal(sameLine.seller, "广州示例能源技术有限公司");
const staleFields = { buyer: "", seller: fields.buyer + fields.seller };
applyParsedInvoiceFields(staleFields, fields);
assert.equal(staleFields.buyer, fields.buyer);
assert.equal(staleFields.seller, fields.seller, "重新识别应修正旧的买卖方连写结果");
const editedFields = { buyer: "", seller: "人工核对后的公司" };
applyParsedInvoiceFields(editedFields, fields);
assert.equal(editedFields.seller, "人工核对后的公司", "重新识别不能覆盖人工编辑");
const parking = parseInvoice("电子发票（普通发票）\n*生产生活服务*车辆 粤(2017)不动产权第 平方米 1 30.00 5% 1.50\n停泊服务费 123456号");
assert.equal(parking.service, "车辆停泊服务费", "应还原跨行的停车服务名称");
assert.equal(bigCategory(parking), "交通运输", "停车票应按交通费用归类");
assert.equal(inferExpenseTag(parking), "交通");
const medicalText = ["广东省医疗门诊收费票据（电子）", "桑据号码：0296118089", "开票日期：2026-10-19", "交款人：测试人员", "金额合计（小写）1.934.19", "医保编号：44010000001064557412"].join("\n");
const medical = parseInvoice(medicalText);
assert.equal(medical.docType, "医疗票据");
assert.equal(medical.number, "0296118089", "票据号码不能误取医保编号");
assert.equal(medical.date, "2026-10-19");
assert.equal(medical.buyer, "测试人员");
assert.equal(medical.total, 1934.19, "应识别医疗票据的小写千分位金额");
assert.equal(parseInvoice("广东省医疗门诊收费票据\n支款人；测试人员").buyer, "测试人员", "容错识别医疗票据交款人");
assert.equal(parseInvoice("广东省医疗门诊收费票据\n小写1.23.45").total, "", "无法确认的金额不能截断成看似有效的金额");
assert.equal(classifyReimburseKind(medical), "医疗门诊");
const staleMedical = { number: "44010000001064557412", date: "2020-00-27", dateText: "2020-00-27", total: 1.93, docType: "增值税发票", type: "电子发票" };
applyParsedInvoiceFields(staleMedical, medical, medicalText);
assert.equal(staleMedical.number, medical.number, "重新识别应修正原文中明确为医保编号的旧号码");
assert.equal(staleMedical.date, medical.date, "重新识别应修正无效日期");
assert.equal(staleMedical.total, medical.total, "重新识别应修正千分位误读造成的截断金额");
assert.equal(staleMedical.docType, "医疗票据");
const editedMedical = { number: "12345678", date: "2026-01-01", total: 20 };
applyParsedInvoiceFields(editedMedical, medical, medicalText);
assert.equal(editedMedical.number, "12345678");
assert.equal(editedMedical.date, "2026-01-01");
assert.equal(editedMedical.total, 20, "重新识别应保留人工核对的金额");
const missingMedicalNumber = { number: "44010000001064557412" };
const withoutNumber = "广东省医疗门诊收费票据\n医保编号：44010000001064557412";
applyParsedInvoiceFields(missingMedicalNumber, parseInvoice(withoutNumber), withoutNumber);
assert.equal(missingMedicalNumber.number, "", "无可靠票据号码时清除误取的医保编号");
const medicalWithOcrErrors = parseInvoice("广东省医疗门诊收费票据\n承接号码：0272152528\n开系日期：2026-09-27\n医保编号：44010000001064557412\n开来日期：2020年00月27日");
assert.equal(medicalWithOcrErrors.number, "0272152528");
assert.equal(medicalWithOcrErrors.date, "2026-09-27");
assert.equal(parseInvoice("广东省医疗门诊收费票据\n医保编号：44010000001064557412").number, "", "没有可靠票据号码时应留空");
const medicalFile = parseInvoiceFilename("示例医院：26-10-19=389元.png");
assert.equal(medicalFile.date, "2026-10-19");
assert.equal(Number(medicalFile.total), 389);
assert.equal(medicalFile.seller, "示例医院");
assert.equal(parseInvoiceFilename("示例医院：10-19=1934.19元.pdf").date, "", "文件名没有年份时不能猜年份");
console.log("发票买卖方识别测试通过");

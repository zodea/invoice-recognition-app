// 离线验证：读取 scripts/vl-out/*.md（上次 VL 云识别已保存的原始 markdown），
// 跑新版 parseVlToDocs，看公司/日期/单号/材料明细解析结果。不联网、不上传。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVlToDocs } from "../src/lib/vl-parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "vl-out");

const files = (await fs.readdir(OUT_DIR)).filter((f) => f.endsWith(".md"));
for (const f of files) {
  const md = await fs.readFile(path.join(OUT_DIR, f), "utf8");
  const pages = md.split(/\n*---PAGE---\n*/);
  const { docs, company } = parseVlToDocs(pages);
  console.log(`\n■ ${f.replace(/\.md$/, "")}  →  公司「${company || "?"}」 | ${docs.length} 单`);
  docs.forEach((d, i) => {
    console.log(`  单${i + 1}: 日期=${d.date || "-"} 单号=${d.orderNo || "-"} 公司=${d.company || "-"} 明细=${d.items.length} 行`);
    d.items.forEach((it) =>
      console.log(`     · ${it.name} | ${it.unit || "-"} | 数量${it.quantity || "-"} | 单价${it.unitPrice || "-"} | 金额${it.total || "-"}`)
    );
  });
}

# 送货单 / 发票 识别整理 APP — 进度与待办（交接文档）

> 本文件是换机/换会话时的交接说明：包含项目现状、关键技术决策（避坑）、待办清单、
> 测试方法、文件地图。新会话直接读这份即可接着干。最后更新：2026-06-04。

## 一、这是什么

本机 Vue 应用（Vite + Vue3，纯前端，不传任何数据到服务器），两个工具：

1. **送货单整理**（已完成、已联调）：拖拽上传 PDF/图片 → 分区(项目)管理 → PaddleOCR 识别
   公司/日期/材料/单位/单价/总价 → 同类合并 → 导出「每公司一个工作表的 Excel + 按
   公司-日期命名的 PDF」到所选文件夹（File System Access API）。
2. **发票批量打印**（进行中）：上传电子发票 PDF / 扫描件 → 识别开票明细（号码/日期/购方/
   销方/金额/税额/价税合计）→ 按开票日期排序 → A4 自动排版批量打印 → 汇总账单 Excel。

目录：`K:\工地\送货单识别APP`。命令行版送货单工具在
`K:\工地\12、车陂商业大楼\26年整理扫描件\送货单整理工具`（独立、零依赖、已完成）。

## 二、怎么跑 / 怎么测

```powershell
cd K:\工地\送货单识别APP
npm install            # postinstall 会把 pdf worker + cmaps 复制到 public/
npm run dev            # 开 http://localhost:5173 ，用 Chrome / Edge 打开
npm run build          # 产物在 dist/
npm test               # scripts/selftest.mjs：命名/解析/Excel/排版 纯逻辑自测（15+项）
node scripts/test-invoices.mjs   # 用 发票测试/ 里 5 张真实发票端到端测识别+排版+Excel
```
- **必须用 Chrome / Edge**：选择导出文件夹用 `showDirectoryPicker`，OCR 用 WebGL。
- OCR 首次联网下载模型（百度 BOS，国内可用），约 15-20 秒，之后缓存。

## 三、关键技术决策 / 避坑（重要，别重复踩）

1. **pdf.js 的 `page.render()` 在本 Vite 环境会死锁**（getDocument/getPage/getTextContent 都正常，
   只有 render 永久挂起，无报错）。已诊断确认。因此：
   - 扫描型 PDF（送货单/扫描发票）→ **直接抽内嵌 JPEG**（`src/lib/pdf.js` 的 extractJpegStreams，
     移植自命令行版，已验证）。不要用 pdf.js 渲染。
   - 电子发票（文字型 PDF）→ 用 **pdfjs `getTextContent` 抽文字**（`src/lib/pdftext.js`，render 不碰，正常）。
2. **PaddleOCR**（`@paddlejs-models/ocr`）是 webpack+Emscripten 包，直接静态 import 会因引用全局
   `Module` 而在严格 ESM 下崩溃、白屏。已改为**点识别时动态 import**，并在 `index.html` 提前
   `window.Module = {}` 垫片。`src/lib/ocr.js`。已实测能准确识别中文。
3. **CMap**：部分电子发票用 CID 字体，抽文字需要 cmaps。已：`public/cmaps/`（postinstall 复制），
   `pdftext.js` 传 `cMapUrl:`${BASE_URL}cmaps/`` + `cMapPacked:true`；Node 测试用自带 CMapReaderFactory。
4. **有的电子发票字体被“混淆”**（ToUnicode 映射成空格），抽出来的值是空白（如 `比音勒芬` 那张）。
   文字抽取救不了，只能 OCR 光栅图 或 人工录入。见“待办/已知问题”。
5. **导出**：用 pdf-lib（embedPdf/copyPages/embedJpg）。`buildPdfFromFiles` 合并送货单，
   `buildPrintLayout` 排版发票。都已验证（Node 测试里真发票 5→3 张 A4，0 跳过）。
6. **预览与导出排版一致性**：几何只有一处来源 `src/lib/print-layout.js`（`planSlots` 同时给
   pt 给导出、给 % 给 HTML 预览）。改排版只改这一个文件。

## 四、待办清单（按优先级）

### A. 发票“双栏联动”界面（进行中，最重要）
需求：左=A4 打印图片预览（不用 pdf.js 实时渲染），右=识别出的发票明细；两侧**双向联动**
（点一边高亮另一边并滚动到位）、**两侧显示相同序号**、按**开票日期升序**、无日期的排最后并标
`待复核`。导出的打印 PDF 必须与左侧预览排版一致。

数据层已就绪（`src/invoiceStore.js`）：`sortedInvoices()`（带 seq+needsReview）、
`orderedForPrint()`、`printUnits()`（已展开成与导出同序的打印单元，含 image 或占位）、
`selectInvoice(id)` / `invoiceStore.selectedId`、`inv.pageCount`。

还需要做：
- [ ] **`src/components/InvoicePreview.vue`（左栏，未创建——之前写到一半被打断）**：
  读 `printUnits()`，按 `perPageCount(perPage)` 分页；每页一个 A4 比例容器
  （`padding-top: calc(100% * 1.4142)` + 内层 `position:absolute inset:0`）；每个槽位
  用 `planSlots(perPage)` 的 `xPct/yPct/wPct/hPct` 绝对定位；槽内：左上角 `序号`(seq，多页加 -页码)、
  有 image 显示 `<img object-fit:contain>`，无 image（电子发票文字版）显示信息卡片
  （销售方/号码/日期/¥价税合计/「电子发票PDF」）；`:data-inv="invId"`；
  `@click="selectInvoice(invId)"`；`selectedId===invId` 时高亮；`needsReview` 标橙色`待复核`。
- [ ] **`src/components/InvoiceRow.vue`（右栏一行）**：紧凑版（不放预览图，预览在左栏）。
  显示 `序号`、文件名、`include` 勾选、识别按钮+状态、可编辑字段
  （号码/日期/销售方/购买方/金额/税额/价税合计/类型/备注）、移除按钮；`:data-inv="invId"`；
  点空白处 `selectInvoice(invId)`；`selectedId` 高亮。可参考现有 `InvoiceCard.vue` 删掉预览部分。
- [ ] **重写 `src/views/InvoiceView.vue` 为双栏**：上方 `InvoiceUpload` + 操作条
  （识别全部 / 清空 / 每页张数 / 生成并打印 / 下载PDF / 导出Excel，可复用并改造 `InvoicePrintPanel.vue`）；
  下方两栏：左 `InvoicePreview`，右 `v-for sortedInvoices() -> InvoiceRow`；
  加一个 `watch(()=>invoiceStore.selectedId, id => { 两栏里 [data-inv=id] 各自 scrollIntoView({block:'nearest'}) })`。
- [ ] **更新 `InvoicePrintPanel.vue`**：`buildPrintLayout` 的入参改用 `orderedForPrint().map(x=>x.inv)`
  （已排序+仅勾选），而不是当前的 `invoices.filter(i=>i.include)`。汇总同理用 included。
- [ ] 旧的单栏 `InvoiceView` 里的 `InvoiceCard` 列表会被双栏取代；`InvoiceCard.vue` 可留作参考或删。

### B. 发票识别完善
- [ ] `比音勒芬` 类“混淆字体”发票：试在浏览器对真实电子发票跑一次 pdf.js `render`——
  若真发票能渲染（我只在合成 PNG-PDF 上验证过死锁），就给文字抽取失败的发票做
  **render→canvas→PaddleOCR 兜底**（务必加超时，render 挂起就放弃回退占位/人工）。
  若仍挂起，则保持“文字抽不到就人工录入”，并在 UI 明确提示。
- [ ] 销售方偶尔丢「公司」等尾字（跨行）——可接受，用户可改；如要更准再迭代 `invoice-parse.js`。

### C. 浏览器端真机联调（换机后做）
- [ ] 把 `发票测试/*.pdf` 临时拷到 `public/发票测试/`，dev 下 `fetch('/发票测试/x.pdf')` 喂进
  `invoiceActions.addFiles`，跑「识别全部」→ 核对右栏字段、左栏预览、序号联动、打印PDF 与预览一致。
  （`file_upload` 工具会因“非本会话共享文件”被拒，所以走 fetch 注入。）**联调完删掉 public/发票测试/**。
- [ ] 送货单侧：确认扫描 PDF 上传后能抽出页图预览 + OCR（之前 pdf.js render 死锁已绕过，待真机确认）。

### D. 打包成“可直接使用的软件”（最后一步，用户最终目标）
目标：拷到别的电脑能直接用。建议方案（择一，未定）：
- **Electron + electron-builder** 出便携 exe（最“双击即用”，但体积大、需联网下载 chromium）。
  注意：`showDirectoryPicker` / WebGL / OCR 在 Electron 里可用。
- 或 **静态 dist + 一个本地静态服务器启动器**（轻，但要带 server）。
- 注意 `public/cmaps`(22MB) 与 OCR 模型（运行时下载）。打包前**删除 `发票测试/`、`发票测试_输出/`、
  `public/发票测试/`** 等含真实发票的隐私文件。

## 五、文件地图（src/）
```
main.js / App.vue(顶部两个 tab: 送货单/发票) / styles.css
views/   DeliveryView.vue(送货单整) / InvoiceView.vue(发票，待改双栏)
store.js(送货单状态)        invoiceStore.js(发票状态: 排序/序号/printUnits/selectedId)
lib/ pdf.js(抽JPEG+合并PDF)  pdftext.js(pdfjs抽文字+cMap)  ocr.js(PaddleOCR动态)
     parse.js(送货单解析)     invoice-parse.js(发票字段解析: 购/销名)
     naming.js  excel.js(送货单Excel)  export.js(送货单导出文件夹)
     invoice-excel.js(开票明细+汇总账单)  invoice-layout.js(A4排版导出)  print-layout.js(共享几何)
     build-workbook.js(送货单工作簿)
components/ UploadZone PartitionBar FileCard FieldsTable ExportPanel   (送货单)
            InvoiceUpload InvoiceCard InvoicePrintPanel                (发票，现有)
            ▲ 待加: InvoicePreview(左栏) InvoiceRow(右栏)
scripts/ selftest.mjs(纯逻辑自测) test-invoices.mjs(真发票测) copy-pdf-worker.mjs(postinstall复制worker+cmaps)
public/  pdf.worker.min.mjs  cmaps/(169个.bcmap, 22MB)
发票测试/        5 张真实电子发票（测试用，打包前删）
发票测试_输出/   测试脚本输出（打印版PDF/明细Excel/txt原文，打包前删）
```

## 六、已知状态 / 测试结论
- `node scripts/test-invoices.mjs`：真发票 5 张里 **4 张** 号码/日期/金额/税额/价税合计/购销方
  全部识别正确；`比音勒芬` 那张字体混淆抽不到文字（见 B）。排版 5→3 张 A4，价税合计合计 ¥1512.75。
- `npm run build` 通过（245 模块）。送货单侧 + 发票 Node 链路均已自测。
- 浏览器端：App 能挂载、两个 tab 可切换、PaddleOCR 实测可用；双栏联动界面尚未在浏览器联调。

## 七、2026-06-04 发票批量整理测试（最新）
新增 `scripts/invoice-batch.mjs`：递归识别 `发票测试/` 全部 PDF（含 `发票/力沣|瑞航|百信` 子目录），
与文件名真值核对差异，输出重命名 PDF（`公司：yyyy／mm／dd-金额元.pdf`，全角 ：／ 以合法）到
`发票测试_输出/重命名整理/`，并生成 `发票统计_最早至最晚.xlsx`（开票明细 + 按销售方汇总，标题含日期区间）。

**结果（135 张，区间 2026/01/05–2026/05/23，价税合计 ¥50576.16）：**
- 126 张完全识别一致；2 张销售方识别、金额取自文件名；6 张字体混淆全空（按文件名补录）；
  1 张「有差异」= `阿里健康 3.70`，实为**原文件名笔误**（3.70 是税额，真·价税合计 32.19，App 识别正确）。
- 识别率 ~94%，未识别的均为**字体混淆/加密发票**（ToUnicode 映射成空格或重复字），文字抽取救不了，
  需 OCR 或人工；其日期/金额已由文件名兜底，销售方留空或部分恢复。

**本轮对 `src/lib/invoice-parse.js` 的修复（均已自测无回归，selftest 26/26、core-5 仍 4/5）：**
1. 全文 `NFKC` 归一 + 部首补充区点修（⻨→麦 等）：修好麦当劳那类「日期/¥ 抽不到、销售方带怪字」。
2. 买卖方切分改为「名称：→ 下一分界」整段捕获：修好 ① 中海油「购买方信息/销售方信息+下一行名称」
   被并到一起，② 专票「永康市 锦霸…」名称含空格被截断。
3. 字符间距专票（`¥ 2 0 . 5 2`）加「数字间含空格」的金额/合计兜底正则（不跨行，防误并相邻列）。
4. 重复字混淆（`佛佛山山…`）整串成对时折叠；混淆乱码/控制字符的名称用「必须含中文」过滤掉。
5. 行程单（网约车）抽 申请日期 + 合计金额，类型标记「行程单」；货拉拉「货物运输电子收款凭证」
   抽 托运人(=购买方)/申请日期/(小写)金额，类型「货物运输凭证」。

### 二修：购买方一批错值（用户复核发现，已全部修正，购买方 0 异常）
- `买售`（中石化"名称: 名称:"在购销名的下一行）：名称冒号后的 `\s*` 误吃换行抓到下一行"买 售"。
  → 冒号后只吃水平空白 `[^\S\n]*`，不跨行。
- `…公司售`（冠晖等"买 名称:A 售 名称:B"）：买方整段把对方"售"标签也括进来。
  → cleanName 去尾增加裸 `买|售`；配合成对折叠也修好 `广广东东…售`。
- `…托运人证照号码:…`（货拉拉）：名称捕获越界。→ 名称 lookahead 增加 `托运人|证照|地址|开户` 边界。
- `发票测试` / `QQ邮箱发票_…`（顶层与 QQ 目录被当买方）：`scripts/invoice-batch.mjs` 的买方目录兜底
  只认 `力沣/瑞航/百信`（已补 BUYER_ALIAS 百信全称），其它目录不再当买方，识别不到则留空。
- 复跑：selftest 26/26、core-5 仍 4/5、批量 135 张购买方分布 80 瑞航 / 26 百信 / 22 力沣 / 7 空（顶层+QQ
  字体混淆/行程单无法可靠取得买方者留空，不再误填）。

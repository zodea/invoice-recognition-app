# 发票识别与送货单整理助手

本地运行的 Vue + Tauri 应用，用于送货单扫描件整理、发票识别核对、批量打印排版和 Excel 汇总。

## 功能

- 发票 PDF / 图片导入，支持电子发票文本抽取和扫描件 OCR。
- 发票左右核对：左侧打印排版预览，右侧识别字段编辑。
- 发票批量打印 PDF、开票明细和汇总账单 Excel。
- 送货单扫描件识别、分区整理和导出。
- Tauri 桌面应用打包。

## 本地开发

```powershell
npm install
npm run dev
```

## 测试与构建

```powershell
npm test
npm run build
npm run tauri:build
```

## 隐私说明

真实发票样本、测试输出、依赖目录和构建产物不会提交到 GitHub。`public/cmaps` 和 `public/pdf.worker.min.mjs` 由 `npm install` 后的 `postinstall` 脚本从依赖复制生成。

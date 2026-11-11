// 使用桌面文档运行时生成空白模板；不读取真实分供方或其他业务数据。
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { IMPORT_FIELDS } from '../src/lib/supplier-schema.js';
const runtime=process.argv[2];
if(!runtime)throw new Error('请传入文档运行时的 node 目录');
const requireRuntime=createRequire(runtime+'/supplier-template.cjs');
const { Workbook,SpreadsheetFile }=await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
const wb=Workbook.create(),sheet=wb.worksheets.add('分供方'),dict=wb.worksheets.add('选项字典'),notes=wb.worksheets.add('填写说明');
const column=index=>{let n=index+1,result='';while(n){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26);}return result;};
const last=column(IMPORT_FIELDS.length-1);
for(const s of [sheet,dict,notes]){s.showGridLines=false;s.getRange('A1:AF25').format.font={name:'Arial',size:11};}
sheet.getRange('A1:'+last+'1').values=[IMPORT_FIELDS.map(f=>f[1])];
sheet.getRange('A1:'+last+'1001').format.rowHeight=23;
sheet.getRange('A1:'+last+'1001').format.columnWidth=23;
sheet.getRange('A1:'+last+'1').format={fill:'#234F7C',font:{bold:true,color:'#FFFFFF'},rowHeight:34,wrapText:true};
sheet.getRange('B1:B1001').format.columnWidth=36;
sheet.getRange('B2:'+last+'1001').setNumberFormat('@');
sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(2);
const table=sheet.tables.add('A1:'+last+'1001',true,'SupplierImport');table.showFilterButton=true;
const dictionaries=IMPORT_FIELDS.filter(f=>f[2]).map(([key,label,values])=>({key,label,values}));
dictionaries.push({key:'project',label:'工地',values:[]},{key:'parentSupplier',label:'上级供应商',values:[]});
dict.getRange('A1:G1').values=[dictionaries.map(d=>d.label)];
dict.getRange('A1:G1').format={fill:'#234F7C',font:{bold:true,color:'#FFFFFF'},rowHeight:30};
dict.getRange('A1:G30').format.columnWidth=24;dict.getRange('A1:G30').format.rowHeight=24;
for(let i=0;i<dictionaries.length;i++){
 const d=dictionaries[i],col=column(i),target=column(IMPORT_FIELDS.findIndex(f=>f[0]===d.key));
 if(d.values.length)dict.getRange(col+'2:'+col+(d.values.length+1)).values=d.values.map(v=>[v]);
 const end=d.values.length+1;
 if(d.values.length)sheet.getRange(target+'2:'+target+'1001').dataValidation={rule:{type:'list',formula1:`INDIRECT("'选项字典'!$${col}$2:$${col}$${end}")`}};
 else sheet.getRange(target+'2:'+target+'1001').dataValidation={rule:{type:'list',formula1:`INDIRECT("'选项字典'!$${col}$2:$${col}$1001")`}};
}
sheet.getRange('M2:M1001').setNumberFormat('0.00');
sheet.getRange('N2:N1001').setNumberFormat('yyyy-mm-dd');
notes.getRange('A1:B1').values=[['分供方批量导入','填写说明']];
notes.getRange('A1:B1').format={font:{bold:true,size:15,color:'#234F7C'},rowHeight:32};
const lines=[
 ['开始填写','在“分供方”第 2 行起录入，每行一家；已提供 1000 行下拉选项。'],
 ['必填信息','分供方名称必填。请选择五种分供方类型之一；旧模板无类型时按大宗供应商导入。'],
 ['分供方类型','大宗供应商、甲供材分供方、公司分供方、房东、零星供应商，对应不同表单。'],
 ['分供方类别','按供应内容选类别。暂时无法分类可选“其他”，并在主营业务或备注中说明。'],
 ['评价等级','A / B / C / D 作为评价选项；未评定请选择“未评价”，不根据识别结果自动评级。'],
 ['纳税人类型','按实际资料选择一般纳税人、小规模纳税人、自然人或其他；不确定可留空。'],
 ['工地与上级供应商','工地和上级供应商选项位于“选项字典”F、G 列。从软件下载时填入当前有效档案。'],
 ['手动扩充工地选项','独立使用时可在选项字典 F2:F1001 填写工地全称；软件中请先建立同名工地档案。'],
 ['识别别名','多个别名用顿号分隔。全称、简称、开票名称或别名唯一匹配时可关联；模糊结果需确认。'],
 ['账号、税号和电话','这些列按文本保存，保留前导零和长数字。不要把银行账号或税号改成数字格式。'],
 ['日期和资金','注册日期使用 YYYY-MM-DD；注册资金单位为万元，只填数字。'],
 ['允许后补','联系人、开票信息和附件可后补；资料不全的档案显示“待补全”，不会伪装成资料齐全。'],
 ['附件资料','本模板不装入附件。在分供方“编辑”中选择、拖拽或粘贴资料，保存后关联到该分供方。'],
 ['重复档案','同名或相同唯一识别码只补空白信息；不同类型的同名记录提示核对，不覆盖已填内容。'],
 ['导入错误','格式错误的行会列出行号及原因。正确行先导入，修改错误行后可再次导入。'],
 ['原模板兼容','兼容原模板的 29 个字段；增加分供方类型、识别别名和工地。不要导入原模板的示例行。'],
 ['来源','字段参考用户提供的“分供方新增导入模板.xlsx”和五类分供方表单截图。'],
];
notes.getRange('A3:B'+(lines.length+2)).values=lines;
notes.getRange('A3:A'+(lines.length+2)).format={font:{bold:true},columnWidth:24};
notes.getRange('B3:B'+(lines.length+2)).format={columnWidth:91,wrapText:true};
notes.getRange('A3:B'+(lines.length+2)).format.rowHeight=38;
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'分供方!A1:H3',include:'values',tableMaxRows:3,tableMaxCols:8})).ndjson);
await fs.mkdir('release-output',{recursive:true});
for(const [name,range] of [['分供方','A1:H8'],['选项字典','A1:G23'],['填写说明','A1:B19']]){
 const preview=await wb.render({sheetName:name,range,scale:1.5,format:'png'});
 await fs.writeFile('release-output/导入模板-'+name+'.png',new Uint8Array(await preview.arrayBuffer()));
}
await fs.mkdir('src/assets',{recursive:true});
const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save('src/assets/supplier-import.xlsx');
await fs.mkdir('outputs/supplier-import',{recursive:true});
await fs.copyFile('src/assets/supplier-import.xlsx','outputs/supplier-import/分供方批量导入模板（下拉选项）.xlsx');
console.log('模板已生成，含 32 列、7 组下拉选项及 1000 行输入范围。');

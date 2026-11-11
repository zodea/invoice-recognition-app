import { CFB } from 'xlsx/xlsx.mjs';
const escapeXml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
// 仅补充空白模板中的档案选项；保留样式、冻结窗格、筛选和数据验证。
export function withSupplierTemplateOptions(bytes,{projects=[],suppliers=[]}={}) {
 const zip=CFB.read(bytes,{type:'array'}),decoder=new TextDecoder(),encoder=new TextEncoder();
 const get=path=>{const index=zip.FullPaths.findIndex(p=>p.endsWith('/'+path));if(index<0)throw new Error('模板结构不完整');return zip.FileIndex[index];};
 const file=get('xl/worksheets/sheet2.xml');let xml=decoder.decode(file.content);
 const rows=new Map([...xml.matchAll(/<x:row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/x:row>/g)].map(m=>[Number(m[1]),m[0]]));
 const values=[...new Set(projects.filter(Boolean))],names=[...new Set(suppliers.map(s=>s.name).filter(Boolean))];
 for(let i=0;i<Math.max(values.length,names.length);i++){
  const r=i+2;let row=rows.get(r)||`<x:row r="${r}"></x:row>`;
  row=row.replace(/<x:c\b[^>]*r="[FG]\d+"[^>]*(?:\/>|>[\s\S]*?<\/x:c>)/g,'');
  const cells=[['F',values[i]],['G',names[i]]].filter(([,v])=>v!=null).map(([col,v])=>`<x:c r="${col}${r}" t="inlineStr"><x:is><x:t>${escapeXml(v)}</x:t></x:is></x:c>`).join('');
  rows.set(r,row.replace('</x:row>',cells+'</x:row>'));
 }
 xml=xml.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/,`<x:sheetData>${[...rows].sort((a,b)=>a[0]-b[0]).map(([,row])=>row).join('')}</x:sheetData>`);
 file.content=encoder.encode(xml);file.size=file.content.length;
 const main=get('xl/worksheets/sheet1.xml');let mainXml=decoder.decode(main.content);
 for(const [col,list] of [['F',values],['G',names]])mainXml=mainXml.replace(`$${col}$2:$${col}$1001`,`$${col}$2:$${col}$${Math.max(2,list.length+1)}`);
 main.content=encoder.encode(mainXml);main.size=main.content.length;
 return new Uint8Array(CFB.write(zip,{fileType:'zip',type:'array',compression:true}));
}

// Resolve only against uploaded files or members of the selected workbook.
const xml = (book,path) => new TextDecoder().decode(book.files?.[path]?.content);
const attr = (tag,key) => tag.match(new RegExp('\\s'+key+'=["\']([^"\']+)'))?.[1] || '';
const supported = /\.(?:png|jpe?g|webp|bmp|gif|tiff?|pdf)$/i;
export function filePath(value) {
 const parts=[];
 for(const part of String(value||'').replaceAll('\\','/').split('/')) {
  if(part==='..')parts.pop();else if(part && part!=='.')parts.push(part);
 }
 return parts.join('/').normalize('NFC').toLowerCase();
}
function resolve(base,target){return filePath((target.startsWith('/')?'':base.slice(0,base.lastIndexOf('/')+1))+target);}
function relations(book,path){
 const key=path.replace(/([^/]+)$/,'_rels/$1.rels');
 const links=new Map();
 for(const [tag] of xml(book,key).matchAll(/<Relationship\s[^>]+>/g)){
  if(attr(tag,'TargetMode')!=='External')links.set(attr(tag,'Id'),resolve(path,attr(tag,'Target')));
 }
 return links;
}
export function embeddedSheetFiles(book,sheet,source) {
 const sheetId=book.Workbook?.Sheets?.find(s=>s.name===sheet)?.id;
 const sheetPath=relations(book,'xl/workbook.xml').get(sheetId);
 if(!sheetPath)return [];
 const files=[], links=relations(book,sheetPath);
 for(const [tag] of xml(book,sheetPath).matchAll(/<(?:\w+:)?drawing\s[^>]+>/g)){
  const drawing=links.get(attr(tag,'r:id'));if(!drawing)continue;
  const images=relations(book,drawing);
  for(const [anchor] of xml(book,drawing).matchAll(/<(?:\w+:)?(oneCellAnchor|twoCellAnchor)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1>/g)){
   const from=anchor.match(/<(?:\w+:)?from>([\s\S]*?)<\/(?:\w+:)?from>/)?.[1];
   const row=from?.match(/<(?:\w+:)?row>(\d+)</)?.[1];
   const media=images.get(attr(anchor,'r:embed')),data=book.files?.[media]?.content;
   if(row==null||!data||!supported.test(media))continue;
   const name=media.split('/').pop(), path=source+'#'+sheet+'/'+media;
   const file=new File([data],name,{type:'image/'+name.split('.').pop().replace(/^jpg$/i,'jpeg')});
   files.push({row:Number(row)+1,path,file});
  }
 }
 return files;
}
export function attachmentReferences(ws,headers,rows,cellAt){
 const refs=[];
 for(const [col,heading] of headers.entries()){
  if(!/附件|对应文件|凭证(?:图片|链接|文件)?[\d一二三]*$|截图/.test(heading))continue;
  for(const r of rows){
   const cell=cellAt(r,col);if(!cell)continue;
   const v=cell.l?.Target || cell.f?.match(/^HYPERLINK\(\s*"([^"]+)"/i)?.[1] || cell.v;
   for(let link of String(v||'').split(/[\r\n]+/)){
    link=link.trim();
    // SheetJS 0.18 may expose UTF-8 relationship targets as Latin-1 bytes.
    if(cell.l?.Target && /^[\x00-\xff]+$/.test(link) && /[^\x00-\x7f]/.test(link)){
     try{link=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(link,c=>c.charCodeAt(0)));}catch{}
    }
    try{link=decodeURIComponent(link);}catch{}
    if(!supported.test(link)||/^(?:https?:|mailto:|#)/i.test(link))continue;
    refs.push(link);
   }
  }
 }
 return [...new Set(refs)];
}
export function indexUploadedPaths(files) {
 const all=new Map(), loose=new Map();
 function add(map,path,i){if(!map.has(path))map.set(path,new Set());map.get(path).add(i);}
 files.forEach((file,i)=>{
  for(const path of file.paths||[file.file?.webkitRelativePath||file.file?.name||'']){
   const key=filePath(path);add(all,key,i);if(!key.includes('/'))add(loose,key,i);
  }
 });
 return (ref,source)=>{
  const target=filePath(ref),relative=resolve(source,ref.replaceAll('\\','/'));
  const exact=all.get(relative)||all.get(target);
  return [...(exact||loose.get(target.split('/').pop())||[])];
 };
}
export function resolveEvidenceReference(ref,source,files){return indexUploadedPaths(files)(ref,source);}

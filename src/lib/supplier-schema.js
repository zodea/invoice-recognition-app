// 表单、导入校验和下拉模板共用同一套字段。
export const SUPPLIER_TYPES = ['大宗供应商','甲供材分供方','公司分供方','房东','零星供应商'];
export const SUPPLIER_CATEGORIES = ['钢材','水泥砂石','混凝土','砌筑材料','木材板材','石材瓷砖','门窗幕墙','五金工具','水电材料','消防材料','暖通设备','油漆涂料','防水保温','装饰材料','机械设备','设备租赁','运输服务','劳务服务','专业分包','房屋租赁','其他'];
export const SUPPLIER_RATINGS = ['未评价','A','B','C','D'];
export const TAXPAYER_TYPES = ['一般纳税人','小规模纳税人','自然人','其他'];
export const IMPORT_FIELDS = [
 ['type','分供方类型',SUPPLIER_TYPES], ['name','分供方名称(必填)'], ['shortName','供应商简称'], ['category','分供方类别',SUPPLIER_CATEGORIES],
 ['rating','评价等级',SUPPLIER_RATINGS], ['taxpayerType','纳税人类型',TAXPAYER_TYPES], ['project','工地'], ['aliases','识别别名'],
 ['contact','主要联系人'], ['contactPhone','主要联系人电话'], ['contactRole','主要联系人职务'], ['legalPerson','法人代表'],
 ['registeredCapital','注册资金'], ['registeredDate','注册日期'], ['location','所在地'], ['address','详细地址'], ['business','主营业务'],
 ['invoiceName','开票名称'], ['taxNo','纳税人识别号'], ['invoiceAddress','开票地址'], ['bank','开户行'], ['bankAccount','银行账号'],
 ['phone','电话'], ['contactInfo','联系方式'], ['parentSupplier','上级供应商'], ['isTeamIndividual','是否班组个人',['是','否']],
 ['businessType','F-业务类型'], ['manager','负责人'], ['laborScope','劳务承包范围'], ['note','备注'], ['otherNote','其他备注'], ['externalCode','唯一识别码'],
];
const basic = {
 name:['分供方名称','text',true], shortName:['供应商简称','text',true], category:['分供方类别','category',true], parentSupplier:['上级供应商','parent'],
 rating:['评价等级','rating'], legalPerson:['法人代表','text',true], registeredCapital:['注册资金（万元）','number',true], registeredDate:['注册日期','date',true],
 address:['详细地址','text',true], taxpayerType:['纳税人类型','taxpayerType',true], location:['所在地 / 位置说明','text'], business:['主营业务','textarea',true], note:['备注','textarea'],
};
const layouts = {
 '大宗供应商':['name','shortName','category','parentSupplier','rating','legalPerson','registeredCapital','registeredDate','address','taxpayerType','location','business','note'],
 '甲供材分供方':['name','shortName','category','note'],
 '公司分供方':['name','shortName','category','rating','legalPerson','registeredCapital','registeredDate','address','business','note'],
 '房东':['name','shortName','address','note'],
 '零星供应商':['name','shortName','category','legalPerson','registeredCapital','registeredDate','address','taxpayerType','location','business','note'],
};
export function supplierFields(type) {
 return (layouts[type] || layouts['大宗供应商']).map(key => {
  const [label,input,required] = basic[key];
  return {key,label,input,required:!!required && !(type==='甲供材分供方'&&key==='category') && !(type==='零星供应商'&&['legalPerson','registeredCapital','registeredDate','address'].includes(key))};
 });
}
export const CONTACT_FIELDS = [['contact','主要联系人'],['contactPhone','主要联系人电话'],['contactRole','主要联系人职务']];
export const INVOICE_FIELDS = [['invoiceName','开票名称'],['bank','开户行'],['bankAccount','银行账号'],['taxNo','纳税人识别号'],['invoiceAddress','开票地址'],['phone','电话']];
export function supplierAttachmentGroups(type) {
 const defs={credit:['征信',15],application:['申请书',15],performancePhotos:['过往业绩合同及施工照片',15],contracts:['过往业绩合同',9],photos:['公司或工厂照片',9],brand:['品牌使用授权书（如有）',9],taxCredit:['过去3年税务信用等级',9],license:['公司营业执照',9],identity:['身份证复印件',15],ownership:['产权证明',15]};
 const keys=type==='房东'?['identity','ownership']:type==='甲供材分供方'?['license','contracts','photos','brand','taxCredit']:type==='公司分供方'?['license','contracts','taxCredit','brand','photos']:type==='零星供应商'?['application']:['credit','application','performancePhotos','contracts','photos','brand','taxCredit'];
 return keys.map(key=>({key,label:defs[key][0],limit:defs[key][1]}));
}
export function supplierMissingFields(record) {
 const missing=supplierFields(record.type).filter(f=>f.required&&!String(record[f.key]??'').trim()).map(f=>f.label);
 if(record.type!=='甲供材分供方') for(const [key,label] of [...CONTACT_FIELDS.slice(0,2),...INVOICE_FIELDS.slice(0,3)]) if(!String(record[key]??'').trim())missing.push(label);
 return missing;
}

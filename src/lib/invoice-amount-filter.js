import {moneyCents} from './invoice-allocation.js';
export function matchesInvoiceAmount(entry,input,field='total'){
 if(String(input??'').trim()==='')return true;
 const wanted=moneyCents(String(input).replace(/[,，￥¥元\s]/g,''));
 return wanted!==null&&moneyCents(entry[field])===wanted;
}

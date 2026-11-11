import { reactive } from 'vue';
let rows=[];try{rows=JSON.parse(localStorage.getItem('paymentRecords.v1')||'[]');}catch{}
export const paymentStore=reactive({rows});
export function savePayments(rows){localStorage.setItem('paymentRecords.v1',JSON.stringify(rows));paymentStore.rows=rows;}

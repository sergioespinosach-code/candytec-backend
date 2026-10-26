'use strict';
const sales=require('./sales-report-core');
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function orderDate(value){return value instanceof Date?value.toISOString().slice(0,10):sales.date(value);}
function pricing(orders,through=today()){
 const end=sales.date(through);
 if(!end||end!==through)throw Error('Fecha de corte inválida.');
 const floor=new Date(Date.parse(end+'T00:00:00Z')-3650*86400000).toISOString().slice(0,10);
 const mapped=orders.map(o=>({id:o.numero_pedido??o.id,fechaOrden:orderDate(o.fecha_orden??o.fechaOrden),state:o.estado??o.state,products:o.products||[],entregas:o.entregas||[],factura:o.factura,descuento:o.descuento,ivaTasa:o.iva_tasa??o.ivaTasa,finanzas:o.financial_data??o.finanzas,history:o.history||[],client:o.cliente??o.client,vendedor:o.vendedor}));
 const dated=mapped.map(o=>o.fechaOrden).filter(d=>d&&d<=end).sort();
 const from=dated.length&&dated[0]>floor?dated[0]:floor;
 const report=sales.build(mapped,from,end);
 const byName=new Map(report.products.map(p=>[p.name,{price:p.pricedQty>0?p.average:null,quantity:p.qty,pricedQuantity:p.pricedQty,missing:p.missing}]));
 return {from,to:end,byName};
}
module.exports={pricing,today};

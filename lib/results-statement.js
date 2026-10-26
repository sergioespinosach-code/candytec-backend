'use strict';
const sales=require('./sales-report-core');
const business=require('./business-control');
const bases=require('./base-formulations');
const productCosts=require('./product-costs');

const cents=n=>Math.round(Number(n||0)*100);
const amount=n=>Math.round(n)/100;
const date=v=>v instanceof Date?v.toISOString().slice(0,10):sales.date(v);
function summarize(orders,catalog,formulations,expenses,from,to){
 const mapped=orders.map(r=>({id:r.numero_pedido??r.id,fechaOrden:date(r.fecha_orden??r.fechaOrden),state:r.estado??r.state,products:r.products||[],entregas:r.entregas||[],factura:r.factura,descuento:r.descuento,ivaTasa:r.iva_tasa??r.ivaTasa,finanzas:r.financial_data??r.finanzas,history:r.history||[],costoTransporte:r.costo_transporte??r.costoTransporte,costoEstibaje:r.costo_estibaje??r.costoEstibaje,client:r.cliente??r.client,vendedor:r.vendedor}));
 const commercial=sales.build(mapped,from,to);
 const costByName=new Map(catalog.map(p=>{
   const base=formulations.rows.find(b=>Number(b.id)===Number(p.formula_id));
   return [p.nombre,productCosts.calculate(p,base,formulations.inventory,formulations.rows)];
 }));
 const byOrder=new Map(mapped.map(o=>[String(o.id),o]));
 const facts=new Map(commercial.facts.map(f=>[JSON.stringify([f.orderKey,f.invoice]),{...f,cost:0,missing:[],logistics:0}]));
 let knownCost=0;
 for(const l of commercial.lines){
   const fact=facts.get(JSON.stringify([l.orderKey,l.invoice]));if(!fact)continue;
   const cost=costByName.get(l.name);
   if(!cost?.complete||!Number.isFinite(Number(cost.total))){
     fact.missing.push({product:l.name,qty:l.qty,reason:cost?cost.missing.join('; '):'Producto sin ficha de costos'});
     continue;
   }
   const value=cents(Number(cost.total)*Number(l.qty));
   fact.cost+=value;knownCost+=value;
 }
 for(const fact of facts.values()){
   const o=byOrder.get(fact.orderKey);
   if(!o)continue;
   const deliveries=(o.entregas||[]).filter(e=>String(e.numeroFactura||'').trim()===fact.invoice&&['EN_TRANSITO','ENTREGADO'].includes(e.estado));
   if(o.entregas?.length){for(const e of deliveries)fact.logistics+=cents(e.costoTransporte)+cents(e.costoEstibaje);}
   else if(['EN_TRANSITO','ENTREGADO'].includes(o.state))fact.logistics=cents(o.costoTransporte)+cents(o.costoEstibaje);
   // A logistics entry belongs to its invoiced delivery, never to every invoice of the order.
 }
 const validExpenses=expenses.filter(r=>{
   const d=r.data||r;return d.status!=='anulado'&&sales.date(d.date)===d.date&&d.date>=from&&d.date<=to;
 });
 const category=new Map(),expenseGroups={operativo:0,fabricacion:0};
 for(const row of validExpenses){const e=row.data||row,v=cents(e.amount);expenseGroups[e.treatment==='fabricacion'?'fabricacion':'operativo']+=v;category.set(e.category,(category.get(e.category)||0)+v);}
 const logistics=[...facts.values()].reduce((n,f)=>n+f.logistics,0), expensesTotal=expenseGroups.operativo+expenseGroups.fabricacion;
 const base=commercial.total.base, margin=base-knownCost, estimated=margin-logistics-expensesTotal;
 const missing=[...facts.values()].flatMap(f=>f.missing.map(m=>({...m,order:f.orderKey,invoice:f.invoice})));
 const noDetail=[...facts.values()].filter(f=>f.qty===0).map(f=>({order:f.orderKey,invoice:f.invoice}));
 const complete=missing.length===0&&noDetail.length===0;
 const monthMap=new Map();
 function bucket(key){if(!monthMap.has(key))monthMap.set(key,{month:key,sales:0,cost:0,logistics:0,expenses:0,missing:0});return monthMap.get(key);}
 for(const f of facts.values()){const b=bucket(f.date.slice(0,7));b.sales+=f.base;b.cost+=f.cost;b.logistics+=f.logistics;b.missing+=f.missing.length+(f.qty===0?1:0);}
 for(const row of validExpenses){const e=row.data||row;bucket(e.date.slice(0,7)).expenses+=cents(e.amount);}
 const months=[...monthMap.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(b=>({...b,profit:b.missing?null:amount(b.sales-b.cost-b.logistics-b.expenses),sales:amount(b.sales),cost:amount(b.cost),logistics:amount(b.logistics),expenses:amount(b.expenses)}));
 return {from,to,at:new Date().toISOString(),basis:'fecha del pedido',sales:amount(base),iva:amount(commercial.total.iva),knownCost:amount(knownCost),gross:complete?amount(margin):null,logistics:amount(logistics),operating:amount(expenseGroups.operativo),manufacturing:amount(expenseGroups.fabricacion),estimated:complete?amount(estimated):null,knownResult:amount(estimated),complete,missing,noDetail,months,categories:[...category].map(([name,value])=>({name,amount:amount(value)})).sort((a,b)=>b.amount-a.amount),invoices:facts.size,orders:commercial.total.orders,unallocated:amount(commercial.total.unallocated),notes:['Las ventas se agrupan por fecha del pedido e incluyen las facturas registradas hasta hoy, sus correcciones y notas de crédito. No es la fecha contable de emisión.','El costo de lo facturado utiliza los costos actuales por presentación de cada ficha, también si el producto está archivado. No conserva el costo histórico del momento de la venta.','El costo logístico registrado se atribuye a la factura del pedido; los gastos se asignan por fecha del gasto e incluyen pendientes y pagados. Un gasto de transporte registrado también como costo logístico puede duplicarse.','Revisa si los gastos de fabricación ya están incorporados en la formulación, como mano de obra u otros costos, antes de incluirlos otra vez.','Las notas de crédito reducen las ventas; el sistema no conoce qué unidades se devolvieron, por lo que no revierte automáticamente su costo.','Este resultado de gestión no incluye impuestos sobre la renta, depreciación ni ajustes contables no registrados.',...commercial.notes.filter(n=>n.includes('excluidos'))]};
}
async function report(pool,userId,from,to){
 // Validate before querying, including the ten-year limit used by the commercial report.
 try{sales.build([],from,to);}catch(e){e.status=400;throw e;}
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await business.actor(db,userId,true);
  const catalog=(await db.query('SELECT * FROM catalogo ORDER BY nombre')).rows;
  const formulations=await bases.list(db);
  const orders=(await db.query('SELECT * FROM pedidos')).rows;
  const expenses=(await db.query("SELECT data FROM business_expenses WHERE data->>'date'>=$1 AND data->>'date'<=$2",[from,to])).rows;
  const result=summarize(orders,catalog,formulations,expenses,from,to);
  await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={summarize,report};

'use strict';
const pricing=require('./product-sales-pricing');
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function summarize(items,orders,through){
 const prices=pricing.pricing(orders,through),rows=items.filter(i=>i.tipo==='producto_terminado').map(i=>{
  const stock=Number(i.stock),sale=prices.byName.get(i.nombre),price=sale?.price??null;
  const valid=Number.isFinite(stock)&&stock>=0;
  return {id:i.id,name:i.nombre,stock:valid?stock:null,unit:i.unidad,price,value:valid&&stock===0?0:valid&&price!==null?round(stock*price):null,soldQuantity:sale?.pricedQuantity||0,missingDetail:sale?.missing||0};
 });
 const missing=rows.filter(r=>r.value===null&&r.stock!==0),known=round(rows.reduce((sum,r)=>sum+(r.value??0),0));
 return {at:new Date().toISOString(),from:prices.from,to:prices.to,rows,knownTotal:known,total:missing.length?null:known,missing:missing.length};
}
async function report(pool,userId){
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const user=(await db.query('SELECT role FROM users WHERE id=$1',[userId])).rows[0];
  if(!user)throw Object.assign(Error('Sesión inválida.'),{status:401});
  if(!['gerente','jventas','produccion','bodega'].includes(user.role))throw Object.assign(Error('Sin acceso a la bodega de producto terminado.'),{status:403});
  const items=(await db.query("SELECT id,nombre,unidad,stock,tipo FROM inventario WHERE tipo='producto_terminado'")).rows;
  const orders=(await db.query('SELECT numero_pedido,fecha_orden,estado,products,entregas,factura,descuento,iva_tasa,financial_data,history,cliente,vendedor FROM pedidos')).rows;
  const result=summarize(items,orders,pricing.today());
  await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
module.exports={summarize,report};

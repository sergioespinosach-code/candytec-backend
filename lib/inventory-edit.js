'use strict';
const {validate}=require('./inventory-movement');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const sign=t=>['ingreso','ajuste_alza'].includes(t)?1:-1;
const price=m=>m.precio!=null?Number(m.precio):(Number(m.edit_version||0)===0&&m.operation_payload?.precio!=null?Number(m.operation_payload.precio):null);
const qty=n=>Math.round(n*100)/100;
function recalculate(item,rows,next){
  const old=rows[0],delta=sign(next.tipo)*next.cantidad-sign(old.tipo)*Number(old.cantidad);
  const stock=qty(Number(item.stock)+delta);
  if(!Number.isFinite(stock)||stock<0||stock>=1e8)throw fail(409,'La corrección dejaría un saldo inválido. Revisa las cantidades.');
  if(item.tipo!=='materia_prima')return {stock,cost:item.costo_prom};
  if(next.tipo==='ingreso'&&!(next.precio>0))throw fail(400,'Ingresa el precio por '+item.unidad+'.');
  const sameQty=next.tipo===old.tipo&&next.cantidad===Number(old.cantidad);
  if(sameQty&&(old.tipo!=='ingreso'||next.precio===price(old)))return {stock,cost:item.costo_prom};
  // Reconstruct physical balances from the confirmed current stock, never the browser.
  let balance=Number(item.stock);
  const timeline=rows.map(m=>({...m,cantidad:Number(m.cantidad)}));
  for(let i=timeline.length-1;i>=0;i--){
    const m=timeline[i];m.after=balance;balance=qty(balance-sign(m.tipo)*m.cantidad);m.before=balance;
    if(balance<0||m.after<0)throw fail(409,'El historial tiene saldos inconsistentes. Revisa los movimientos antes de corregir el costo.');
    if(m.cost_before&&Math.abs(Number(m.cost_before.stock)-balance)>0.005)throw fail(409,'Hay ajustes de saldo fuera del historial. Se requiere revisar este ingreso antes de recalcularlo.');
  }
  const first=timeline[0];
  if(sameQty&&old.tipo==='ingreso'){
    if(!(price(old)>0))throw fail(409,'Este ingreso antiguo no conserva su precio original. No se puede recalcular su costo automáticamente sin revisar el historial.');
    let difference=first.cantidad*(next.precio-price(old))/first.after;
    // Outflows keep the moving average; subsequent purchases dilute the correction.
    for(const m of timeline.slice(1))if(m.tipo==='ingreso')difference*=m.before/m.after;
    const cost=Number(item.costo_prom)+difference;
    if(!Number.isFinite(cost)||cost < -0.000001)throw fail(409,'El costo resultante no es válido. Revisa el historial.');
    return {stock,cost:Math.max(0,cost)};
  }
  // Quantity/type changes require the original valuation, not a current-price substitute.
  let initialCost;
  if(first.cost_before)initialCost=Number(first.cost_before.cost||0);
  else if(first.before===0&&next.tipo==='ingreso')initialCost=0;
  else{
    let c=Number(item.costo_prom);
    for(let i=timeline.length-1;i>=0;i--){const m=timeline[i];
      if(m.tipo!=='ingreso')continue;
      if(!(price(m)>0)||m.before===0)throw fail(409,'Falta la valoración histórica para cambiar esta cantidad o tipo. Puedes corregir el precio del ingreso por separado.');
      c=(m.after*c-m.cantidad*price(m))/m.before;
    }
    initialCost=c;
  }
  if(!Number.isFinite(initialCost)||initialCost< -0.00001)throw fail(409,'No se pudo reconstruir el costo anterior del ingreso.');
  let cost=Math.max(0,initialCost),running=first.before;
  for(let i=0;i<timeline.length;i++){
    const m=i===0?next:timeline[i],after=qty(running+sign(m.tipo)*Number(m.cantidad));
    if(after<0)throw fail(409,'La corrección dejaría stock negativo en un movimiento posterior.');
    if(m.tipo==='ingreso'){
      const p=i===0?next.precio:price(m);
      if(!(p>0))throw fail(409,'Un ingreso posterior no tiene precio registrado. Revisa el historial antes de cambiar cantidades.');
      cost=(running*cost+Number(m.cantidad)*p)/after;
    }
    running=after;
  }
  return {stock:running,cost};
}
async function init(pool){
  await pool.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS precio NUMERIC(18,6), ADD COLUMN IF NOT EXISTS edit_version INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS cost_before JSONB');
  await pool.query('CREATE TABLE IF NOT EXISTS inventory_movement_edits (id BIGSERIAL PRIMARY KEY, movement_id INTEGER NOT NULL, user_id INTEGER NOT NULL, operation_key VARCHAR(100) UNIQUE NOT NULL, payload JSONB NOT NULL, before_data JSONB NOT NULL, after_data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
}
async function edit(pool,userId,id,body){
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw fail(400,'Movimiento inválido.');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const user=(await db.query('SELECT id, role FROM users WHERE id=$1',[userId])).rows[0];
    if(!user||!['gerente','bodega'].includes(user.role))throw fail(403,'Solo Bodega y Gerencia pueden editar movimientos.');
    const found=(await db.query('SELECT * FROM movimientos WHERE id=$1',[id])).rows[0];
    if(!found)throw fail(404,'Movimiento no encontrado.');
    const input=validate(found.item_id,body);
    const payload={...input,version:body.version,user_id:userId,movement_id:Number(id)};
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.operation_key]);
    const previous=(await db.query('SELECT * FROM inventory_movement_edits WHERE operation_key=$1',[input.operation_key])).rows[0];
    if(previous){
      if(JSON.stringify(previous.payload)!==JSON.stringify(payload)&&Object.keys(payload).some(k=>previous.payload[k]!==payload[k]))throw fail(409,'La clave de reintento corresponde a otra corrección.');
      const item=(await db.query('SELECT * FROM inventario WHERE id=$1',[found.item_id])).rows[0];
      const actual=(await db.query('SELECT * FROM movimientos WHERE id=$1',[id])).rows[0];
      await db.query('COMMIT');return {inventario:item,actual,repetido:true};
    }
    const item=(await db.query('SELECT * FROM inventario WHERE id=$1 FOR UPDATE',[found.item_id])).rows[0];
    if(!item)throw fail(404,'El ítem ya no existe.');
    const rows=(await db.query('SELECT * FROM movimientos WHERE item_id=$1 AND id >= $2 ORDER BY id FOR UPDATE',[found.item_id,id])).rows;
    const old=rows[0];
    if(!old||Number(old.id)!==Number(id))throw fail(409,'El movimiento cambió. Actualiza la página.');
    if(!Number.isInteger(body.version)||body.version!==Number(old.edit_version||0))throw fail(409,'Otra persona editó este movimiento. Actualiza la página antes de continuar.');
    const next={...input,precio:item.tipo==='materia_prima'&&input.tipo==='ingreso'?input.precio:null};
    const result=recalculate(item,rows,next);
    const updated=(await db.query('UPDATE inventario SET stock=$1, costo_prom=$2 WHERE id=$3 RETURNING *',[result.stock,result.cost,item.id])).rows[0];
    const actual=(await db.query('UPDATE movimientos SET tipo=$1,cantidad=$2,motivo=$3,precio=$4,edit_version=edit_version+1 WHERE id=$5 RETURNING *',[next.tipo,next.cantidad,next.motivo,next.precio,id])).rows[0];
    // Downstream snapshots no longer describe the corrected past; remove them so future edits reconstruct it.
    await db.query('UPDATE movimientos SET cost_before=NULL WHERE item_id=$1 AND id>$2',[item.id,id]);
    await db.query('INSERT INTO inventory_movement_edits (movement_id,user_id,operation_key,payload,before_data,after_data) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',[id,userId,input.operation_key,JSON.stringify(payload),JSON.stringify({movimiento:old,inventario:item}),JSON.stringify({movimiento:actual,inventario:updated})]);
    await db.query('COMMIT');return {inventario:updated,actual,repetido:false};
  }catch(err){await db.query('ROLLBACK').catch(()=>{});throw err;}finally{db.release();}
}
module.exports={init,edit,recalculate,price};

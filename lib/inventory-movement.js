'use strict';
const fail=(status,message)=>Object.assign(new Error(message),{status});
function validate(itemId,body){
  const id=Number(itemId),qty=Number(body.cantidad),price=body.precio==null?null:Number(body.precio);
  if(!Number.isSafeInteger(id)||id<=0)throw fail(400,'Ítem inválido.');
  if(!['ingreso','salida','consumo','ajuste_alza','ajuste_baja'].includes(body.tipo))throw fail(400,'Tipo de movimiento inválido.');
  if(!Number.isFinite(qty)||qty<=0||qty>=1e8||Math.abs(qty*100-Math.round(qty*100))>0.00001)throw fail(400,'Cantidad inválida. Usa hasta dos decimales.');
  if(price!==null&&(!Number.isFinite(price)||price<=0||price>=1e8))throw fail(400,'Precio inválido.');
  if(typeof body.motivo!=='string'||!body.motivo.trim()||body.motivo.length>2000)throw fail(400,'El motivo es obligatorio (máximo 2000 caracteres).');
  if(typeof body.operation_key!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.operation_key))throw fail(400,'Identificador de operación inválido. Recarga el formulario.');
  return {item_id:id,tipo:body.tipo,cantidad:qty,precio:price,motivo:body.motivo.trim(),operation_key:body.operation_key};
}
async function init(pool){
  await pool.query('ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS operation_key VARCHAR(100), ADD COLUMN IF NOT EXISTS operation_payload JSONB');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS movimientos_operation_key_idx ON movimientos(operation_key) WHERE operation_key IS NOT NULL');
}
async function record(pool,userId,itemId,body){
  const input=validate(itemId,body),payload={...input,user_id:userId};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const user=(await client.query('SELECT id, name, username, role FROM users WHERE id=$1',[userId])).rows[0];
    if(!user)throw fail(401,'La sesión ya no es válida. Vuelve a ingresar.');
    if(!['bodega','gerente'].includes(user.role))throw fail(403,'Solo Bodega y Gerencia pueden registrar movimientos.');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.operation_key]);
    const previous=(await client.query('SELECT * FROM movimientos WHERE operation_key=$1',[input.operation_key])).rows[0];
    if(previous){
      if(Object.keys(payload).some(k=>previous.operation_payload?.[k]!==payload[k]))throw fail(409,'Este identificador ya corresponde a otro movimiento.');
      const item=(await client.query('SELECT * FROM inventario WHERE id=$1',[input.item_id])).rows[0];
      if(!item)throw fail(404,'El ítem ya no existe.');
      await client.query('COMMIT');return {inventario:item,movimiento:previous,repetido:true};
    }
    const item=(await client.query('SELECT * FROM inventario WHERE id=$1 FOR UPDATE',[input.item_id])).rows[0];
    if(!item)throw fail(404,'El ítem ya no existe. Actualiza el inventario.');
    const positive=['ingreso','ajuste_alza'].includes(input.tipo);
    const stock=Number(item.stock||0),cost=Number(item.costo_prom||0);
    if(!Number.isFinite(stock)||stock<0||!Number.isFinite(cost)||cost<0)throw fail(409,'El saldo actual del ítem requiere revisión por Gerencia.');
    const next=Math.round((stock+(positive?input.cantidad:-input.cantidad))*100)/100;
    if(next<0)throw fail(409,'Stock insuficiente. Saldo confirmado: '+stock+' '+item.unidad+'.');
    if(next>=1e8)throw fail(400,'La cantidad supera el límite del inventario.');
    const purchase=item.tipo==='materia_prima'&&input.tipo==='ingreso';
    if(purchase&&!(input.precio>0))throw fail(400,'Ingresa el precio por '+item.unidad+' de la materia prima.');
    const nextCost=purchase?(stock*cost+input.cantidad*input.precio)/next:item.costo_prom;
    const updated=(await client.query('UPDATE inventario SET stock=$1, costo_prom=$2 WHERE id=$3 RETURNING *',[next,nextCost,input.item_id])).rows[0];
    const movement=(await client.query('INSERT INTO movimientos (item_id,tipo,cantidad,motivo,usuario,fecha,operation_key,operation_payload) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7::jsonb) RETURNING *',[input.item_id,input.tipo,input.cantidad,input.motivo,(user.name||user.username)+' · '+user.role,input.operation_key,JSON.stringify(payload)])).rows[0];
    await client.query('COMMIT');return {inventario:updated,movimiento:movement,repetido:false};
  }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
}
function register(app,pool,verifyToken){
  app.post('/api/inventario/:id/movimiento',verifyToken,async(req,res)=>{
    try{res.set('Cache-Control','no-store').json(await record(pool,req.user.userId,req.params.id,req.body||{}));}
    catch(err){if(!err.status)console.error('inventory movement:',err);res.status(err.status||500).json({error:err.status?err.message:'No se pudo confirmar el movimiento. Reintenta con el mismo formulario.'});}
  });
}
module.exports={init,record,register,validate};

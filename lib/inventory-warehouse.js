'use strict';
const crypto=require('node:crypto');
const allowed=['materias_primas','laminas_cajas'];
const fail=(status,message)=>Object.assign(Error(message),{status});
async function init(pool){await pool.query("ALTER TABLE inventario ADD COLUMN IF NOT EXISTS bodega VARCHAR(30) NOT NULL DEFAULT 'materias_primas'");}
function validate(body){
 if(!allowed.includes(body.bodega)||!allowed.includes(body.desde))throw fail(400,'Bodega inválida.');
 if(typeof body.operation_key!=='string'||!/^[\w-]{16,100}$/.test(body.operation_key))throw fail(400,'Identificador de operación inválido.');
}
async function move(pool,userId,id,body){
 validate(body);id=Number(id);if(!Number.isSafeInteger(id)||id<=0)throw fail(400,'Ítem inválido.');
 const hash=crypto.createHash('sha256').update(JSON.stringify({entity:'warehouse',id,desde:body.desde,bodega:body.bodega})).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const user=(await db.query('SELECT id,name,username,role FROM users WHERE id=$1',[userId])).rows[0];
  if(!user||!['bodega','gerente'].includes(user.role))throw fail(403,'Solo Bodega y Gerencia pueden cambiar la bodega.');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[body.operation_key]);
  const prior=(await db.query('SELECT * FROM business_operations WHERE operation_key=$1',[body.operation_key])).rows[0];
  if(prior){
   if(Number(prior.actor_id)!==Number(user.id)||prior.request_hash!==hash)throw fail(409,'Este identificador corresponde a otro cambio.');
   await db.query('COMMIT');return prior.response;
  }
  const item=(await db.query('SELECT * FROM inventario WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!item)throw fail(404,'El material ya no existe.');
  if(item.tipo!=='materia_prima')throw fail(400,'Solo se pueden clasificar materias primas y materiales de empaque.');
  if(item.bodega!==body.desde)throw fail(409,'La bodega del material cambió. Actualiza la página.');
  const updated=(await db.query('UPDATE inventario SET bodega=$1 WHERE id=$2 RETURNING *',[body.bodega,id])).rows[0];
  await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',['inventory',id,user.id,user.name||user.username,'Cambio de bodega: '+body.desde+' → '+body.bodega,JSON.stringify(item),JSON.stringify(updated)]);
  const response={id,bodega:updated.bodega};
  await db.query('INSERT INTO business_operations(operation_key,actor_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[body.operation_key,user.id,hash,JSON.stringify(response)]);
  await db.query('COMMIT');return response;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function register(app,pool,verifyToken){app.post('/api/inventario/:id/bodega',verifyToken,async(req,res)=>{
 try{res.set('Cache-Control','no-store').json(await move(pool,req.user.userId,req.params.id,req.body||{}));}
 catch(e){if(!e.status)console.error('warehouse:',e);res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar el cambio. Pulsa Reintentar.'});}
});}
module.exports={init,move,register,validate};

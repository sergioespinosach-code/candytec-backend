'use strict';
const {randomUUID}=require('node:crypto');
const fail=(status,message)=>Object.assign(Error(message),{status});
const commercial=['vendedor','jventas','gerente'];
const canChoose=u=>['gerente','jventas'].includes(u?.role);
const canReassign=u=>u?.role==='gerente'&&u?.username==='gerente_proy';
async function actor(db,id){
  const u=(await db.query('SELECT id,username,name,role FROM users WHERE id=$1',[id])).rows[0];
  if(!u)throw fail(401,'La cuenta ya no está disponible. Vuelve a iniciar sesión.');
  return u;
}
async function target(db,id){
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw fail(400,'Selecciona a quién pertenece el pedido.');
  const u=(await db.query('SELECT id,username,name,role FROM users WHERE id=$1',[Number(id)])).rows[0];
  if(!u)throw fail(400,'El vendedor seleccionado ya no existe. Vuelve a cargar la lista.');
  if(!commercial.includes(u.role)||!u.name?.trim())throw fail(400,'Selecciona un vendedor, jefe de ventas o gerente vigente.');
  // Los pedidos existentes relacionan al vendedor por nombre; no aceptar homónimos ambiguos.
  const same=await db.query('SELECT id FROM users WHERE name=$1',[u.name]);
  if(same.rows.some(other=>Number(other.id)!==Number(u.id)))throw fail(409,'Hay usuarios con el mismo nombre. Diferencia sus nombres antes de asignar pedidos.');
  return u;
}
async function creation(db,userId,body){
  const user=await actor(db,userId);
  let seller=user;
  if(body.vendedor_id!==undefined){
    if(!canChoose(user))throw fail(403,'Solo gerencia y jefe de ventas pueden elegir otro vendedor al crear pedidos.');
    seller=await target(db,body.vendedor_id);
  }else if(body.vendedor!==undefined&&body.vendedor!==user.name){
    throw fail(403,'No puedes crear pedidos a nombre de otra persona sin usar el selector autorizado.');
  }
  return {user,seller};
}
async function options(db,userId){
  const user=await actor(db,userId);
  if(!canChoose(user))throw fail(403,'No tienes permiso para elegir vendedores.');
  return (await db.query('SELECT id,name,role FROM users WHERE role=ANY($1::text[]) ORDER BY name,id',[commercial])).rows;
}
async function reassign(pool,userId,id,body){
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const user=await actor(db,userId);
    if(!canReassign(user))throw fail(403,'Solo Sergio, desde Gerencia de Proyectos, puede cambiar el vendedor de un pedido existente.');
    const seller=await target(db,body.vendedor_id);
    const row=(await db.query('SELECT * FROM pedidos WHERE numero_pedido=$1 FOR UPDATE',[id])).rows[0];
    if(!row)throw fail(404,'Pedido no encontrado.');
    if(!Object.hasOwn(body,'vendedor_anterior'))throw fail(400,'Actualiza el pedido antes de cambiar el vendedor.');
    // Reintentar el mismo destino es inocuo, incluso si se perdió la respuesta anterior.
    if(row.vendedor===seller.name){await db.query('COMMIT');return row;}
    if((row.vendedor??null)!==(body.vendedor_anterior??null))throw fail(409,'El vendedor de este pedido cambió. Cierra la ficha, actualiza y vuelve a intentarlo.');
    const event={s:row.estado,kind:'SELLER_ASSIGNMENT',operation:randomUUID(),actor:user.name+' · Gerencia de Proyectos',t:new Date().toISOString(),from:row.vendedor??null,to:seller.name,actorId:user.id,sellerId:seller.id,note:'Vendedor cambiado de '+(row.vendedor||'Sin vendedor')+' a '+seller.name+'.'};
    const history=[...(Array.isArray(row.history)?row.history:[]),event];
    const updated=(await db.query('UPDATE pedidos SET vendedor=$1, history=$2::jsonb WHERE id=$3 RETURNING *',[seller.name,JSON.stringify(history),row.id])).rows[0];
    await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[
      'order_seller',row.id,user.id,user.name,event.note,JSON.stringify({vendedor:row.vendedor}),JSON.stringify({vendedor:seller.name,vendedor_id:seller.id})]);
    await db.query('COMMIT');return updated;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function register(app,pool,verifyToken){
  const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudo guardar o consultar el vendedor. Intenta nuevamente.'});}};
  app.get('/api/pedido-vendedores',verifyToken,wrap(req=>options(pool,req.user.userId)));
  app.post('/api/pedidos/:id/vendedor',verifyToken,wrap(req=>reassign(pool,req.user.userId,req.params.id,req.body||{})));
}
module.exports={creation,options,reassign,register,canChoose,canReassign};

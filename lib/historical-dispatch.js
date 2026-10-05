'use strict';
// Corrección acotada a los cuatro despachos históricos solicitados por Gerencia.
const targets={'CT-2026-01206':'001-001-9134','CT-2026-01187':'001-001-9150','CT-2026-01185':'001-001-9113','CT-2026-01184':'001-001-9110'};
const fail=(status,message)=>Object.assign(Error(message),{status});
function prepare(row,body,user,now=new Date()){
 if(user?.role!=='gerente')throw fail(403,'Solo Gerencia puede registrar este despacho anterior.');
 const invoice=targets[row.numero_pedido];
 if(!invoice)throw fail(400,'Este pedido no está habilitado para esta regularización.');
 const marker='despacho-historico-2026-10-02:'+invoice;
 if((row.history||[]).some(h=>h.operation===marker))return null;
 if(row.estado!=='POR_ENTREGAR')throw fail(409,'El pedido ya cambió de estado. Actualiza la página.');
 const date=String(body.fecha||''),reason=String(body.motivo||'').trim();
 const parsed=new Date(date+'T12:00:00Z');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date>today)throw fail(400,'Indica una fecha real de despacho, válida y no futura.');
 if(reason.length<10||reason.length>2000)throw fail(400,'Describe el motivo de la regularización (10 a 2000 caracteres).');
 const deliveries=structuredClone(row.entregas||[]);
 if(deliveries.length){
  const selected=deliveries.filter(e=>String(e.numeroFactura||'').trim()===invoice);
  if(!selected.length||selected.some(e=>e.estado!=='POR_DESPACHAR'))throw fail(409,'La factura o sus entregas cambiaron. Revisa el pedido.');
  selected.forEach(e=>{e.estado='EN_TRANSITO';e.despachoHistorico={fecha:date,registradoEn:now.toISOString(),actorId:user.id,motivo:reason};});
 }else if(String(row.factura||'').trim()!==invoice)throw fail(409,'La factura del pedido no coincide con la regularización.');
 const state=deliveries.some(e=>e.estado==='POR_DESPACHAR')?'POR_ENTREGAR':'EN_TRANSITO';
 const history=[...(row.history||[]),{s:state,actor:(user.name||user.username)+' · Gerencia',t:now.toISOString(),operation:marker,note:'Despacho histórico de factura '+invoice+' realizado el '+date+'. Registro administrativo sin movimiento de inventario. Motivo: '+reason}];
 return {estado:state,entregas:deliveries,history};
}
async function record(pool,userId,id,body){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const user=(await db.query('SELECT id,name,username,role FROM users WHERE id=$1',[userId])).rows[0];
  if(user?.role!=='gerente')throw fail(403,'Solo Gerencia puede registrar este despacho anterior.');
  const row=(await db.query('SELECT * FROM pedidos WHERE numero_pedido=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw fail(404,'Pedido no encontrado.');
  const next=prepare(row,body,user);
  if(!next){await db.query('COMMIT');return row;}
  const updated=(await db.query('UPDATE pedidos SET estado=$1, entregas=$2::jsonb, history=$3::jsonb WHERE id=$4 RETURNING *',[next.estado,JSON.stringify(next.entregas),JSON.stringify(next.history),row.id])).rows[0];
  await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',['historical_dispatch',row.id,user.id,user.name||user.username,body.motivo.trim(),JSON.stringify({estado:row.estado,entregas:row.entregas}),JSON.stringify(next)]);
  await db.query('COMMIT');return updated;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function register(app,pool,verifyToken){app.post('/api/pedidos/:id/despacho-historico',verifyToken,async(req,res)=>{
 try{res.set('Cache-Control','no-store').json(await record(pool,req.user.userId,req.params.id,req.body||{}));}
 catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar el registro. Actualiza la página antes de reintentar.'});}
});}
module.exports={prepare,record,register};

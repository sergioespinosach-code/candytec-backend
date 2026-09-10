'use strict';
const crypto=require('node:crypto'),Core=require('./order-finance-core');
const token=row=>crypto.createHash('sha256').update(JSON.stringify([row.products,row.subtotal,row.descuento,row.iva_tasa,row.factura,row.entregas,row.pago,row.financial_data])).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
async function init(pool){await pool.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS financial_data JSONB NOT NULL DEFAULT '{\"events\":[],\"snapshots\":[]}'::jsonb");}
function protect(row,body){
  const pinned=row.financial_data?.snapshots||[];if(!pinned.length)return;
  const merged={...row,...body};
  const old=Core.invoices(row),next=Core.invoices(merged);
  for(const invoice of pinned){
    const a=old.find(i=>i.numero===invoice.numero),b=next.find(i=>i.numero===invoice.numero);
    if(!a||!b||a.base!==b.base||a.iva!==b.iva)throw error(409,'Esta factura tiene ajustes registrados. Corrige sus importes desde Ajustes de facturación.');
  }
}
function register(app,pool,verifyToken){
  async function allowed(client,id){
    const user=(await client.query('SELECT id,name,username,role FROM users WHERE id=$1',[id])).rows[0];
    if(!user)throw error(401,'Sesión inválida.');
    if(!['facturacion','gerente'].includes(user.role))throw error(403,'Solo Facturación y Gerencia pueden gestionar ajustes.');return user;
  }
  app.get('/api/pedidos/:id/finanzas',verifyToken,async(req,res)=>{
    try{await allowed(pool,req.user.userId);const row=(await pool.query('SELECT * FROM pedidos WHERE numero_pedido=$1',[req.params.id])).rows[0];if(!row)throw error(404,'Pedido no encontrado.');res.set('Cache-Control','no-store').json({pedido:row,token:token(row),summary:Core.summary(row)});}
    catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudieron consultar los valores del pedido.'});}
  });
  app.post('/api/pedidos/:id/ajustes-financieros',verifyToken,async(req,res)=>{
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');const user=await allowed(client,req.user.userId);
      await client.query('SELECT pg_advisory_xact_lock(72190421)');
      const row=(await client.query('SELECT * FROM pedidos WHERE numero_pedido=$1 FOR UPDATE',[req.params.id])).rows[0];if(!row)throw error(404,'Pedido no encontrado.');
      const b=req.body||{},requestHash=crypto.createHash('sha256').update(JSON.stringify({...b,expected_token:undefined})).digest('hex');
      const prior=(row.financial_data?.events||[]).find(e=>e.id===b.operation_key);
      if(prior){if(prior.requestHash!==requestHash)throw error(409,'La operación ya fue registrada con otros datos.');await client.query('COMMIT');return res.json({pedido:row,summary:Core.summary(row),token:token(row)});}
      if(b.expected_token!==token(row))throw error(409,'El pedido cambió. Vuelve a abrir Ajustes de facturación y revisa los valores antes de registrar.');
      if((row.financial_data?.events||[]).length>=500)throw error(400,'El pedido alcanzó el límite de ajustes.');
      if(b.type==='NC'&&typeof b.number==='string'){
        const duplicate=await client.query(`SELECT numero_pedido FROM pedidos p WHERE numero_pedido<>$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.financial_data->'events') e WHERE e->>'type'='NC' AND upper(e->>'number')=upper($2) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.financial_data->'events') r WHERE r->>'type'='REVERSO' AND r->>'target'=e->>'id')) LIMIT 1`,[req.params.id,b.number.trim()]);
        if(duplicate.rows.length)throw error(409,'La nota de crédito ya está registrada en '+duplicate.rows[0].numero_pedido+'.');
      }
      let data;try{data=Core.append(row,b,{id:user.id,name:user.name||user.username,role:user.role},new Date().toISOString());}catch(e){throw error(400,e.message);}
      data.events[data.events.length-1].requestHash=requestHash;
      const saved=(await client.query('UPDATE pedidos SET financial_data=$1::jsonb WHERE numero_pedido=$2 RETURNING *',[JSON.stringify(data),req.params.id])).rows[0];
      await client.query('COMMIT');res.json({pedido:saved,summary:Core.summary(saved),token:token(saved)});
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(!e.status)console.error('financial adjustment',e);res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar el ajuste. Reintenta en el mismo formulario.'});}finally{client?.release();}
  });
}
module.exports={init,register,protect,token};

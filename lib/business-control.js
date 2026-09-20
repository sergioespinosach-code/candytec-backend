'use strict';
const crypto=require('node:crypto');
const core=require('./business-control-core');
async function init(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS cost_formulas (
 id SERIAL PRIMARY KEY, data JSONB NOT NULL, snapshot JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS business_expenses (
 id SERIAL PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS business_expenses_date_idx ON business_expenses ((data->>'date'));
 CREATE TABLE IF NOT EXISTS business_audit (
 id BIGSERIAL PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
 actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, reason TEXT NOT NULL,
 before_data JSONB, after_data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS business_audit_entity_idx ON business_audit(entity,entity_id,id);
 CREATE TABLE IF NOT EXISTS business_operations (
 operation_key VARCHAR(100) PRIMARY KEY, actor_id INTEGER NOT NULL,
 request_hash TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
 AND table_name='inventario' AND column_name='costo_prom' AND numeric_scale<6) THEN
 ALTER TABLE inventario ALTER COLUMN costo_prom TYPE NUMERIC(18,6);
 END IF; END; $$;`);
}
async function actor(db,userId,costs=false){const u=(await db.query('SELECT id,name,username,role FROM users WHERE id=$1',[userId])).rows[0];if(!u)throw core.fail('Sesión inválida.',401);if(!(costs?['gerente']:['gerente','facturacion']).includes(u.role))throw core.fail('No tienes permiso para este módulo.',403);return u;}
async function resources(db){const inventory=(await db.query("SELECT id,nombre,unidad,tipo,costo_prom FROM inventario WHERE tipo='materia_prima' ORDER BY nombre")).rows;const products=(await db.query('SELECT id,nombre FROM catalogo WHERE activo=TRUE ORDER BY nombre')).rows;return {inventory,products};}
async function save(pool,userId,kind,body){
 const isCost=kind==='formula';if(!isCost&&kind!=='expense')throw core.fail('Operación inválida.');
 const key=body.operation_key;if(typeof key!=='string'||!/^[\w-]{16,100}$/.test(key))throw core.fail('Identificador de operación inválido.');
 const entityId=body.id==null?null:core.id(body.id);const version=entityId?core.id(body.version):null;
 const reason=core.text(body.reason||'','Motivo',1000,!!entityId);
 const data=isCost?core.formula(body.data||{}):core.expense(body.data||{});
 const hash=crypto.createHash('sha256').update(JSON.stringify({kind,entityId,version,reason,data})).digest('hex');
 const db=await pool.connect();
 try{await db.query('BEGIN');const u=await actor(db,userId,isCost);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
 const previous=(await db.query('SELECT * FROM business_operations WHERE operation_key=$1',[key])).rows[0];
 if(previous){if(Number(previous.actor_id)!==Number(u.id)||previous.request_hash!==hash)throw core.fail('Este intento corresponde a otra operación.',409);await db.query('COMMIT');return previous.response;}
 const table=isCost?'cost_formulas':'business_expenses';let before=null;
 if(entityId){before=(await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[entityId])).rows[0];if(!before)throw core.fail('Registro no encontrado.',404);if(before.version!==version)throw core.fail('Otra persona actualizó este registro. Vuelve a abrirlo antes de editar.',409);}
 let snapshot=null;
 if(isCost){const r=await resources(db);if(!r.products.some(p=>Number(p.id)===data.product_id))throw core.fail('Selecciona un producto vigente del catálogo.');snapshot=core.calculate(data,r.inventory);}
 else if(data.order_id){if(!(await db.query('SELECT id FROM pedidos WHERE numero_pedido=$1',[data.order_id])).rows.length)throw core.fail('El pedido indicado no existe.');}
 let row;
 if(entityId){row=(await db.query(isCost?'UPDATE cost_formulas SET data=$1::jsonb,snapshot=$2::jsonb,version=version+1,updated_at=NOW() WHERE id=$3 RETURNING *':'UPDATE business_expenses SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=$2 RETURNING *',isCost?[JSON.stringify(data),JSON.stringify(snapshot),entityId]:[JSON.stringify(data),entityId])).rows[0];}
 else{row=(await db.query(isCost?'INSERT INTO cost_formulas(data,snapshot) VALUES($1::jsonb,$2::jsonb) RETURNING *':'INSERT INTO business_expenses(data) VALUES($1::jsonb) RETURNING *',isCost?[JSON.stringify(data),JSON.stringify(snapshot)]:[JSON.stringify(data)])).rows[0];}
 await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[kind,row.id,u.id,u.name||u.username,reason||'Registro inicial',JSON.stringify(before),JSON.stringify(row)]);
 await db.query('INSERT INTO business_operations(operation_key,actor_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[key,u.id,hash,JSON.stringify(row)]);
 await db.query('COMMIT');return row;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function monthRange(month){if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2200)throw core.fail('Mes inválido.');const start=month+'-01';const d=new Date(start+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);const end=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()-2);return {start,end,previous:d.toISOString().slice(0,10)};}
function register(app,pool,verifyToken){
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');res.json(await fn(req));}catch(e){if(!e.status)console.error('business-control:',e);res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar la operación. Reintenta sin cambiar el formulario.'});}};
 app.get('/api/business/formulas',verifyToken,wrap(async req=>{await actor(pool,req.user.userId,true);const r=await resources(pool);const rows=(await pool.query('SELECT * FROM cost_formulas ORDER BY id DESC')).rows;return {...r,rows:rows.map(row=>({...row,current:core.calculate(row.data,r.inventory)}))};}));
 app.post('/api/business/formulas/preview',verifyToken,wrap(async req=>{await actor(pool,req.user.userId,true);const f=core.formula(req.body);const r=await resources(pool);return core.calculate(f,r.inventory);}));
 app.post('/api/business/formulas/save',verifyToken,wrap(req=>save(pool,req.user.userId,'formula',req.body||{})));
 app.post('/api/business/expenses/save',verifyToken,wrap(req=>save(pool,req.user.userId,'expense',req.body||{})));
 app.get('/api/business/expenses',verifyToken,wrap(async req=>{await actor(pool,req.user.userId);const range=monthRange(req.query.month);const rows=(await pool.query("SELECT * FROM business_expenses WHERE data->>'date'>=$1 AND data->>'date'<$2 ORDER BY data->>'date' DESC,id DESC",[range.previous,range.end])).rows;const current=rows.filter(r=>r.data.date>=range.start),previous=rows.filter(r=>r.data.date<range.start);return {rows:current,summary:core.totals(current.map(r=>r.data)),previous:core.totals(previous.map(r=>r.data)),categories:core.CATEGORIES,areas:core.AREAS};}));
 app.get('/api/business/:kind/:id/history',verifyToken,wrap(async req=>{if(!['formula','expense'].includes(req.params.kind))throw core.fail('Tipo inválido.');await actor(pool,req.user.userId,req.params.kind==='formula');return (await pool.query('SELECT actor_name,reason,before_data,after_data,created_at FROM business_audit WHERE entity=$1 AND entity_id=$2 ORDER BY id DESC',[req.params.kind,core.id(req.params.id)])).rows;}));
}
module.exports={init,register,save,actor,monthRange};

'use strict';
const crypto=require('node:crypto');
const core=require('./business-control-core');
const business=require('./business-control');
async function init(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS base_formulations (
    id SERIAL PRIMARY KEY, data JSONB NOT NULL, snapshot JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS formula_id INTEGER REFERENCES base_formulations(id);`);
}
function validate(b){
  if(!Array.isArray(b.lines)||b.lines.some(l=>!l||l.mode!=='inventory'||l.kind!=='material'))throw core.fail('La base debe contener materias primas vinculadas al inventario.');
  const f=core.formula({...b,product_id:1,yield_quantity:b.yield_kg,yield_unit:'kg',sale_price:null});
  const {product_id,yield_quantity,yield_unit,sale_price,...data}=f;
  return data;
}
function calculate(data,inventory){return core.calculate({...data,yield_quantity:data.yield_kg,yield_unit:'kg',sale_price:null},inventory);}
async function inventory(db){return (await db.query("SELECT id,nombre,unidad,tipo,costo_prom FROM inventario WHERE tipo='materia_prima' ORDER BY nombre")).rows;}
async function list(db){const inv=await inventory(db);const rows=(await db.query('SELECT * FROM base_formulations ORDER BY id DESC')).rows;return {inventory:inv,rows:rows.map(r=>({...r,current:calculate(r.data,inv)}))};}
function massCost(product,formulation){
  if(!formulation)return null;
  const g=Number(product.ficha?.peso_masa_g),units=Number(product.ficha?.unidades_presentacion),kgCost=formulation.current.per_kg;
  return {per_kg:kgCost,per_piece:kgCost!=null&&g>0?kgCost*g/1000:null,per_presentation:kgCost!=null&&g>0&&units>0?kgCost*g/1000*units:null};
}
async function save(pool,userId,b){
  const id=b.id==null?null:core.id(b.id),version=id?core.id(b.version):null;
  const data=validate(b.data||{}),reason=core.text(b.reason||'','Motivo del cambio',1000,!!id);
  const key=b.operation_key;
  if(typeof key!=='string'||!/^[\w-]{16,100}$/.test(key))throw core.fail('Identificador de operación inválido.');
  const hash=crypto.createHash('sha256').update(JSON.stringify({entity:'base-formulation',id,version,data,reason})).digest('hex');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');const u=await business.actor(db,userId,true);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    const previous=(await db.query('SELECT * FROM business_operations WHERE operation_key=$1',[key])).rows[0];
    if(previous){if(Number(previous.actor_id)!==Number(u.id)||previous.request_hash!==hash)throw core.fail('Esta operación corresponde a otro cambio.',409);await db.query('COMMIT');return previous.response;}
    let before=null;
    if(id){before=(await db.query('SELECT * FROM base_formulations WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!before)throw core.fail('Formulación no encontrada.',404);if(before.version!==version)throw core.fail('La formulación cambió. Vuelve a abrirla.',409);}
    const inv=await inventory(db);
    for(const l of data.lines){const item=inv.find(i=>Number(i.id)===l.item_id);if(!item)throw core.fail('Una materia prima ya no existe. Revisa las líneas.');core.convert(l.quantity,l.unit,item.unidad);}
    const snapshot=calculate(data,inv);
    const row=(await db.query(id?'UPDATE base_formulations SET data=$1::jsonb,snapshot=$2::jsonb,version=version+1,updated_at=NOW() WHERE id=$3 RETURNING *':'INSERT INTO base_formulations(data,snapshot) VALUES($1::jsonb,$2::jsonb) RETURNING *',id?[JSON.stringify(data),JSON.stringify(snapshot),id]:[JSON.stringify(data),JSON.stringify(snapshot)])).rows[0];
    await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',['base-formulation',row.id,u.id,u.name||u.username,reason||'Registro inicial',JSON.stringify(before),JSON.stringify(row)]);
    await db.query('INSERT INTO business_operations(operation_key,actor_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[key,u.id,hash,JSON.stringify(row)]);
    await db.query('COMMIT');return row;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function register(app,pool,verifyToken){
  const route=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){if(!e.status)console.error('base-formulations:',e);res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar el cambio. Reintenta con el mismo formulario.'});}};
  app.get('/api/base-formulations',verifyToken,route(async req=>{await business.actor(pool,req.user.userId,true);return list(pool);}));
  app.post('/api/base-formulations/save',verifyToken,route(req=>save(pool,req.user.userId,req.body||{})));
  app.post('/api/base-formulations/preview',verifyToken,route(async req=>{await business.actor(pool,req.user.userId,true);return calculate(validate(req.body||{}),await inventory(pool));}));
  app.get('/api/base-formulations/:id/history',verifyToken,route(async req=>{await business.actor(pool,req.user.userId,true);return (await pool.query("SELECT actor_name,reason,after_data,created_at FROM business_audit WHERE entity='base-formulation' AND entity_id=$1 ORDER BY id DESC",[core.id(req.params.id)])).rows;}));
}
module.exports={init,validate,calculate,list,massCost,save,register};

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
  data.lines=data.lines.map((l,i)=>({...l,mix_group:core.text(b.lines[i].mix_group||'','Grupo de promedio',80,false),source_label:core.text(b.lines[i].source_label||'','Referencia del ingrediente',250,false)}));
  if(b.source_key){if(!require('./cost-templates').formulas.some(t=>t.key===b.source_key))throw core.fail('Plantilla desconocida.');data.source_key=b.source_key;}
  return data;
}
function calculate(data,inventory){
 const groups=Object.create(null);for(const l of data.lines)if(l.mix_group)groups[l.mix_group]=(groups[l.mix_group]||0)+1;
 const lines=data.lines.map(l=>({...l,recipe_quantity:l.quantity,average_count:l.mix_group?groups[l.mix_group]:1,quantity:l.quantity/(l.mix_group?groups[l.mix_group]:1)}));
 return core.calculate({...data,lines,yield_quantity:data.yield_kg,yield_unit:'kg',sale_price:null},inventory);
}
async function inventory(db){return (await db.query("SELECT id,nombre,unidad,tipo,costo_prom FROM inventario WHERE tipo='materia_prima' ORDER BY nombre")).rows;}
async function list(db){const inv=await inventory(db);const rows=(await db.query('SELECT * FROM base_formulations ORDER BY id DESC')).rows;return {templates:require('./cost-templates').formulas,inventory:inv,rows:rows.map(r=>({...r,current:calculate(r.data,inv)}))};}
function massCost(product,formulation){
  if(!formulation)return null;
  const g=Number(product.ficha?.peso_masa_g),units=require('./product-components').dimensions(product.ficha||{}).units,kgCost=formulation.current.per_kg;
  const extra=Number(product.ficha?.cost_model?.mass_extra_pct||0),factor=1+extra/100;
  return {per_kg:kgCost,mass_extra_pct:extra,per_piece:kgCost!=null&&g>0?kgCost*g/1000*factor:null,per_presentation:kgCost!=null&&g>0&&units>0?kgCost*g/1000*units*factor:null};
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
    if(before&&(before.data.source_key&&!data.source_key||before.data.lines.some(l=>l.mix_group)&&b.data.lines.some(l=>l.mix_group===undefined)))throw core.fail('Recarga la página para conservar los grupos y la referencia de esta formulación.',409);
    if(data.source_key){
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cost-template:'+data.source_key]);
      const existing=(await db.query("SELECT id FROM base_formulations WHERE data->>'source_key'=$1 AND ($2::integer IS NULL OR id<>$2)",[data.source_key,id])).rows[0];
      if(existing)throw core.fail('Esta plantilla ya está cargada. Abre la formulación existente para editarla.',409);
    }
    const inv=await inventory(db);
    for(const l of data.lines){const item=inv.find(i=>Number(i.id)===l.item_id);if(!item)throw core.fail('Una materia prima ya no existe. Revisa las líneas.');core.convert(l.quantity,l.unit,item.unidad);}
    const snapshot=calculate(data,inv);
    const row=(await db.query(id?'UPDATE base_formulations SET data=$1::jsonb,snapshot=$2::jsonb,version=version+1,updated_at=NOW() WHERE id=$3 RETURNING *':'INSERT INTO base_formulations(data,snapshot) VALUES($1::jsonb,$2::jsonb) RETURNING *',id?[JSON.stringify(data),JSON.stringify(snapshot),id]:[JSON.stringify(data),JSON.stringify(snapshot)])).rows[0];
    await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',['base-formulation',row.id,u.id,u.name||u.username,reason||'Registro inicial',JSON.stringify(before),JSON.stringify(row)]);
    await db.query('INSERT INTO business_operations(operation_key,actor_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[key,u.id,hash,JSON.stringify(row)]);
    await db.query('COMMIT');return row;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
async function remove(pool,userId,b){
  const id=core.id(b.id),version=core.id(b.version),key=b.operation_key;
  if(typeof key!=='string'||!/^[\w-]{16,100}$/.test(key))throw core.fail('Identificador de operación inválido.');
  const hash=crypto.createHash('sha256').update(JSON.stringify({entity:'base-formulation-delete',id,version})).digest('hex');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');const u=await business.actor(db,userId,true);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    const previous=(await db.query('SELECT * FROM business_operations WHERE operation_key=$1',[key])).rows[0];
    if(previous){if(Number(previous.actor_id)!==Number(u.id)||previous.request_hash!==hash)throw core.fail('Esta operación corresponde a otro cambio.',409);await db.query('COMMIT');return previous.response;}
    // Los guardados de productos toman FOR SHARE al vincular una base o componente.
    const before=(await db.query('SELECT * FROM base_formulations WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!before)throw core.fail('La formulación ya no existe. Actualiza la lista.',404);
    if(before.version!==version)throw core.fail('La formulación cambió. Vuelve a abrirla antes de eliminar.',409);
    const linked=(await db.query(`SELECT id,nombre,activo FROM catalogo WHERE formula_id=$1 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ficha->'cost_model'->'items')='array'
      THEN ficha->'cost_model'->'items' ELSE '[]'::jsonb END) AS component
      WHERE component->>'source'='formula' AND component->>'formula_id'=$2
    ) ORDER BY nombre LIMIT 11`,[id,String(id)])).rows;
    if(linked.length)throw core.fail('No se puede eliminar: está vinculada a '+linked.slice(0,10).map(p=>p.nombre+(p.activo===false?' (archivado)':'')).join(', ')+(linked.length>10?' y otros productos':'')+'. Cambia o quita esa formulación en sus fichas primero.',409);
    await db.query('DELETE FROM base_formulations WHERE id=$1',[id]);
    const response={id,deleted:true,name:before.data.name};
    await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',['base-formulation',id,u.id,u.name||u.username,'Eliminar formulación',JSON.stringify(before),JSON.stringify({...before,deleted:true})]);
    await db.query('INSERT INTO business_operations(operation_key,actor_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[key,u.id,hash,JSON.stringify(response)]);
    await db.query('COMMIT');return response;
  }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e.code==='23503')throw core.fail('La formulación está vinculada a un producto. Actualiza sus vínculos primero.',409);throw e;}finally{db.release();}
}
function register(app,pool,verifyToken){
  const route=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store').json(await fn(req));}catch(e){if(!e.status)console.error('base-formulations:',e);res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar el cambio. Reintenta con el mismo formulario.'});}};
  app.get('/api/base-formulations',verifyToken,route(async req=>{await business.actor(pool,req.user.userId,true);return list(pool);}));
  app.post('/api/base-formulations/save',verifyToken,route(req=>save(pool,req.user.userId,req.body||{})));
  app.post('/api/base-formulations/delete',verifyToken,route(req=>remove(pool,req.user.userId,req.body||{})));
  app.post('/api/base-formulations/preview',verifyToken,route(async req=>{await business.actor(pool,req.user.userId,true);return calculate(validate(req.body||{}),await inventory(pool));}));
  app.get('/api/base-formulations/:id/history',verifyToken,route(async req=>{await business.actor(pool,req.user.userId,true);return (await pool.query("SELECT actor_name,reason,after_data,created_at FROM business_audit WHERE entity='base-formulation' AND entity_id=$1 ORDER BY id DESC",[core.id(req.params.id)])).rows;}));
}
module.exports={init,validate,calculate,list,massCost,save,remove,register};

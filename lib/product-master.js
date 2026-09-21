'use strict';
const crypto = require('node:crypto');
const core = require('./business-control-core');
const business = require('./business-control');
const formulations = require('./base-formulations');
const CATEGORIES = ['Caramelo duro', 'Chupete', 'Toffee', 'Caramelo masticable', 'Gomitas', 'Otros'];
async function init(pool) {
  await pool.query(`ALTER TABLE catalogo
    ADD COLUMN IF NOT EXISTS sku VARCHAR(80),
    ADD COLUMN IF NOT EXISTS ficha JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    UPDATE catalogo SET sku='CT-P-'||id::text WHERE sku IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS catalogo_sku_unique ON catalogo(lower(sku));`);
}
function validate(body) {
  const text = (key, max=120) => core.text(body[key] ?? '', key, max, false);
  const positive = key => {
    if (body[key] == null || body[key] === '') return null;
    const value = Number(body[key]);
    if (!['string','number'].includes(typeof body[key]) || !Number.isFinite(value) || value <= 0 || value > 1e7) throw core.fail('Revisa '+key+'. Debe ser un número positivo.');
    return value;
  };
  const ficha = {
    marca:text('marca'), categoria:text('categoria'), familia:text('familia'),
    peso_unitario_g:positive('peso_unitario_g'), peso_masa_g:positive('peso_masa_g'),
    presentacion:text('presentacion'), unidades_presentacion:positive('unidades_presentacion'),
    peso_neto_kg:positive('peso_neto_kg'), notas:text('notas',2000)
  };
  if (ficha.categoria && !CATEGORIES.includes(ficha.categoria)) throw core.fail('Categoría inválida.');
  if (ficha.unidades_presentacion && !Number.isSafeInteger(ficha.unidades_presentacion)) throw core.fail('Las unidades por presentación deben ser enteras.');
  if (ficha.peso_unitario_g && ficha.peso_masa_g > ficha.peso_unitario_g) throw core.fail('El peso de la masa no puede superar el peso de la pieza.');
  const sku=text('sku',80);
  if (sku && !/^[A-Za-z0-9._-]+$/.test(sku)) throw core.fail('El SKU admite letras, números, punto, guion y guion bajo.');
  return {nombre:core.text(body.nombre,'Nombre',255),sku,ficha,peso_bulto:positive('peso_bulto'),formula_id:body.formula_id===undefined?undefined:(body.formula_id==null||body.formula_id===''?null:core.id(body.formula_id))};
}
async function save(pool,userId,body) {
  const action=body.action||'save';
  if (!['save','archive','restore'].includes(action)) throw core.fail('Acción inválida.');
  const id=body.id==null?null:core.id(body.id);
  if (action!=='save' && !id) throw core.fail('Selecciona un producto.');
  const version=id?core.id(body.version):null;
  const key=body.operation_key;
  if (typeof key!=='string' || !/^[\w-]{16,100}$/.test(key)) throw core.fail('Identificador de operación inválido.');
  const data=action==='save'?validate(body.data||{}):null;
  const hash=crypto.createHash('sha256').update(JSON.stringify({entity:'product',action,id,version,data})).digest('hex');
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const user=await business.actor(db,userId,true);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
    const old=(await db.query('SELECT * FROM business_operations WHERE operation_key=$1',[key])).rows[0];
    if (old) {
      if (Number(old.actor_id)!==Number(user.id) || old.request_hash!==hash) throw core.fail('Esta operación ya corresponde a otro cambio.',409);
      await db.query('COMMIT'); return old.response;
    }
    let before=null;
    if (id) {
      before=(await db.query('SELECT * FROM catalogo WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!before) throw core.fail('Producto no encontrado.',404);
      if (before.version!==version) throw core.fail('El producto cambió. Vuelve a abrir su ficha.',409);
    }
    let row;
    if (action==='save') {
      if (/^CT-P-\d+$/i.test(data.sku) && data.sku!==before?.sku) throw core.fail('El prefijo CT-P- está reservado para códigos automáticos. Deja el SKU vacío o utiliza otro código.');
      if (before && !before.activo) throw core.fail('Restaura el producto antes de editarlo.');
      if (before && before.nombre!==data.nombre) throw core.fail('El nombre histórico se conserva para mantener los vínculos con pedidos e inventario.');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['product-name:'+data.nombre.toLowerCase()]);
      const duplicate=(await db.query('SELECT id FROM catalogo WHERE lower(nombre)=lower($1) AND ($2::integer IS NULL OR id<>$2)',[data.nombre,id])).rows[0];
      if (duplicate) throw core.fail('Ese producto ya existe. Si está archivado, restáuralo.',409);
      if(data.formula_id){const linked=(await db.query('SELECT id FROM base_formulations WHERE id=$1 FOR SHARE',[data.formula_id])).rows[0];if(!linked)throw core.fail('La formulación seleccionada no existe. Actualiza la ficha.');}
      if (id) {
        row=(await db.query('UPDATE catalogo SET sku=$1,ficha=$2::jsonb,peso_bulto=$3,version=version+1 WHERE id=$4 RETURNING *',[data.sku||before.sku,JSON.stringify(data.ficha),data.peso_bulto,id])).rows[0];
      } else {
        row=(await db.query('INSERT INTO catalogo(nombre,sku,ficha,peso_bulto) VALUES($1,$2,$3::jsonb,$4) RETURNING *',[data.nombre,data.sku||null,JSON.stringify(data.ficha),data.peso_bulto])).rows[0];
        if (!row.sku) row=(await db.query("UPDATE catalogo SET sku='CT-P-'||id::text WHERE id=$1 RETURNING *",[row.id])).rows[0];
        await db.query("INSERT INTO inventario(tipo,nombre,unidad,stock,minimo) VALUES('producto_terminado',$1,'unidades',0,0) ON CONFLICT(tipo,nombre) DO NOTHING",[row.nombre]);
      }
    } else {
      if (action==='archive') {
        const stock=(await db.query("SELECT stock FROM inventario WHERE tipo='producto_terminado' AND nombre=$1 FOR UPDATE",[before.nombre])).rows;
        if (stock.some(i=>Number(i.stock)!==0)) throw core.fail('El producto tiene existencias. Resuelve su saldo en bodega antes de eliminarlo.',409);
      }
      row=(await db.query('UPDATE catalogo SET activo=$1,version=version+1 WHERE id=$2 RETURNING *',[action==='restore',id])).rows[0];
    }
    if(action==='save'&&data.formula_id!==undefined){row=(await db.query('UPDATE catalogo SET formula_id=$1 WHERE id=$2 RETURNING *',[data.formula_id,row.id])).rows[0];}
    await db.query('INSERT INTO business_audit(entity,entity_id,actor_id,actor_name,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)', ['product',row.id,user.id,user.name||user.username,({save:'Guardar ficha',archive:'Retirar del catálogo activo',restore:'Restaurar producto'})[action],JSON.stringify(before),JSON.stringify(row)]);
    await db.query('INSERT INTO business_operations(operation_key,actor_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[key,user.id,hash,JSON.stringify(row)]);
    await db.query('COMMIT'); return row;
  } catch (e) {
    await db.query('ROLLBACK').catch(()=>{});
    if (e.code==='23505') throw core.fail('El SKU o nombre ya está registrado. Usa otro código.',409);
    throw e;
  } finally { db.release(); }
}
function register(app,pool,verifyToken) {
  const route=fn=>async(req,res)=>{
    try { res.set('Cache-Control','no-store').json(await fn(req)); }
    catch(e) { if(!e.status) console.error('product-master:',e); res.status(e.status||500).json({error:e.status?e.message:'No se pudo confirmar el cambio. Reintenta con el mismo formulario.'}); }
  };
  app.get('/api/product-master',verifyToken,route(async req=>{
    await business.actor(pool,req.user.userId,true);
    const rows=(await pool.query(`SELECT c.*,COALESCE(i.stock,0) AS stock FROM catalogo c
      LEFT JOIN inventario i ON i.tipo='producto_terminado' AND i.nombre=c.nombre ORDER BY c.nombre`)).rows;
    const bases=await formulations.list(pool);
    return {rows:rows.map(p=>{const base=bases.rows.find(f=>f.id===p.formula_id);return {...p,formulation_name:base?.data.name||null,mass_cost:formulations.massCost(p,base)};}),categories:CATEGORIES,formulations:bases.rows};
  }));
  app.post('/api/product-master/save',verifyToken,route(req=>save(pool,req.user.userId,req.body||{})));
  app.get('/api/product-master/:id/history',verifyToken,route(async req=>{
    await business.actor(pool,req.user.userId,true);
    return (await pool.query("SELECT actor_name,reason,after_data,created_at FROM business_audit WHERE entity='product' AND entity_id=$1 ORDER BY id DESC",[core.id(req.params.id)])).rows;
  }));
}
module.exports={init,validate,save,register,CATEGORIES};

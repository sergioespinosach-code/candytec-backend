'use strict';
const Core=require('./planner-core');
const READ_ROLES=new Set(['gerente','facturacion','bodega','jventas','produccion']);
const WRITE_ROLES=new Set(['gerente','facturacion','bodega']);
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,max,field)=>{if(typeof v!=='string'||v.length>max)throw fail('Revisa '+field+'.');return v.trim();};
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw fail('Fecha de salida inválida.');return v;}
function metadata(b){
  const nombre=text(b.nombre,120,'nombre del plan'),fecha_salida=date(b.fecha_salida);
  if(!nombre)throw fail('Escribe un nombre para el plan.');
  const capacidad_kg=Number(b.capacidad_kg||0),costo_estimado=Number(b.costo_estimado||0);
  if(!Number.isFinite(capacidad_kg)||capacidad_kg<0||capacidad_kg>1000000)throw fail('Capacidad en kg inválida.');
  if(!Number.isFinite(costo_estimado)||costo_estimado<0||costo_estimado>10000000)throw fail('Costo estimado inválido.');
  if(!['BORRADOR','PLANIFICADO'].includes(b.estado))throw fail('Estado de planificación inválido.');
  return {nombre,fecha_salida,vehiculo:text(b.vehiculo||'',160,'vehículo'),conductor:text(b.conductor||'',160,'conductor'),capacidad_kg,costo_estimado,observaciones:text(b.observaciones||'',2000,'observaciones'),estado:b.estado};
}
async function init(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_plans (
    id SERIAL PRIMARY KEY, operation_key VARCHAR(100) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL, fecha_salida DATE NOT NULL, vehiculo VARCHAR(160) NOT NULL DEFAULT '',
    conductor VARCHAR(160) NOT NULL DEFAULT '', capacidad_kg NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(capacidad_kg>=0),
    costo_estimado NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(costo_estimado>=0), observaciones TEXT NOT NULL DEFAULT '',
    estado VARCHAR(20) NOT NULL CHECK(estado IN ('BORRADOR','PLANIFICADO','CERRADO','CANCELADO')),
    paradas JSONB NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL, created_by_name TEXT NOT NULL, updated_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE INDEX IF NOT EXISTS dispatch_plans_status_date ON dispatch_plans(estado,fecha_salida);`);
}
async function context(db,lock=false){
  // Same query order everywhere. SHARE locks stop concurrent edits during validation/save.
  const pedidos=await db.query('SELECT * FROM pedidos ORDER BY id'+(lock?' FOR SHARE':''));
  const clientes=await db.query('SELECT * FROM clientes ORDER BY id'+(lock?' FOR SHARE':''));
  const catalogo=await db.query('SELECT * FROM catalogo ORDER BY id'+(lock?' FOR SHARE':''));
  const inventario=await db.query('SELECT * FROM inventario ORDER BY id'+(lock?' FOR SHARE':''));
  const planes=await db.query("SELECT * FROM dispatch_plans WHERE estado IN ('BORRADOR','PLANIFICADO') ORDER BY id");
  return {sources:Core.sources(pedidos.rows,clientes.rows),catalog:catalogo.rows,inventory:inventario.rows,plans:planes.rows};
}
function register(app,pool,verifyToken){
  async function permission(req,res,next){
    try{
      const r=await pool.query('SELECT id, username, name, role FROM users WHERE id=$1',[req.user.userId]);
      const user=r.rows[0];
      if(!user)return res.status(401).json({error:'Sesión no válida.'});
      const allowed=req.method==='GET'?READ_ROLES:WRITE_ROLES;
      if(!allowed.has(user.role))return res.status(403).json({error:'Tu rol no tiene permiso para esta acción del planificador.'});
      req.plannerUser=user;next();
    }catch(e){res.status(500).json({error:'No se pudieron verificar los permisos del planificador.'});}
  }
  const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('Planner:',e.message);res.status(e.code?500:(e.status||400)).json({error:e.code||e.status===500?'No se pudo completar la operación del planificador. Reintenta.':e.message});}};
  const route=(method,path,fn)=>app[method](path,verifyToken,permission,handle(fn));
  route('get','/api/dispatch-planner',async(req,res)=>{
    const db=await pool.connect();
    try{
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const data=await context(db);
      const old=await db.query("SELECT * FROM dispatch_plans WHERE estado IN ('CERRADO','CANCELADO') ORDER BY updated_at DESC LIMIT 50");
      await db.query('COMMIT');
      res.json({...data,plans:[...data.plans,...old.rows],canEdit:WRITE_ROLES.has(req.plannerUser.role),asOf:new Date().toISOString()});
    }catch(e){await db.query('ROLLBACK');throw fail('No se pudo cargar el planificador.',500);}finally{db.release();}
  });
  async function write(req,res,create){
    const b=req.body||{};const db=await pool.connect();
    try{
      await db.query('BEGIN');
      // Serialize all allocation mutations, including cancellation and retry recovery.
      await db.query('SELECT pg_advisory_xact_lock(72190418)');
      if(create){
        if(typeof b.operation_key!=='string'||!/^[-a-zA-Z0-9]{12,100}$/.test(b.operation_key))throw fail('Identificador de operación inválido.');
        const prev=await db.query('SELECT * FROM dispatch_plans WHERE operation_key=$1',[b.operation_key]);
        if(prev.rows.length){
          if(prev.rows[0].created_by!==req.plannerUser.id)throw fail('Identificador de operación en uso.',409);
          await db.query('COMMIT');res.json(prev.rows[0]);return;
        }
      }
      let current;
      if(!create){
        const r=await db.query('SELECT * FROM dispatch_plans WHERE id=$1 FOR UPDATE',[req.params.id]);
        current=r.rows[0];
        if(!current)throw fail('Plan no encontrado.',404);
        if(!Core.active(current))throw fail('El plan ya está cerrado o cancelado.',409);
        if(!Number.isInteger(b.version)||b.version!==current.version)throw fail('Otra persona modificó este plan. Actualiza los datos y vuelve a abrirlo desde la lista.',409);
      }
      const meta=metadata(b),data=await context(db,true);
      const paradas=Core.validateStops(b.paradas,data.sources,data.plans,current?.id);
      const summary=Core.summarize(paradas,data.catalog,data.inventory,data.plans,current?.id,data.sources);
      if(meta.estado==='PLANIFICADO'){
        if(!meta.vehiculo||!meta.conductor||meta.capacidad_kg<=0)throw fail('Para confirmar, completa vehículo, conductor y capacidad en kg.');
        if(summary.missingWeights.length)throw fail('Completa el peso por bulto en el catálogo: '+summary.missingWeights.join(', ')+'.');
        if(summary.knownKg>meta.capacidad_kg+0.005)throw fail('La carga supera la capacidad. Ajusta cantidades o vehículo.');
      }
      const values=[meta.nombre,meta.fecha_salida,meta.vehiculo,meta.conductor,meta.capacidad_kg,meta.costo_estimado,meta.observaciones,meta.estado,JSON.stringify(paradas),req.plannerUser.name||req.plannerUser.username];
      let r;
      if(create)r=await db.query(`INSERT INTO dispatch_plans(nombre,fecha_salida,vehiculo,conductor,capacidad_kg,costo_estimado,observaciones,estado,paradas,updated_by_name,created_by_name,created_by,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12) RETURNING *`,[...values,req.plannerUser.id,b.operation_key]);
      else r=await db.query(`UPDATE dispatch_plans SET nombre=$1,fecha_salida=$2,vehiculo=$3,conductor=$4,capacidad_kg=$5,costo_estimado=$6,observaciones=$7,estado=$8,paradas=$9,updated_by_name=$10,version=version+1,updated_at=NOW() WHERE id=$11 RETURNING *`,[...values,current.id]);
      await db.query('COMMIT');res.status(create?201:200).json(r.rows[0]);
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  }
  route('post','/api/dispatch-plans',(req,res)=>write(req,res,true));
  route('put','/api/dispatch-plans/:id',(req,res)=>write(req,res,false));
  route('post','/api/dispatch-plans/:id/status',async(req,res)=>{
    if(!['CERRADO','CANCELADO'].includes(req.body.estado))throw fail('Acción inválida.');
    const db=await pool.connect();
    try{
      await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(72190418)');
      const r=await db.query('SELECT * FROM dispatch_plans WHERE id=$1 FOR UPDATE',[req.params.id]),p=r.rows[0];
      if(!p)throw fail('Plan no encontrado.',404);
      if(p.version!==req.body.version)throw fail('Otra persona modificó este plan. Actualiza los datos y vuelve a abrirlo desde la lista.',409);
      if(!Core.active(p))throw fail('Este plan ya fue archivado.',409);
      const saved=await db.query('UPDATE dispatch_plans SET estado=$1,version=version+1,updated_at=NOW(),updated_by_name=$2 WHERE id=$3 RETURNING *',[req.body.estado,req.plannerUser.name||req.plannerUser.username,p.id]);
      await db.query('COMMIT');res.json(saved.rows[0]);
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  });
}
module.exports={init,register,metadata,context};

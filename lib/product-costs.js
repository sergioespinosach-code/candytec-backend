'use strict';
const business=require('./business-control');
const formulations=require('./base-formulations');
const extraLabels={empaques:'Empaques',componentes:'Otros componentes (palito, polvo, relleno)',proceso:'Proceso adicional del SKU'};
const round=n=>Math.round((n+Number.EPSILON)*1e6)/1e6;
function calculate(product,base){
 const f=product.ficha||{},missing=[],rows=[];
 const units=Number(f.unidades_presentacion),grams=Number(f.peso_masa_g),net=Number(f.peso_neto_kg);
 const scale=base&&Number(base.data.yield_kg)>0&&units>0&&grams>0?grams*units/1000/Number(base.data.yield_kg):null;
 if(!base)missing.push('Seleccionar una formulación base en Mis productos.');
 if(!(grams>0))missing.push('Completar el peso de masa por pieza.');
 if(!(units>0))missing.push('Completar las unidades por presentación.');
 if(!f.presentacion)missing.push('Indicar la presentación de venta.');
 if(net>0&&grams>0&&units>0&&grams*units/1000>net+.000001)missing.push('Revisar los pesos: la masa por presentación supera su peso neto.');
 if(base){
  for(const l of base.current.lines){
   if(l.reason)missing.push(l.name+': '+l.reason);
   rows.push({group:'Materias primas de la base',name:l.name,quantity:scale==null||l.inventory_quantity==null?null:round(l.inventory_quantity*scale),unit:l.source_unit,unit_cost:l.unit_cost,amount:scale==null||l.total==null?null:round(l.total*scale)});
  }
  rows.push({group:'Fabricación de la base',name:'Mano de obra de la base',amount:scale==null?null:round(base.data.labor*scale)});
  rows.push({group:'Fabricación de la base',name:'Otros costos de la base',amount:scale==null?null:round(base.data.overhead*scale)});
 }
 for(const [key,label] of Object.entries(extraLabels)){
  const value=f.costos_adicionales?.[key];
  const known=value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0;
  if(!known)missing.push('Completar '+label.toLowerCase()+' por presentación (0 si no aplica).');
  rows.push({group:'Adicionales del producto',name:label,amount:known?Number(value):null});
 }
 const known=round(rows.reduce((sum,r)=>sum+(r.amount??0),0));
 const complete=missing.length===0&&rows.every(r=>r.amount!==null);
 const total=complete?known:null;
 const mass=base?.current.per_kg!=null&&grams>0&&units>0?round(base.current.per_kg*grams*units/1000):null;
 return {id:product.id,sku:product.sku,name:product.nombre,brand:f.marca||'',category:f.categoria||'',presentation:f.presentacion||'',units:units>0?units:null,mass_g:grams>0?grams:null,net_kg:net>0?net:null,formula_id:base?.id||null,formula_name:base?.data.name||null,formula_version:base?.version||null,yield_kg:base?.data.yield_kg||null,base_per_kg:base?.current.per_kg??null,mass_per_presentation:mass,rows,missing,complete,known,total,per_piece:complete&&units>0?round(total/units):null,per_kg:complete&&net>0?round(total/net):null};
}
async function report(pool,userId){
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await business.actor(db,userId,true);
  const products=(await db.query('SELECT * FROM catalogo WHERE activo=TRUE ORDER BY nombre')).rows;
  const bases=await formulations.list(db);
  const rows=products.map(p=>calculate(p,bases.rows.find(b=>b.id===p.formula_id)));
  await db.query('COMMIT');return {at:new Date().toISOString(),rows};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
function register(app,pool,verifyToken){app.get('/api/product-costs',verifyToken,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await report(pool,req.user.userId));}catch(e){if(!e.status)console.error('product-costs:',e);res.status(e.status||500).json({error:e.status?e.message:'No se pudieron consultar los costos. Intenta actualizar.'});}});}
module.exports={calculate,report,register,extraLabels};

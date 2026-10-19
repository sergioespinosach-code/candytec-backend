'use strict';
const core=require('./business-control-core');
const choices=(v,values,label)=>{if(!values.includes(v))throw core.fail(label+' inválido.');return v;};
const number=(v,label,min=0)=>{if(v==null||v===''||!['number','string'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>1e9)throw core.fail(label+' inválido.');return Number(v);};
function validate(value){
 if(value===undefined)return undefined;
 if(!value||value.version!==2)throw core.fail('Modelo de costos inválido.');
 if(!Array.isArray(value.items)||value.items.length>50)throw core.fail('El producto admite hasta 50 componentes.');
 const pct=v=>{const n=number(v,'Consumo adicional');if(n>100)throw core.fail('El consumo adicional admite de 0 a 100 %.');return n;};
 return {version:2,basis:choices(value.basis,['pieces','weight'],'Base de cálculo'),mass_extra_pct:pct(value.mass_extra_pct),items:value.items.map(l=>{
  if(!l||typeof l!=='object')throw core.fail('Componente inválido.');
  const source=choices(l.source,['inventory','formula'],'Origen'),method=choices(l.method,['yield','piece','presentation'],'Consumo');
  if(source==='formula'&&method==='yield')throw core.fail('Una formulación se consume en gramos o kg.');
  return {source,method,...(source==='formula'?{formula_id:core.id(l.formula_id)}:{item_id:core.id(l.item_id)}),quantity:number(l.quantity,'Cantidad o rendimiento',.000001),unit:method==='yield'?'kg':core.text(l.unit,'Unidad',40),extra_pct:pct(l.extra_pct),source_label:core.text(l.source_label||'','Referencia',250,false)};
 })};
}
function dimensions(f){
 const estimated=f.cost_model?.basis==='weight';
 const net=Number(f.peso_neto_kg),piece=Number(f.peso_unitario_g);
 return {units:estimated?(net>0&&piece>0?net*1000/piece:null):Number(f.unidades_presentacion)||null,estimated};
}
function calculateItem(l,units,inventory,formulas){
 const formula=l.source==='formula'?formulas.find(f=>Number(f.id)===Number(l.formula_id)):null;
 const material=l.source==='inventory'?inventory.find(i=>Number(i.id)===Number(l.item_id)):null;
 const name=formula?.data.name||material?.nombre||l.source_label||'Componente sin vincular';
 let unit=l.source==='formula'?'kg':material?.unidad,price=l.source==='formula'?formula?.current.per_kg:material?.costo_prom,quantity=null,reason=null;
 try{
  if(l.source==='formula'&&!formula)throw Error('La formulación no está disponible.');
  if(l.source==='inventory'&&(!material||material.tipo!=='materia_prima'))throw Error('El material no está disponible.');
  if(price==null||!Number.isFinite(Number(price))||!(Number(price)>0))throw Error('Falta un costo promedio o una formulación completa.');
  if(!Number.isFinite(l.quantity)||l.quantity<=0)throw Error('Falta la cantidad o rendimiento.');
  if(l.method!=='presentation'&&!(units>0))throw Error('Falta el peso de pieza o las unidades de la presentación.');
  const raw=l.method==='yield'?units/l.quantity:l.quantity*(l.method==='piece'?units:1);
  quantity=core.convert(raw*(1+l.extra_pct/100),l.method==='yield'?'kg':l.unit,unit);
 }catch(e){reason=e.message;}
 const amount=reason?null:quantity*Number(price);
 return {group:l.source==='formula'?'Formulaciones adicionales':'Empaques y componentes',name,quantity:reason?null:quantity,unit:unit||l.unit,unit_cost:price==null?null:Number(price),amount,reason,extra_pct:l.extra_pct,method:l.method,reference_quantity:l.quantity,reference_unit:l.unit};
}
module.exports={validate,dimensions,calculateItem};

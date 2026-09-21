'use strict';
const core=require('./business-control-core');
function validate(value){
 if(value===undefined)return undefined;
 if(value===null)return null;
 const item_id=core.id(value.item_id),yieldValue=value.unidades_por_kg;
 const unidades_por_kg=Number(yieldValue);
 if(!['number','string'].includes(typeof yieldValue)||!Number.isFinite(unidades_por_kg)||unidades_por_kg<=0||unidades_por_kg>1e9)throw core.fail('El rendimiento debe ser mayor que cero: piezas envueltas por kg de lámina.');
 return {item_id,unidades_por_kg};
}
function kgFactor(item){
 if(!item||item.tipo!=='materia_prima')throw core.fail('Selecciona una lámina registrada en materias primas.');
 return core.convert(1,'kg',item.unidad);
}
function priceKg(item){
 const factor=kgFactor(item),price=Number(item.costo_prom);
 return Number.isFinite(price)&&price>0?price*factor:null;
}
function choices(inventory){return inventory.flatMap(item=>{try{return [{...item,costo_kg:priceKg(item)}];}catch(e){return [];}});}
function calculate(config,units,inventory){
 if(!config)return null;
 const item=inventory.find(i=>Number(i.id)===Number(config.item_id));
 let price=null,reason=null;
 try{price=priceKg(item);if(price===null)reason='La lámina no tiene costo promedio válido.';}catch(e){reason=item?'La unidad de la lámina no es compatible con kg.':'La lámina ya no existe en el inventario.';}
 const yieldQty=Number(config.unidades_por_kg);
 if(!Number.isFinite(yieldQty)||yieldQty<=0)reason='Falta el rendimiento de la lámina en piezas por kg.';
 const quantity=Number(units)>0&&yieldQty>0?Number(units)/yieldQty:null;
 const per_piece=!reason?price/yieldQty:null;
 return {name:item?.nombre||config.nombre||'Lámina no disponible',item_id:config.item_id,unidades_por_kg:yieldQty,unit:'kg',unit_cost:price,quantity,per_piece,amount:per_piece!==null&&Number(units)>0?per_piece*Number(units):null,reason};
}
module.exports={validate,priceKg,choices,calculate};

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {recalculate,edit,price}=require('../lib/inventory-edit');
const item={id:1,tipo:'materia_prima',unidad:'kg',stock:200,costo_prom:4.5};
const rows=[{id:1,item_id:1,tipo:'ingreso',cantidad:100,operation_payload:{precio:4},edit_version:0},{id:2,item_id:1,tipo:'salida',cantidad:100},{id:3,item_id:1,tipo:'ingreso',cantidad:100,precio:6}];
const next={tipo:'ingreso',cantidad:100,precio:6,motivo:'Precio corregido',operation_key:'edit-test-00000001',version:0};
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.000001,`${a} != ${b}`);
function fixture({role='bodega',breakAudit=false}={}){
 let state={item:structuredClone(item),rows:structuredClone(rows),audits:[]},saved;
 const client={release(){},async query(sql,p=[]){
  if(sql==='BEGIN'){saved=structuredClone(state);return {rows:[]};}
  if(sql==='ROLLBACK'){state=saved;return {rows:[]};}
  if(sql==='COMMIT'||sql.startsWith('SELECT pg_advisory'))return {rows:[]};
  if(sql.startsWith('SELECT id, role'))return {rows:[{id:9,role}]};
  if(sql.startsWith('SELECT * FROM inventory_movement_edits'))return {rows:state.audits.filter(a=>a.operation_key===p[0])};
  if(sql.startsWith('SELECT * FROM inventario'))return {rows:[structuredClone(state.item)]};
  if(sql.startsWith('SELECT * FROM movimientos WHERE id='))return {rows:state.rows.filter(r=>r.id===Number(p[0])).map(r=>structuredClone(r))};
  if(sql.startsWith('SELECT * FROM movimientos WHERE item_id='))return {rows:state.rows.filter(r=>r.item_id===Number(p[0])).map(r=>structuredClone(r))};
  if(sql.startsWith('UPDATE inventario SET')){state.item.stock=p[0];state.item.costo_prom=p[1];state.item.cost_basis=JSON.parse(p[3]);return {rows:[structuredClone(state.item)]};}
  if(sql.startsWith('UPDATE movimientos SET tipo=')){const m=state.rows.find(r=>r.id===Number(p[4]));Object.assign(m,{tipo:p[0],cantidad:p[1],motivo:p[2],precio:p[3],edit_version:(m.edit_version||0)+1});return {rows:[structuredClone(m)]};}
  if(sql.startsWith('UPDATE movimientos SET cost_before=')){for(const m of state.rows)if(m.id>p[1])m.cost_before=null;return {rows:[]};}
  if(sql.startsWith('INSERT INTO inventory_movement_edits')){if(breakAudit)throw Error('audit unavailable');state.audits.push({operation_key:p[2],payload:JSON.parse(p[3]),before:JSON.parse(p[4]),after:JSON.parse(p[5])});return {rows:[]};}
  throw Error('Unexpected SQL '+sql);
 }};
 return {pool:{connect:async()=>client},state:()=>state};
}
test('guarda precio, stock, promedio y auditoría; reintentar no aplica dos veces',async()=>{
 const f=fixture(),a=await edit(f.pool,9,1,next);assert.equal(a.actual.precio,6);near(a.inventario.costo_prom,6);
 const b=await edit(f.pool,9,1,next);assert.equal(b.repetido,true);near(b.inventario.costo_prom,6);assert.equal(f.state().audits.length,1);assert.equal(f.state().audits[0].before.movimiento.operation_payload.precio,4);
});
test('un error al auditar revierte también precio, cantidad y saldo',async()=>{
 const f=fixture({breakAudit:true});await assert.rejects(edit(f.pool,9,1,next),/audit unavailable/);assert.deepEqual(f.state().item,item);assert.deepEqual(f.state().rows,rows);
});
test('rechaza permisos, ediciones simultáneas y reutilización de clave con otros datos',async()=>{
 const denied=fixture({role:'vendedor'});await assert.rejects(edit(denied.pool,9,1,next),e=>e.status===403);
 const f=fixture();await edit(f.pool,9,1,next);
 await assert.rejects(edit(f.pool,9,1,{...next,operation_key:'edit-other-00000001'}),e=>e.status===409);
 await assert.rejects(edit(f.pool,9,1,{...next,precio:10}),e=>e.status===409);
});
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
test('el precio sobrevive a recargar, incluyendo los ingresos previos al parche',()=>{
 const c=vm.createContext({fmtDateTimeDB:x=>x});vm.runInContext(html.slice(html.indexOf('function mapMovimiento('),html.indexOf('/* guarda en el servidor los campos vigentes')),c);
 assert.equal(c.mapMovimiento({operation_payload:{precio:4}}).precio,4);assert.equal(c.mapMovimiento({precio:'6.123456',edit_version:1}).precio,6.123456);
});
test('el editor reintenta la misma corrección y solo actualiza la vista tras confirmación',async()=>{
 const nodes={em_tipo:{value:'ingreso'},em_cantidad:{value:'100'},em_motivo:{value:'Corrección'},em_precio:{value:'6'},em_save_button:{},em_status:{}};
 const c=vm.createContext({document:{getElementById:k=>nodes[k]},MOVIMIENTOS:[{id:1,itemId:1,editVersion:0}],INVENTARIO:[{id:1,tipo:'materia_prima',stock:200,unidad:'kg'}],puedeInventario:()=>true,crypto:{randomUUID:()=>next.operation_key},mapMovimiento:r=>({id:r.id,precio:r.precio}),mapInventario:r=>r,toast(){},closeModal(){},renderView(){},buildNav(){}});
 vm.runInContext('let movementEditState={busy:false,pending:null};let inventoryWriteVersion=0;'+html.slice(html.indexOf('function editMovementPriceVisibility()'),html.indexOf('/* ============================================================\n   CLIENTES')),c);
 let request;c.apiPut=async(url,body)=>{request=JSON.stringify(body);throw Error('Sin conexión');};
 await c.confirmEditarMovimiento(1);assert.equal(c.MOVIMIENTOS[0].precio,undefined);assert.equal(nodes.em_precio.disabled,true);
 c.apiPut=async(url,body)=>{assert.equal(JSON.stringify(body),request);return {actual:{id:1,precio:6},inventario:{id:1,stock:200,costoProm:5}}};
 await c.confirmEditarMovimiento(1);assert.equal(c.MOVIMIENTOS[0].precio,6);assert.equal(c.INVENTARIO[0].costoProm,5);
});

const average=require('../lib/purchase-average');
test('25000 kg a 0.66 corrige el costo aunque exista stock inicial sin valoración y un promedio incorrecto',()=>{
 const history=[{id:1,tipo:'ingreso',cantidad:25000,operation_payload:{precio:66}},{id:2,tipo:'consumo',cantidad:1000}];
 const r=recalculate({...item,stock:27000,costo_prom:0.01},history,{...next,cantidad:25000,precio:0.66});
 near(r.cost,0.66);assert.equal(r.stock,27000);assert.equal(r.basis.total,16500);
});
test('incluye ingresos anteriores y posteriores al corregido y pondera por cantidades',()=>{
 const history=[{id:1,tipo:'ingreso',cantidad:1000,precio:0.5},{id:2,tipo:'ingreso',cantidad:25000,precio:66},{id:3,tipo:'salida',cantidad:3000},{id:4,tipo:'ingreso',cantidad:4000,precio:0.9}];
 const r=recalculate({...item,stock:27000},history,{...next,cantidad:25000,precio:0.66},2);
 near(r.cost,20600/30000);assert.equal(r.stock,27000);
});
test('precio anterior ausente y fotografías viejas no bloquean corregir precio',()=>{
 const r=recalculate({...item,costo_prom:0.01},[{...rows[0],operation_payload:null,cost_before:{stock:9999,cost:999}},...rows.slice(1)],{...next,precio:0.66});
 near(r.cost,3.33);assert.equal(r.stock,200);
});
test('salidas y consumos no cambian el promedio de ingresos aunque se agote el stock',()=>{
 const history=[{id:1,tipo:'ingreso',cantidad:100,precio:4},{id:2,tipo:'salida',cantidad:100},{id:3,tipo:'ingreso',cantidad:50,precio:8}];
 near(recalculate({...item,stock:50},history,next).cost,1000/150);
});
test('ingresos sin precio quedan fuera del numerador y denominador y se identifican',()=>{
 const result=average.calculate([{tipo:'ingreso',cantidad:100,precio:2},{tipo:'ingreso',cantidad:1000},{tipo:'salida',cantidad:40}]);
 near(result.cost,2);assert.equal(result.basis.quantity,100);assert.equal(result.basis.unpriced_count,1);
 assert.equal(average.calculate([{tipo:'ingreso',cantidad:100}]).cost,null);
});
test('precio corregido prevalece sobre payload original y un precio eliminado no reaparece',()=>{
 assert.equal(price({precio:0.66,operation_payload:{precio:66}}),0.66);
 assert.equal(price({precio:null,edit_version:1,operation_payload:{precio:66}}),null);
});
test('cambiar cantidad recalcula ponderación y saldo; cantidades con saldo negativo se rechazan',()=>{
 const r=recalculate(item,rows,{...next,cantidad:50,precio:4});assert.equal(r.stock,150);near(r.cost,800/150);
 assert.throws(()=>recalculate(item,rows,{...next,cantidad:1,tipo:'salida',precio:null}),/negativo/);
});
test('producto terminado conserva su costo y solo corrige el saldo',()=>{
 const r=recalculate({...item,tipo:'producto_terminado'},rows,{...next,cantidad:50});assert.equal(r.stock,150);assert.equal(r.cost,4.5);
});
test('guardar la corrección funciona con stock inicial desconocido y conserva el registro anterior',async()=>{
 const f=fixture();f.state().item.stock=27000;f.state().item.costo_prom=0.01;
 f.state().rows=[{id:1,item_id:1,tipo:'ingreso',cantidad:25000,operation_payload:{precio:66},edit_version:0},{id:2,item_id:1,tipo:'consumo',cantidad:1000}];
 const r=await edit(f.pool,9,1,{...next,cantidad:25000,precio:0.66});near(r.inventario.costo_prom,0.66);assert.equal(r.inventario.stock,27000);
 assert.equal(r.inventario.cost_basis.method,'purchase_weighted');near(f.state().audits[0].before.inventario.costo_prom,0.01);
});
test('volver a corregir sustituye el precio y no duplica el ingreso',async()=>{
 const f=fixture();await edit(f.pool,9,1,next);
 const r=await edit(f.pool,9,1,{...next,version:1,precio:2,operation_key:'edit-second-000001'});
 near(r.inventario.costo_prom,4);assert.equal(f.state().rows.length,3);
});
test('un nuevo ingreso conserva la regla del promedio ponderado elegida al corregir',async()=>{
 const {record}=require('../lib/inventory-movement');let updated;
 const inv={...item,stock:20,costo_prom:2,cost_basis:{method:'purchase_weighted'}};
 const client={release(){},async query(sql,p=[]){
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory'))return {rows:[]};
   if(sql.startsWith('SELECT id, name'))return {rows:[{id:9,role:'bodega',name:'Bodega'}]};
   if(sql.startsWith('SELECT * FROM movimientos WHERE operation_key'))return {rows:[]};
   if(sql.startsWith('SELECT * FROM inventario'))return {rows:[inv]};
   if(sql.startsWith('SELECT * FROM movimientos WHERE item_id'))return {rows:[{tipo:'ingreso',cantidad:100,precio:2},{tipo:'salida',cantidad:80}]};
   if(sql.startsWith('UPDATE inventario')){updated={...inv,stock:p[0],costo_prom:p[1],cost_basis:JSON.parse(p[3])};return {rows:[updated]};}
   if(sql.startsWith('INSERT INTO movimientos'))return {rows:[{id:3,precio:p[7]}]};
   throw Error(sql);
 }};
 await record({connect:async()=>client},9,1,{...next,cantidad:100,precio:4});
 near(updated.costo_prom,3);assert.equal(updated.stock,120);assert.equal(updated.cost_basis.quantity,200);
});

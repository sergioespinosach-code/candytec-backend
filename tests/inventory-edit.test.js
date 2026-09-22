'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {recalculate,edit,price}=require('../lib/inventory-edit');
const item={id:1,tipo:'materia_prima',unidad:'kg',stock:200,costo_prom:4.5};
const rows=[{id:1,item_id:1,tipo:'ingreso',cantidad:100,operation_payload:{precio:4},edit_version:0},{id:2,item_id:1,tipo:'salida',cantidad:100},{id:3,item_id:1,tipo:'ingreso',cantidad:100,precio:6}];
const next={tipo:'ingreso',cantidad:100,precio:6,motivo:'Precio corregido',operation_key:'edit-test-00000001',version:0};
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.000001,`${a} != ${b}`);
test('corregir un precio histórico pondera la salida y la compra posteriores',()=>{const r=recalculate(item,rows,next);assert.equal(r.stock,200);near(r.cost,5);});
test('corregir cantidad y precio reconstruye el promedio desde el saldo anterior',()=>{const r=recalculate(item,rows,{...next,cantidad:50,precio:4});assert.equal(r.stock,150);near(r.cost,44/9);});
test('el stock agotado no transfiere el cambio de precio a una nueva compra',()=>{
 const rs=[{...rows[0],cantidad:100},{...rows[1],cantidad:100},{...rows[2],cantidad:50,precio:8}];
 near(recalculate({...item,stock:50,costo_prom:8},rs,next).cost,8);
});
test('un ingreso con saldo inicial cero permite corregir cantidades sin inventar un costo inicial',()=>{
 const r=recalculate({...item,stock:100,costo_prom:4},[rows[0]],{...next,cantidad:50});assert.equal(r.stock,50);assert.equal(r.cost,6);
});
test('rechaza saldos negativos en un consumo posterior aunque el saldo final alcance',()=>{
 assert.throws(()=>recalculate(item,rows,{...next,cantidad:1,tipo:'salida',precio:null}),/negativo/);
});
test('la corrección sin precio histórico o con saldos externos inconsistentes no inventa costos',()=>{
 assert.throws(()=>recalculate(item,[{...rows[0],operation_payload:null},...rows.slice(1)],next),/precio original/);
 assert.throws(()=>recalculate(item,[{...rows[0],cost_before:{stock:1,cost:2}},...rows.slice(1)],next),/fuera del historial/);
});
test('una edición que eliminó el precio no recupera el valor original del payload',()=>assert.equal(price({precio:null,edit_version:1,operation_payload:{precio:4}}),null));
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
  if(sql.startsWith('SELECT * FROM movimientos WHERE item_id='))return {rows:state.rows.filter(r=>r.id>=Number(p[1])).map(r=>structuredClone(r))};
  if(sql.startsWith('UPDATE inventario SET')){state.item.stock=p[0];state.item.costo_prom=p[1];return {rows:[structuredClone(state.item)]};}
  if(sql.startsWith('UPDATE movimientos SET tipo=')){const m=state.rows.find(r=>r.id===Number(p[4]));Object.assign(m,{tipo:p[0],cantidad:p[1],motivo:p[2],precio:p[3],edit_version:(m.edit_version||0)+1});return {rows:[structuredClone(m)]};}
  if(sql.startsWith('UPDATE movimientos SET cost_before=')){for(const m of state.rows)if(m.id>p[1])m.cost_before=null;return {rows:[]};}
  if(sql.startsWith('INSERT INTO inventory_movement_edits')){if(breakAudit)throw Error('audit unavailable');state.audits.push({operation_key:p[2],payload:JSON.parse(p[3]),before:JSON.parse(p[4]),after:JSON.parse(p[5])});return {rows:[]};}
  throw Error('Unexpected SQL '+sql);
 }};
 return {pool:{connect:async()=>client},state:()=>state};
}
test('guarda precio, stock, promedio y auditoría; reintentar no aplica dos veces',async()=>{
 const f=fixture(),a=await edit(f.pool,9,1,next);assert.equal(a.actual.precio,6);near(a.inventario.costo_prom,5);
 const b=await edit(f.pool,9,1,next);assert.equal(b.repetido,true);near(b.inventario.costo_prom,5);assert.equal(f.state().audits.length,1);assert.equal(f.state().audits[0].before.movimiento.operation_payload.precio,4);
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

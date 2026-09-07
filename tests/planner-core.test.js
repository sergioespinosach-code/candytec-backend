'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/planner-core');
const order=(over={})=>({numero_pedido:'CT-DEMO',cliente:'Cliente demo',ruc:'001',ciudad:'Quito',direccion_entrega:'Bodega central',fecha_entrega:'2026-09-09',estado:'POR_FACTURAR',products:[{name:'Yum',qty:10},{name:'Yum',qty:5},{name:'Cream',qty:3}],entregas:[],...over});
const all=()=>C.sources([order()],[]);
const select=(src,qty=5)=>({...src,items:[{name:'Yum',qty}]});
test('suma duplicados, resta facturas y no suma pedidos entregados como pendientes',()=>{
 const s=C.sources([order({entregas:[{numeroFactura:'F1',estado:'POR_DESPACHAR',items:[{name:'Yum',qty:4}]}]})],[]);
 assert.equal(s.find(x=>x.kind==='pendiente').items.find(i=>i.name==='Yum').qty,11);
 assert.equal(s.find(x=>x.kind==='entrega').items[0].qty,4);
 assert.equal(C.sources([order({estado:'ENTREGADO'})],[]).filter(C.selectable).length,0);
});
test('fecha DATE de PostgreSQL conserva el día de calendario',()=>{assert.equal(C.sources([order({fecha_entrega:new Date(2026,8,9)})],[])[0].dueDate,'2026-09-09');});
test('cada plan consume cantidades y editar excluye las propias asignaciones',()=>{
 const sources=all(),p={id:1,estado:'BORRADOR',paradas:[select(sources[0],10)]};
 assert.equal(C.candidates(sources,[p])[0].items.find(i=>i.name==='Yum').available,5);
 assert.equal(C.candidates(sources,[p],1)[0].items.find(i=>i.name==='Yum').available,15);
 assert.throws(()=>C.validateStops([select(sources[0],6)],sources,[p]),/5 disponibles/);
 assert.equal(C.validateStops([select(sources[0],5)],sources,[p])[0].items[0].qty,5);
});
test('facturación posterior exige revisar el plan anterior antes de reasignar',()=>{
 const before=all(),p={id:1,estado:'PLANIFICADO',paradas:[select(before[0],15)]};
 const after=C.sources([order({estado:'POR_ENTREGAR',entregas:[{numeroFactura:'F2',estado:'POR_DESPACHAR',items:[{name:'Yum',qty:15},{name:'Cream',qty:3}]}]})],[]);
 const target=C.candidates(after,[p])[0];assert.match(target.blocked,/plan #1/);
 assert.throws(()=>C.validateStops([{...target,items:target.items}],after,[p]),/Actualizar/);
 assert.equal(C.candidates(after,[p],1)[0].blocked,'');
});
test('una entrega facturada no se puede fraccionar desde planificación',()=>{
 const s=C.sources([order({estado:'POR_ENTREGAR',entregas:[{numeroFactura:'F1',estado:'POR_DESPACHAR',items:[{name:'Yum',qty:4}]}]})],[]);
 const e=s.find(x=>x.kind==='entrega');assert.throws(()=>C.validateStops([select(e,2)],s,[]),/completa/);
 assert.equal(C.validateStops([select(e,4)],s,[])[0].items[0].qty,4);
});
test('cantidades inválidas, repetidas y correcciones pendientes son rechazadas',()=>{
 const s=all();for(const v of [-1,0,NaN,Infinity,1.001])assert.throws(()=>C.validateStops([select(s[0],v)],s,[]));
 assert.throws(()=>C.validateStops([select(s[0]),select(s[0])],s,[]),/repetida/);
 assert.throws(()=>C.validateStops([{...s[0],items:[{name:'Yum',qty:1},{name:'Yum',qty:1}]}],s,[]),/repetido/);
 const ret=C.sources([order({history:[{devuelto:true}]})],[]);assert.throws(()=>C.validateStops([select(ret[0])],ret,[]),/corrección/);
});
test('consolida demanda, peso conocido y faltantes después de otros planes',()=>{
 const s=all(),p={id:1,estado:'BORRADOR',paradas:[select(s[0],5)]};
 const result=C.summarize([{...s[0],items:[{name:'Yum',qty:10},{name:'Cream',qty:3}]}],[{nombre:'Yum',peso_bulto:10}],[{nombre:'Yum',tipo:'producto_terminado',stock:12}],[p],null,s);
 assert.equal(result.knownKg,100);assert.deepEqual(result.missingWeights,['Cream']);
 assert.equal(result.rows.find(r=>r.name==='Yum').shortage,3);
});
test('cancelar libera asignaciones y las salidas ya realizadas no consumen stock proyectado',()=>{
 const s=all(),p={id:1,estado:'CANCELADO',paradas:[select(s[0],15)]};assert.equal(C.candidates(s,[p])[0].items.find(i=>i.name==='Yum').available,15);
 const delivered=C.sources([order({estado:'EN_TRANSITO',entregas:[{numeroFactura:'F1',estado:'EN_TRANSITO',items:[{name:'Yum',qty:4}]}]})],[]);
 const e=delivered.find(x=>x.kind==='entrega');assert.equal(C.issues({paradas:[e]},delivered)[0].status,'EN_TRANSITO');
 const summary=C.summarize([select(s[0])],[],[],[{id:2,estado:'PLANIFICADO',paradas:[e]}],null,delivered);assert.equal(summary.rows[0].elsewhere,0);
});
test('el snapshot usa cliente y dirección actuales del servidor',()=>{
 const s=all(),input={...select(s[0]),client:'Manipulado',address:'Otro destino'};
 const result=C.validateStops([input],s,[])[0];assert.equal(result.client,'Cliente demo');assert.equal(result.address,'Bodega central');
});
test('reglas compartidas del navegador coinciden con las del servidor',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
 const core=fs.readFileSync(path.join(__dirname,'../lib/planner-core.js'),'utf8');
 assert.equal(html.split('/* BEGIN DISPATCH PLANNER CORE */')[1].split('/* END DISPATCH PLANNER CORE */')[0].trim(),core.trim());
});
test('validación de metadatos rechaza fecha imposible, capacidad negativa y estados arbitrarios',()=>{
 const {metadata}=require('../lib/dispatch-planner');
 const b={nombre:'Carga demo',fecha_salida:'2026-09-10',estado:'BORRADOR'};
 assert.equal(metadata(b).capacidad_kg,0);
 assert.throws(()=>metadata({...b,fecha_salida:'2026-02-31'}),/Fecha/);
 assert.throws(()=>metadata({...b,capacidad_kg:-1}),/Capacidad/);
 assert.throws(()=>metadata({...b,estado:'ENTREGADO'}),/Estado/);
});

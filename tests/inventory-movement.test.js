const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {validate}=require('../lib/inventory-movement');
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
const code=html.slice(html.indexOf('let inventoryWriteVersion='),html.indexOf('function openItemMovs('));
function setup(){
 const nodes={m_cantidad:{value:'5'},m_motivo:{value:'Compra'},m_precio:{value:'2'},movementSubmit:{},movementStatus:{style:{}}};
 const context=vm.createContext({document:{getElementById:k=>nodes[k]},INVENTARIO:[{id:1,tipo:'materia_prima',stock:10,unidad:'kg'}],MOVIMIENTOS:[],puedeInventario:()=>true,crypto:{randomUUID:()=> 'test-movement-00001'},mapInventario:r=>({...r,stock:Number(r.stock)}),mapMovimiento:r=>r,renderView(){},buildNav(){},toast(){}});
 vm.runInContext(code,context);return {context,nodes,state:vm.runInContext('inventorySave',context)};
}
test('rechaza cantidades no finitas, negativas, excesivas y con más de dos decimales',()=>{
 for(const cantidad of [NaN,Infinity,-1,0,1e8,1.001])assert.throws(()=>validate(1,{cantidad,tipo:'ingreso',motivo:'Test',operation_key:'test-movement-00001'}));
 assert.equal(validate(1,{cantidad:1.25,tipo:'salida',motivo:'Test',operation_key:'test-movement-00001'}).cantidad,1.25);
});
test('el formulario usa el saldo confirmado por servidor y muestra confirmación persistente',async()=>{
 const {context:c,nodes,state}=setup();let calls=0;
 c.apiPost=async(url,body)=>{calls++;assert.equal(url,'/api/inventario/1/movimiento');assert.equal(body.stock,undefined);return {inventario:{id:1,stock:'105',unidad:'kg'},movimiento:{id:7}}};
 await c.confirmMovimiento(1,'ingreso');assert.equal(c.INVENTARIO[0].stock,105);assert.equal(c.MOVIMIENTOS.length,1);assert.match(nodes.movementStatus.textContent,/Guardado en el servidor/);assert.equal(state.pending,null);assert.equal(calls,1);
});
test('un fallo de conexión no altera saldos y reintentar conserva la clave',async()=>{
 const {context:c,nodes,state}=setup();let key;
 c.apiPost=async(url,body)=>{key=body.operation_key;throw Error('Sin conexión')};
 await c.confirmMovimiento(1,'ingreso');assert.equal(c.INVENTARIO[0].stock,10);assert.equal(c.MOVIMIENTOS.length,0);assert.match(nodes.movementStatus.textContent,/Reintentar/);assert.ok(state.pending);
 c.apiPost=async(url,body)=>{assert.equal(body.operation_key,key);return {inventario:{id:1,stock:15,unidad:'kg'},movimiento:{id:8}}};
 await c.confirmMovimiento(1,'ingreso');assert.equal(c.INVENTARIO[0].stock,15);assert.equal(state.pending,null);
});
test('un rechazo de validación permite corregir y un doble clic no duplica llamadas',async()=>{
 const {context:c,nodes}=setup();c.apiPost=async()=>{throw Object.assign(Error('Cantidad inválida'),{status:400})};
 await c.confirmMovimiento(1,'ingreso');assert.equal(nodes.m_cantidad.disabled,false);
 let done,calls=0;c.apiPost=()=>{calls++;return new Promise(resolve=>done=resolve)};
 const first=c.confirmMovimiento(1,'ingreso');await c.confirmMovimiento(1,'ingreso');assert.equal(calls,1);
 done({inventario:{id:1,stock:15,unidad:'kg'},movimiento:{id:9}});await first;
});
test('todos los scripts del frontend tienen sintaxis válida',()=>{for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);});
test('una consulta iniciada antes del guardado no sobrescribe el saldo confirmado',async()=>{
 const {context:c}=setup();let resolveStock;
 Object.assign(c,{CLIENTES:[],PRODUCCIONES:[],SOLICITUDES:[],CATALOGO:[],mapCliente:r=>r,mapPedido:r=>r,mapProduccion:r=>r,mapSolicitud:r=>r});
 c.apiGet=async url=>url==='/api/inventario'?new Promise(resolve=>resolveStock=resolve):[];
 vm.runInContext(html.slice(html.indexOf('async function loadAllData(){'),html.indexOf('let CATALOGO_IDS=[];')),c);
 const refresh=c.loadAllData();
 c.apiPost=async()=>({inventario:{id:1,stock:105,unidad:'kg'},movimiento:{id:10}});
 await c.confirmMovimiento(1,'ingreso');resolveStock([{id:1,stock:10}]);await refresh;
 assert.equal(c.INVENTARIO[0].stock,105);assert.equal(c.MOVIMIENTOS.length,1);
});

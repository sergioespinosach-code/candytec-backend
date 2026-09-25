'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const warehouse=require('../lib/inventory-warehouse'),film=require('../lib/film-cost');
function fixture(role='bodega'){
 let state={item:{id:5,tipo:'materia_prima',bodega:'materias_primas',nombre:'Lámina YumYum',stock:30,costo_prom:6,unidad:'kg'},ops:[],audit:[],role,fail:false},snapshot;
 const db={release(){},async query(sql,p=[]){const result=rows=>({rows:structuredClone(rows)});
 if(sql==='BEGIN'){snapshot=structuredClone(state);return result([]);}if(sql==='ROLLBACK'){state=snapshot;return result([]);}if(sql==='COMMIT'||sql.includes('pg_advisory'))return result([]);
 if(sql.includes('FROM users'))return result([{id:1,name:'Bodega',role:state.role}]);
 if(sql.startsWith('SELECT * FROM business_operations'))return result(state.ops.filter(x=>x.operation_key===p[0]));
 if(sql.startsWith('SELECT * FROM inventario'))return result(state.item.id===p[0]?[state.item]:[]);
 if(sql.startsWith('UPDATE inventario SET bodega=')){state.item.bodega=p[0];return result([state.item]);}
 if(sql.startsWith('INSERT INTO business_audit')){if(state.fail)throw Error('audit failed');state.audit.push({before:JSON.parse(p[5]),after:JSON.parse(p[6])});return result([]);}
 if(sql.startsWith('INSERT INTO business_operations')){state.ops.push({operation_key:p[0],actor_id:p[1],request_hash:p[2],response:JSON.parse(p[3])});return result([]);}
 throw Error(sql);
 }};return {pool:{connect:async()=>db},state:()=>state};
}
const body={desde:'materias_primas',bodega:'laminas_cajas',operation_key:'warehouse-test-000001'};
test('mover conserva ID, stock, costo y vínculo de lámina; reintentar no duplica auditoría',async()=>{
 const f=fixture(),old=structuredClone(f.state().item);const config={item_id:5,unidades_por_kg:2000};
 const before=film.calculate(config,1000,[old]);await warehouse.move(f.pool,1,5,body);
 assert.deepEqual(f.state().item,{...old,bodega:'laminas_cajas'});assert.deepEqual(film.calculate(config,1000,[f.state().item]),before);
 await warehouse.move(f.pool,1,5,body);assert.equal(f.state().audit.length,1);
 await warehouse.move(f.pool,1,5,{desde:'laminas_cajas',bodega:'materias_primas',operation_key:'warehouse-test-000002'});assert.deepEqual(f.state().item,old);
});
test('un fallo revierte clasificación y auditoría',async()=>{
 const f=fixture();f.state().fail=true;await assert.rejects(warehouse.move(f.pool,1,5,body),/audit failed/);assert.equal(f.state().item.bodega,'materias_primas');assert.equal(f.state().audit.length,0);
});
test('solo bodega y gerencia clasifican materiales; rechaza PT, origen desactualizado y claves reutilizadas',async()=>{
 await assert.rejects(warehouse.move(fixture('produccion').pool,1,5,body),{status:403});
 const f=fixture();f.state().item.tipo='producto_terminado';await assert.rejects(warehouse.move(f.pool,1,5,body),{status:400});
 const g=fixture('gerente');await warehouse.move(g.pool,1,5,body);
 await assert.rejects(warehouse.move(g.pool,1,5,{...body,operation_key:'warehouse-test-000002'}),{status:409});
 await assert.rejects(warehouse.move(g.pool,1,5,{...body,bodega:'materias_primas'}),{status:409});
});
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
const items=[{id:1,nombre:'Azúcar',tipo:'materia_prima',stock:10,minimo:1,costoProm:1},{id:2,nombre:'Lámina',tipo:'materia_prima',bodega:'laminas_cajas',stock:20,minimo:1,costoProm:6},{id:3,nombre:'Cajas',tipo:'materia_prima',bodega:'laminas_cajas',stock:40,minimo:1,costoProm:2},{id:4,nombre:'YumYum',tipo:'producto_terminado',stock:10,minimo:1}];
test('vistas separan materiales y calculan valor de cada bodega',()=>{
 const c=vm.createContext({INVENTARIO:items,MOVIMIENTOS:[],pageHead:(title)=>title,money:String,puedeInventario:()=>false,invCard:i=>i.nombre,ordenarInventario:x=>x,invSearchQuery:'',invSortMode:'alfa'});
 vm.runInContext(html.slice(html.indexOf('function invWarehouse('),html.indexOf('const warehouseMove=')),c);
 vm.runInContext(html.slice(html.indexOf('function invGridHTML('),html.indexOf('function invCard(')),c);
 assert.equal(c.invGridHTML('materia_prima'),'Azúcar');assert.equal(c.invGridHTML('laminas_cajas'),'LáminaCajas');assert.equal(c.invGridHTML('producto_terminado'),'YumYum');
 assert.match(c.viewInventario('laminas_cajas'),/Bodega de Láminas y Cajas/);assert.match(c.viewInventario('laminas_cajas'),/>200</);
});
test('fallo de red conserva solicitud y un reintento confirmado cambia solo la clasificación local',async()=>{
 const c=vm.createContext({INVENTARIO:structuredClone(items),puedeInventario:()=>true,confirm:()=>true,crypto:{randomUUID:()=>body.operation_key},toast(){},renderView(){},buildNav(){}});
 vm.runInContext('let inventoryWriteVersion=0;'+html.slice(html.indexOf('const warehouseMove='),html.indexOf("let invSortMode='alfa'")),c);
 let saved;c.apiPost=async(url,b)=>{saved=JSON.stringify(b);throw Error('Red');};await c.moveItemWarehouse(1);assert.equal(c.INVENTARIO[0].bodega,undefined);
 c.apiPost=async(url,b)=>{assert.equal(JSON.stringify(b),saved);return {id:1,bodega:'laminas_cajas'}};await c.moveItemWarehouse(1);
 assert.equal(c.INVENTARIO[0].bodega,'laminas_cajas');assert.equal(c.INVENTARIO[0].stock,10);assert.equal(c.INVENTARIO[0].costoProm,1);
});
test('mapeo conserva bodega y formulario nuevo de empaques incluye precio',()=>{
 const nodes={modal:{},overlay:{classList:{add(){}}}};
 const c=vm.createContext({document:{getElementById:id=>nodes[id]},puedeInventario:()=>true});
 vm.runInContext("let itemTipoChoice='';"+html.slice(html.indexOf('function openNuevoItem('),html.indexOf('async function confirmNuevoItem(')),c);c.openNuevoItem('laminas_cajas');
 assert.match(nodes.modal.innerHTML,/Bodega de Láminas y Cajas/);assert.match(nodes.modal.innerHTML,/id="i_precio"/);
 vm.runInContext(html.slice(html.indexOf('function mapInventario('),html.indexOf('function mapMovimiento(')),c);assert.equal(c.mapInventario({bodega:'laminas_cajas'}).bodega,'laminas_cajas');
});

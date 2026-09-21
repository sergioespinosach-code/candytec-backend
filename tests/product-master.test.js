'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const master=require('../lib/product-master');
const data=()=>({nombre:'YumYum 5 kg',sku:'',marca:'YumYum',categoria:'Caramelo duro',familia:'Caramelo duro',peso_unitario_g:5,peso_masa_g:5,presentacion:'Funda',unidades_presentacion:1000,peso_neto_kg:5,peso_bulto:5});
function dbFixture(role='gerente'){
 const s={materials:[{id:17,nombre:'Lámina YumYum',tipo:'materia_prima',unidad:'kg',costo_prom:6}],formulas:[{id:7}],catalog:[],inventory:[],audit:[],ops:[],role,fail:false};let backup;
 const db={release(){},async query(sql,p=[]){const result=rows=>({rows:structuredClone(rows)});
 if(sql==='BEGIN'){backup=structuredClone(s);return result([]);}if(sql==='ROLLBACK'){Object.assign(s,backup);return result([]);}if(sql==='COMMIT'||sql.includes('pg_advisory'))return result([]);
 if(sql.includes('FROM users'))return result(s.role?[{id:1,name:'Gerente',role:s.role}]:[]);
 if(sql.startsWith('SELECT * FROM business_operations'))return result(s.ops.filter(x=>x.operation_key===p[0]));
 if(sql.startsWith('SELECT * FROM catalogo'))return result(s.catalog.filter(x=>x.id===p[0]));
 if(sql.startsWith('SELECT id FROM catalogo'))return result(s.catalog.filter(x=>x.nombre.toLowerCase()===p[0].toLowerCase()&&x.id!==p[1]));
 if(sql.startsWith('SELECT id FROM base_formulations'))return result(s.formulas.filter(x=>x.id===p[0]));
 if(sql.startsWith('UPDATE catalogo SET formula_id')){const row=s.catalog.find(x=>x.id===p[1]);row.formula_id=p[0];return result([row]);}
 if(sql.startsWith('INSERT INTO catalogo')){if(p[1]&&s.catalog.some(x=>x.sku?.toLowerCase()===p[1].toLowerCase()))throw Object.assign(Error('duplicado'),{code:'23505'});const row={id:s.catalog.length+1,nombre:p[0],sku:p[1],ficha:JSON.parse(p[2]),peso_bulto:p[3],activo:true,version:1};s.catalog.push(row);return result([row]);}
 if(sql.startsWith("UPDATE catalogo SET sku='CT-P-'")){const r=s.catalog.find(x=>x.id===p[0]);r.sku='CT-P-'+r.id;return result([r]);}
 if(sql.startsWith('UPDATE catalogo SET sku=$1')){const r=s.catalog.find(x=>x.id===p[3]);Object.assign(r,{sku:p[0],ficha:JSON.parse(p[1]),peso_bulto:p[2],version:r.version+1});return result([r]);}
 if(sql.startsWith('INSERT INTO inventario')){if(!s.inventory.some(x=>x.nombre===p[0]))s.inventory.push({nombre:p[0],stock:0});return result([]);}
 if(sql.startsWith('SELECT id,nombre,unidad,tipo,costo_prom FROM inventario WHERE id='))return result(s.materials.filter(x=>x.id===p[0]));
 if(sql.startsWith('SELECT stock FROM inventario'))return result(s.inventory.filter(x=>x.nombre===p[0]));
 if(sql.startsWith('UPDATE catalogo SET activo')){const r=s.catalog.find(x=>x.id===p[1]);r.activo=p[0];r.version++;return result([r]);}
 if(sql.startsWith('INSERT INTO business_audit')){if(s.fail)throw Error('Fallo de escritura');s.audit.push({before:JSON.parse(p[5]),after:JSON.parse(p[6])});return result([]);}
 if(sql.startsWith('INSERT INTO business_operations')){s.ops.push({operation_key:p[0],actor_id:p[1],request_hash:p[2],response:JSON.parse(p[3])});return result([]);}
 throw Error('SQL inesperado: '+sql);
 }};return {s,connect:async()=>db};
}
const body=(extra={})=>({action:'save',operation_key:'product-operation-000001',data:data(),...extra});
test('ficha parcial permite empezar sin inventar marca, pesos o categoría',()=>{const p=master.validate({nombre:'Producto existente'});assert.equal(p.ficha.marca,'');assert.equal(p.ficha.peso_unitario_g,null);assert.equal(p.peso_bulto,null);});
test('distingue peso pieza, masa y presentación y rechaza valores imposibles',()=>{const p=master.validate(data());assert.equal(p.ficha.peso_unitario_g,5);assert.equal(p.peso_bulto,5);assert.throws(()=>master.validate({...data(),peso_masa_g:6}),/masa/);assert.throws(()=>master.validate({...data(),unidades_presentacion:1.5}),/enteras/);assert.throws(()=>master.validate({...data(),peso_neto_kg:-1}),/peso_neto/);});
test('nuevo producto crea un solo ítem en inventario y SKU automático aun al reintentar',async()=>{const db=dbFixture(),b=body();const a=await master.save(db,1,b),retry=await master.save(db,1,b);assert.equal(a.sku,'CT-P-1');assert.equal(retry.id,a.id);assert.equal(db.s.catalog.length,1);assert.equal(db.s.inventory.length,1);assert.equal(db.s.audit.length,1);});
test('editar ficha conserva nombre, ID, inventario e historial',async()=>{const db=dbFixture();await master.save(db,1,body());const r=await master.save(db,1,body({id:1,version:1,operation_key:'product-operation-000002',data:{...data(),marca:'YumYum Premium'}}));assert.equal(r.id,1);assert.equal(r.nombre,'YumYum 5 kg');assert.equal(r.version,2);assert.equal(db.s.inventory.length,1);assert.equal(db.s.audit[1].before.ficha.marca,'YumYum');});
test('no renombra referencias históricas ni sobreescribe ficha desactualizada',async()=>{const db=dbFixture();await master.save(db,1,body());await assert.rejects(master.save(db,1,body({id:1,version:1,operation_key:'product-operation-000002',data:{...data(),nombre:'Otro'}})),/histórico/);await assert.rejects(master.save(db,1,body({id:1,version:2,operation_key:'product-operation-000003'})),{status:409});});
test('archivo con existencias se bloquea y archivo sin saldo puede restaurarse',async()=>{const db=dbFixture();await master.save(db,1,body());db.s.inventory[0].stock=10;const b=body({id:1,version:1,action:'archive',operation_key:'product-operation-000002'});await assert.rejects(master.save(db,1,b),/existencias/);assert.equal(db.s.catalog[0].activo,true);db.s.inventory[0].stock=0;const archived=await master.save(db,1,b);assert.equal(archived.activo,false);assert.equal(db.s.inventory.length,1);const restored=await master.save(db,1,body({id:1,version:2,action:'restore',operation_key:'product-operation-000003'}));assert.equal(restored.activo,true);assert.equal(restored.id,1);});
test('no crea duplicado de un archivado ni reutiliza operación para otro producto',async()=>{const db=dbFixture();await master.save(db,1,body());await assert.rejects(master.save(db,1,body({operation_key:'product-operation-000002'})),/ya existe/);await assert.rejects(master.save(db,1,body({data:{...data(),nombre:'Otro'}})),{status:409});});
test('fallo revierte producto e inventario y facturación no administra catálogo',async()=>{const db=dbFixture();db.s.fail=true;await assert.rejects(master.save(db,1,body()),/Fallo/);assert.equal(db.s.catalog.length,0);assert.equal(db.s.inventory.length,0);await assert.rejects(master.save(dbFixture('facturacion'),1,body()),{status:403});});
test('prefijo automático no puede reservarse para otro SKU',async()=>{await assert.rejects(master.save(dbFixture(),1,body({data:{...data(),sku:'CT-P-27'}})),/reservado/);});
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
test('interfaz reintenta con la misma operación sin confirmar antes del servidor',async()=>{
 let failing=true,loaded=0;const requests=[],nodes={};const ctx=vm.createContext({window:{addEventListener(){}},document:{getElementById:id=>nodes[id]||(nodes[id]={value:'',disabled:false,textContent:'',hidden:false})},crypto:{randomUUID:()=> 'product-ui-operation-0001'},confirm:()=>true,toast(){},apiPost:async(url,b)=>{requests.push(structuredClone(b));if(failing)throw Error('Sin red');return {id:1};}});
 vm.runInContext(html.slice(html.indexOf('/* Mis productos: fichas'),html.lastIndexOf('</script>')),ctx);
 vm.runInContext('PM.editor={activo:true};',ctx);ctx.pmRead=()=>data();ctx.pmLoad=async()=>{loaded++;};await ctx.pmSave('save');assert.equal(nodes.pmFields.disabled,true);assert.equal(loaded,0);assert.equal(nodes.pmSaveButton.textContent,'Reintentar cambio');failing=false;await ctx.pmSave('save');assert.equal(requests[0].operation_key,requests[1].operation_key);assert.equal(loaded,1);
});
test('menú y protección del refresco incluyen Mis productos y scripts compilan',()=>{assert.match(html,/v:'mis-productos'/);assert.match(html,/VISTAS_FORMULARIO=\[[^;]*'mis-productos'/);for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script[1]);});

test('vincula base existente y un cliente antiguo conserva la vinculación',async()=>{
 const db=dbFixture();const r=await master.save(db,1,body({data:{...data(),formula_id:7}}));assert.equal(r.formula_id,7);
 const edit=await master.save(db,1,body({id:1,version:1,operation_key:'product-operation-000002'}));assert.equal(edit.formula_id,7);
 const clear=await master.save(db,1,body({id:1,version:2,operation_key:'product-operation-000003',data:{...data(),formula_id:null}}));assert.equal(clear.formula_id,null);
});
test('rechaza vínculo a una base inexistente sin crear producto',async()=>{
 const db=dbFixture();await assert.rejects(master.save(db,1,body({data:{...data(),formula_id:999}})),/no existe/);assert.equal(db.s.catalog.length,0);
});
test('costos adicionales se guardan, se auditan y sobreviven a un cliente anterior',async()=>{
 const db=dbFixture();const extras={empaques:2,componentes:0,proceso:1};
 const saved=await master.save(db,1,body({data:{...data(),costos_adicionales:extras}}));assert.deepEqual(saved.ficha.costos_adicionales,extras);
 const edit=await master.save(db,1,body({id:1,version:1,operation_key:'product-operation-000002'}));assert.deepEqual(edit.ficha.costos_adicionales,extras);assert.deepEqual(db.s.audit[1].before.ficha.costos_adicionales,extras);
});

test('lámina y rendimiento persisten con referencia de precio e historial; cliente anterior conserva configuración',async()=>{
 const db=dbFixture();const r=await master.save(db,1,body({data:{...data(),lamina:{item_id:17,unidades_por_kg:2000},costos_adicionales:{empaques:0,componentes:0,proceso:0}}}));
 assert.equal(r.ficha.lamina.item_id,17);assert.equal(r.ficha.lamina.costo_kg_referencia,6);assert.equal(r.ficha.lamina.unidades_por_kg,2000);assert.equal(r.ficha.costos_adicionales.empaques,0);
 const old=await master.save(db,1,body({id:1,version:1,operation_key:'product-operation-000002'}));assert.equal(old.ficha.lamina.item_id,17);assert.equal(db.s.audit[1].after.ficha.lamina.nombre,'Lámina YumYum');
});
test('lámina inválida rechaza el guardado y no crea producto',async()=>{const db=dbFixture();await assert.rejects(master.save(db,1,body({data:{...data(),lamina:{item_id:999,unidades_por_kg:2000}}})),/no existe/);assert.equal(db.s.catalog.length,0);db.s.materials[0].unidad='L';await assert.rejects(master.save(db,1,body({data:{...data(),lamina:{item_id:17,unidades_por_kg:2000}}})),/convertir/);assert.equal(db.s.catalog.length,0);});

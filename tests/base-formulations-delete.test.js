'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const formulations=require('../lib/base-formulations');
function fixture(role='gerente'){
 const s={role,rows:[{id:7,version:2,data:{name:'Base de prueba',source_key:'candytec-hard-20261016',lines:[]},snapshot:{total:5}}],products:[],ops:[],audit:[],fail:false};let backup;const sqls=[];
 const db={release(){},async query(sql,p=[]){sqls.push(sql);const out=rows=>({rows:structuredClone(rows)});
 if(sql==='BEGIN'){backup=structuredClone(s);return out([]);}if(sql==='ROLLBACK'){Object.assign(s,backup);return out([]);}if(sql==='COMMIT'||sql.includes('pg_advisory'))return out([]);
 if(sql.includes('FROM users'))return out([{id:1,name:'Gerencia',role:s.role}]);
 if(sql.startsWith('SELECT * FROM business_operations'))return out(s.ops.filter(x=>x.operation_key===p[0]));
 if(sql.startsWith('SELECT * FROM base_formulations WHERE'))return out(s.rows.filter(x=>x.id===p[0]));
 if(sql.startsWith('SELECT id,nombre,activo FROM catalogo')){assert.match(sql,/jsonb_array_elements/);assert.match(sql,/component->>'formula_id'=\$2/);return out(s.products.filter(x=>x.formula_id===p[0]||x.ficha?.cost_model?.items?.some(l=>l.source==='formula'&&String(l.formula_id)===p[1])).slice(0,11));}
 if(sql.startsWith('DELETE FROM base_formulations')){s.rows=s.rows.filter(x=>x.id!==p[0]);return out([]);}
 if(sql.startsWith('INSERT INTO business_audit')){if(s.fail)throw Error('Fallo de auditoría');s.audit.push({reason:p[4],before:JSON.parse(p[5]),after:JSON.parse(p[6])});return out([]);}
 if(sql.startsWith('INSERT INTO business_operations')){s.ops.push({operation_key:p[0],actor_id:p[1],request_hash:p[2],response:JSON.parse(p[3])});return out([]);}
 throw Error('SQL inesperado: '+sql);
 }};return {s,sqls,connect:async()=>db};
}
const body=()=>({id:7,version:2,operation_key:'delete-formulation-0001'});
test('elimina base sin uso una sola vez, conserva receta en auditoría y permite reintentar',async()=>{
 const db=fixture(),a=await formulations.remove(db,1,body()),b=await formulations.remove(db,1,body());
 assert.deepEqual(a,b);assert.equal(a.deleted,true);assert.equal(db.s.rows.length,0);assert.equal(db.s.audit.length,1);
 assert.equal(db.s.audit[0].before.data.name,'Base de prueba');assert.equal(db.s.audit[0].after.snapshot.total,5);assert.equal(db.s.audit[0].after.deleted,true);
 assert.ok(db.sqls.indexOf('SELECT * FROM base_formulations WHERE id=$1 FOR UPDATE')<db.sqls.findIndex(s=>s.startsWith('SELECT id,nombre,activo FROM catalogo')));
 assert.ok(!db.sqls.some(s=>/^(UPDATE|DELETE FROM) (catalogo|inventario|movimientos)/.test(s)));
});
test('impide eliminar bases principales y adicionales en productos activos o archivados',async()=>{
 for(const activo of [true,false])for(const additional of [true,false]){
  const db=fixture();db.s.products=[{id:1,nombre:'YumYum',activo,...(additional?{ficha:{cost_model:{items:[{source:'formula',formula_id:'7'}]}}}:{formula_id:7})}];
  await assert.rejects(formulations.remove(db,1,body()),e=>e.status===409&&e.message.includes('YumYum')&&(!activo?e.message.includes('archivado'):true));
  assert.equal(db.s.rows.length,1);assert.equal(db.s.audit.length,0);assert.equal(db.s.ops.length,0);
 }
});
test('un material con el mismo ID no bloquea la eliminación de una formulación',async()=>{
 const db=fixture();db.s.products=[{id:1,ficha:{cost_model:{items:[{source:'inventory',item_id:7}]}}}];await formulations.remove(db,1,body());assert.equal(db.s.rows.length,0);
});
test('solo gerencia elimina y una versión desactualizada no borra cambios recientes',async()=>{
 for(const role of ['facturacion','jventas','vendedor','bodega','produccion'])await assert.rejects(formulations.remove(fixture(role),1,body()),{status:403});
 const db=fixture();await assert.rejects(formulations.remove(db,1,{...body(),version:1}),{status:409});assert.equal(db.s.rows.length,1);
 await assert.rejects(formulations.remove(db,1,{...body(),id:999}),{status:404});
});
test('fallo de auditoría revierte la eliminación y una clave no sirve para borrar otra base',async()=>{
 const db=fixture();db.s.fail=true;await assert.rejects(formulations.remove(db,1,body()),/auditoría/);assert.equal(db.s.rows.length,1);assert.equal(db.s.ops.length,0);
 db.s.fail=false;await formulations.remove(db,1,body());await assert.rejects(formulations.remove(db,1,{...body(),id:8}),{status:409});
});
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
function ui(){const nodes={},requests=[];const ctx=vm.createContext({window:{addEventListener(){}},document:{getElementById:id=>nodes[id]||(nodes[id]={})},confirm:()=>true,crypto:{randomUUID:()=> 'delete-formulation-ui-001'},toast(){},apiPost:async(url,body)=>{requests.push({url,body:structuredClone(body)});}});vm.runInContext(html.slice(html.indexOf('/* Mis productos: fichas'),html.lastIndexOf('</script>')),ctx);vm.runInContext("BF.editor={id:7,version:2,data:{name:'Base de prueba'}}",ctx);ctx.bfLoad=async()=>{};return {ctx,nodes,requests};}
test('interfaz confirma antes de eliminar y reintenta fallo de red con la misma operación',async()=>{
 const {ctx,nodes,requests}=ui();let loaded=0;ctx.bfLoad=async()=>{loaded++;};ctx.apiPost=async(url,b)=>{requests.push({url,body:structuredClone(b)});if(requests.length===1)throw Error('Sin red');};
 await ctx.bfDelete();assert.equal(loaded,0);assert.equal(nodes.bfFields.disabled,true);assert.equal(nodes.bfSaveButton.disabled,true);assert.equal(nodes.bfDeleteButton.textContent,'Reintentar eliminación');
 await ctx.bfSave();assert.equal(loaded,1);assert.equal(requests[0].url,'/api/base-formulations/delete');assert.deepEqual(requests[0].body,requests[1].body);assert.equal(vm.runInContext('BF.editor',ctx),null);
});
test('cancelar no envía petición; vínculo bloqueado conserva formulario y permite volver',async()=>{
 const {ctx,nodes,requests}=ui();ctx.confirm=()=>false;await ctx.bfDelete();assert.equal(requests.length,0);
 ctx.confirm=()=>true;ctx.apiPost=async()=>{throw Object.assign(Error('Vinculada a YumYum'),{status:409});};await ctx.bfDelete();assert.equal(vm.runInContext('BF.pending',ctx),null);assert.equal(vm.runInContext('BF.editor.id',ctx),7);assert.equal(nodes.bfBackButton.disabled,false);assert.match(nodes.bfStatus.textContent,/YumYum/);
});
test('el botón no envía el formulario de edición y todos los scripts conservan sintaxis válida',()=>{
 assert.match(html,/id="bfDeleteButton" type="button"/);for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
});

test('Dar de baja abre el producto correcto y usa el guardado existente sin duplicar operaciones',async()=>{
 const {ctx}=ui();let id,action;ctx.pmEdit=value=>{id=value;};ctx.pmSave=async value=>{action=value;};
 vm.runInContext('PM.rows=[{id:12,activo:true},{id:13,activo:false}]',ctx);
 await ctx.pmArchiveProduct(12);assert.equal(id,12);assert.equal(action,'archive');
 id=null;action=null;await ctx.pmArchiveProduct(13);assert.equal(id,null);
 vm.runInContext('PM.pending={action:"archive"}',ctx);await ctx.pmArchiveProduct(12);assert.equal(id,null);
 assert.match(html,/onclick="pmArchiveProduct\('/);assert.match(html,/Dar de baja producto/);
});

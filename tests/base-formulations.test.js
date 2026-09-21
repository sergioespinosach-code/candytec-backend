'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const bases=require('../lib/base-formulations');
const inv=[{id:1,nombre:'Azúcar',tipo:'materia_prima',unidad:'kg',costo_prom:2}];
const recipe=()=>({name:'Caramelo duro',yield_kg:9,labor:2,overhead:1,notes:'Rendimiento real',lines:[{mode:'inventory',kind:'material',item_id:1,quantity:10000,unit:'g'}]});
test('base independiente de SKU calcula kg según rendimiento real',()=>{const d=bases.validate(recipe());assert.equal(d.product_id,undefined);const c=bases.calculate(d,inv);assert.equal(c.total,23);assert.equal(c.per_kg,2.555556);});
test('una misma base escala masa de 5g y 10g sin sumar empaques',()=>{const base={current:{per_kg:2}};const a=bases.massCost({ficha:{peso_masa_g:5,unidades_presentacion:1000}},base);const b=bases.massCost({ficha:{peso_masa_g:10,unidades_presentacion:100}},base);assert.equal(a.per_piece,.01);assert.equal(a.per_presentation,10);assert.equal(b.per_piece,.02);assert.equal(b.per_presentation,2);});
test('masa desconocida o costo faltante no se asume cero ni se sustituye por peso total',()=>{const c=bases.calculate(bases.validate(recipe()),[{...inv[0],costo_prom:null}]);assert.equal(c.total,null);assert.equal(bases.massCost({ficha:{peso_unitario_g:10}}, {current:{per_kg:2}}).per_piece,null);});
test('rechaza rendimiento cero y empaque manual dentro de base',()=>{assert.throws(()=>bases.validate({...recipe(),yield_kg:0}));assert.throws(()=>bases.validate({...recipe(),lines:[{mode:'manual',kind:'packaging',name:'Funda',quantity:1,unit:'u',unit_cost:1}]}),/materias primas/);});
function fixture(role='gerente'){
 const s={rows:[],ops:[],audit:[],fail:false,role};let backup;
 const db={release(){},async query(sql,p=[]){const result=rows=>({rows:structuredClone(rows)});
 if(sql==='BEGIN'){backup=structuredClone(s);return result([]);}if(sql==='ROLLBACK'){Object.assign(s,backup);return result([]);}if(sql==='COMMIT'||sql.includes('pg_advisory'))return result([]);
 if(sql.includes('FROM users'))return result([{id:1,name:'Gerencia',role:s.role}]);
 if(sql.startsWith('SELECT * FROM business_operations'))return result(s.ops.filter(x=>x.operation_key===p[0]));
 if(sql.includes('FROM inventario'))return result(inv);
 if(sql.startsWith('SELECT * FROM base_formulations WHERE'))return result(s.rows.filter(x=>x.id===p[0]));
 if(sql.startsWith('INSERT INTO base_formulations')){const row={id:s.rows.length+1,version:1,data:JSON.parse(p[0]),snapshot:JSON.parse(p[1])};s.rows.push(row);return result([row]);}
 if(sql.startsWith('UPDATE base_formulations')){const row=s.rows.find(x=>x.id===p[2]);row.data=JSON.parse(p[0]);row.snapshot=JSON.parse(p[1]);row.version++;return result([row]);}
 if(sql.startsWith('INSERT INTO business_audit')){if(s.fail)throw Error('fallo historial');s.audit.push({before:JSON.parse(p[5]),after:JSON.parse(p[6])});return result([]);}
 if(sql.startsWith('INSERT INTO business_operations')){s.ops.push({operation_key:p[0],actor_id:p[1],request_hash:p[2],response:JSON.parse(p[3])});return result([]);}
 throw Error('SQL inesperado: '+sql);
 }};return {s,connect:async()=>db};
}
const body=()=>({data:recipe(),operation_key:'base-formulation-000001'});
test('guarda fotografía y reintento idempotente no duplica base ni historial',async()=>{const db=fixture();const a=await bases.save(db,1,body()),b=await bases.save(db,1,body());assert.equal(a.id,b.id);assert.equal(a.snapshot.total,23);assert.equal(db.s.rows.length,1);assert.equal(db.s.audit.length,1);});
test('editar exige versión y motivo y conserva receta previa',async()=>{const db=fixture();await bases.save(db,1,body());const b={...body(),id:1,version:1,reason:'Rendimiento corregido',operation_key:'base-formulation-000002',data:{...recipe(),yield_kg:8}};await bases.save(db,1,b);assert.equal(db.s.audit[1].before.data.yield_kg,9);assert.equal(db.s.rows[0].data.yield_kg,8);await assert.rejects(bases.save(db,1,{...b,operation_key:'base-formulation-000003'}),{status:409});});
test('unidad incompatible, insumo inexistente, falta de permiso y fallo de auditoría no guardan',async()=>{const db=fixture();const bad=recipe();bad.lines[0].unit='L';await assert.rejects(bases.save(db,1,{...body(),data:bad}),/convertir/);assert.equal(db.s.rows.length,0);bad.lines[0].item_id=99;await assert.rejects(bases.save(db,1,{...body(),data:bad}),/ya no existe/);await assert.rejects(bases.save(fixture('facturacion'),1,body()),{status:403});db.s.fail=true;await assert.rejects(bases.save(db,1,body()),/fallo historial/);assert.equal(db.s.rows.length,0);assert.equal(db.s.ops.length,0);});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bases=require('../lib/base-formulations'),components=require('../lib/product-components'),costs=require('../lib/product-costs'),templates=require('../lib/cost-templates');
const close=(a,b)=>assert.ok(Math.abs(a-b)<.00001,`${a} != ${b}`);
const material=(id,nombre,costo_prom=2,unidad='kg')=>({id,nombre,costo_prom,unidad,tipo:'materia_prima'});
const model=items=>components.validate({version:2,basis:'weight',mass_extra_pct:5,items});
const inv=[material(1,'Masa',2),material(2,'Lámina externa',6),material(3,'Lámina interna',3),material(4,'Fundón',.1,'u'),material(5,'Caja',.8,'u')];
const base=(inventory=inv)=>{const data=bases.validate({name:'Base de prueba',yield_kg:10,labor:0,overhead:0,lines:[{mode:'inventory',kind:'material',item_id:1,quantity:10,unit:'kg'}]});return {id:1,data,current:bases.calculate(data,inventory)};};
const row=(id,method,quantity,unit='kg',extra_pct=0)=>({source:'inventory',item_id:id,method,quantity,unit,extra_pct});
const toffee=()=>({id:1,nombre:'Toffee',ficha:{presentacion:'Caja 10 kg',peso_unitario_g:6,peso_masa_g:6,peso_neto_kg:10,costos_adicionales:{empaques:0,componentes:0,proceso:0},cost_model:model([row(2,'yield',5900,'kg',5),row(3,'yield',10000,'kg',5),row(4,'presentation',2,'u'),row(5,'presentation',1,'u')])}});

test('polvo confirmado suma 1,615 kg e incluye 50 g de esencia de limón sin precios heredados',()=>{
 const t=templates.formulas.find(t=>t.key.includes('powder'));
 close(t.lines.reduce((s,l)=>s+l.quantity,0),1.615);assert.equal(t.yield_kg,1.615);
 assert.equal(t.lines.find(l=>l.source_label==='ESENCIA LIMÓN').quantity,.05);
 assert.ok(t.lines.every(l=>!l.mix_group&&l.unit==='kg'));
 assert.doesNotMatch(JSON.stringify(templates),/unit_cost|costo_prom|sale_price/);
 const inventory=t.lines.map((l,i)=>material(i+1,l.source_label,2));
 const data=bases.validate({...t,lines:t.lines.map((l,i)=>({...l,item_id:i+1,mode:'inventory',kind:'material'}))});
 const c=bases.calculate(data,inventory);close(c.total,3.23);close(c.per_kg,2);
});
test('surtidos promedian alternativas de cada grupo, sin sumar todas las dosis',()=>{
 const data=bases.validate({name:'Surtido',yield_kg:10,labor:0,overhead:0,lines:[
  {mode:'inventory',kind:'material',item_id:1,quantity:10,unit:'kg'},
  {mode:'inventory',kind:'material',item_id:2,quantity:.1,unit:'kg',mix_group:'esencias'},
  {mode:'inventory',kind:'material',item_id:3,quantity:.3,unit:'kg',mix_group:'esencias'},
  {mode:'inventory',kind:'material',item_id:4,quantity:.2,unit:'kg',mix_group:'constructor'}]});
 const inventory=[material(1,'Masa',1),material(2,'Limón',10),material(3,'Fresa',20),material(4,'Color',5)];
 const c=bases.calculate(data,inventory);close(c.total,14.5);close(c.lines[1].quantity,.05);assert.equal(c.lines[1].recipe_quantity,.1);assert.equal(c.lines[1].average_count,2);
 const updated=bases.calculate(data,inventory.map(i=>i.id===2?{...i,costo_prom:20}:i));close(updated.total,15);assert.equal(data.lines[1].quantity,.1);
});
test('toffee de 6 g calcula piezas por peso y suma dos láminas, dos fundones y una caja',()=>{
 const p=toffee(),before=JSON.stringify(p),r=costs.calculate(p,base(),inv);
 assert.equal(r.complete,true);close(r.units,10000/6);assert.equal(r.units_estimated,true);
 close(r.mass_per_presentation,21);close(r.total,21+(10000/6)/5900*1.05*6+(10000/6)/10000*1.05*3+.2+.8);
 close(bases.massCost(p,base()).per_presentation,21);assert.equal(JSON.stringify(p),before);
 const refs=templates.products.filter(p=>p.categoria==='Toffee');assert.equal(refs.length,3);assert.ok(refs.every(p=>p.peso_unitario_g===6&&p.peso_masa_g===6));
});
test('precio promedio actualizado se refleja en ingredientes y empaques sin mutar la ficha',()=>{
 const p=toffee(),before=JSON.stringify(p),updated=inv.map(i=>({...i,costo_prom:i.costo_prom*2}));
 const old=costs.calculate(p,base(),inv),fresh=costs.calculate(p,base(updated),updated);
 close(fresh.total,old.total*2);assert.equal(JSON.stringify(p),before);
});
test('conversión de gramos y kg respeta la unidad de inventario y rechaza volumen',()=>{
 const l=components.validate({version:2,basis:'pieces',mass_extra_pct:0,items:[row(2,'piece',.6,'g',5)]}).items[0];
 const c=components.calculateItem(l,200,[material(2,'Palito',2)],[]);close(c.quantity,.126);close(c.amount,.252);
 const g=components.calculateItem(l,200,[material(2,'Palito',.002,'g')],[]);close(g.quantity,126);close(g.amount,.252);
 assert.equal(components.calculateItem(l,200,[material(2,'Palito',2,'L')],[]).amount,null);
});
test('polvo es una formulación adicional de 2 g por pieza, no un importe congelado',()=>{
 const data=bases.validate({name:'Polvo',yield_kg:1,labor:0,overhead:0,lines:[{mode:'inventory',kind:'material',item_id:6,quantity:1,unit:'kg'}]});
 const inventory=[...inv,material(6,'Ingredientes polvo',4)];
 const powder={id:2,data,current:bases.calculate(data,inventory)};
 const p=toffee();Object.assign(p.ficha,{peso_unitario_g:12,peso_masa_g:10,unidades_presentacion:150,peso_neto_kg:1.8,cost_model:components.validate({version:2,basis:'pieces',mass_extra_pct:0,items:[{source:'formula',formula_id:2,method:'piece',quantity:2,unit:'g',extra_pct:0}]})});
 const r=costs.calculate(p,base(),inventory,[powder]);close(r.total,4.2);assert.equal(r.complete,true);
 assert.equal(costs.calculate(p,base(),inventory,[]).total,null);
 p.ficha.cost_model.items[0].quantity=3;assert.match(costs.calculate(p,base(),inventory,[powder]).missing.join(' '),/superan el peso neto/);
});
test('faltantes no se presentan como costo cero y el porcentaje no duplica pérdidas por defecto',()=>{
 const p=toffee();p.ficha.cost_model.mass_extra_pct=0;close(costs.calculate(p,base(),inv).mass_per_presentation,20);
 assert.equal(costs.calculate(p,base(),inv.filter(i=>i.id!==2)).total,null);
 assert.equal(costs.calculate(p,base(),inv.map(i=>i.id===2?{...i,costo_prom:null}:i)).total,null);
 p.ficha.peso_unitario_g=null;assert.equal(costs.calculate(p,base(),inv).total,null);
 assert.throws(()=>model([row(2,'yield',0)]),/inválido/);
 assert.throws(()=>model([{source:'formula',formula_id:2,method:'yield',quantity:5,unit:'kg',extra_pct:0}]),/gramos o kg/);
 assert.throws(()=>components.validate({version:2,basis:'weight',mass_extra_pct:101,items:[]}),/100/);
});
const html=fs.readFileSync(require('node:path').join(__dirname,'../frontend/index.html'),'utf8');
function ui(){const ctx=vm.createContext({window:{addEventListener(){}},document:{getElementById:()=>({textContent:''})},confirm:()=>true});vm.runInContext(html.slice(html.indexOf('/* Mis productos: fichas'),html.lastIndexOf('</script>')),ctx);return ctx;}
test('plantillas solo preparan borradores y reabren la receta ya cargada sin duplicarla',()=>{
 const ctx=ui();ctx.bfForm=()=>{};ctx.fixture=structuredClone(templates.formulas);
 vm.runInContext('BF.data={templates:fixture,rows:[],inventory:[]};ctUseFormula(2)',ctx);
 assert.equal(vm.runInContext('BF.editor.data.yield_kg',ctx),1.615);
 assert.ok(vm.runInContext('BF.editor.data.lines.every(l=>l.item_id==="")',ctx));
 vm.runInContext('BF.data.rows=[{id:9,data:BF.editor.data}];BF.editor.data.lines[0].quantity=999',ctx);
 assert.equal(ctx.fixture[2].lines[0].quantity,.25);
 let opened;ctx.bfEdit=id=>{opened=id;};ctx.ctUseFormula(2);assert.equal(opened,9);
});
test('asociación automática exige coincidencia única; no adivina materias primas similares',()=>{
 const ctx=ui(),inventory=[material(1,'Esencia limón'),material(2,'Esencia limón concentrada')];
 assert.equal(ctx.ctMaterial('ESENCIA LIMÓN',inventory),1);assert.equal(ctx.ctMaterial('Esencia limon x',inventory),'');
 assert.equal(ctx.ctMaterial('ESENCIA LIMÓN',[...inventory,material(3,'Esencia limón')]),'');
 assert.equal(ctx.ctMaterial('AZUCAR',inventory,[{data:{lines:[{source_label:'AZUCAR',item_id:1}]}}]),1);
});

test('formulario lee modelo y conserva unidades originales al asociar un ingrediente',()=>{
 const ctx=ui(),nodes={};ctx.document.getElementById=id=>nodes[id]||(nodes[id]={value:''});
 const fields={nombre:'Toffee',peso_unitario_g:'6',peso_masa_g:'6',peso_neto_kg:'10',presentacion:'Caja',extra_empaques:'0',extra_componentes:'0',extra_proceso:'0'};
 for(const [k,v] of Object.entries(fields))nodes['pm_'+k]={value:v};
 nodes.ctBasis={value:'weight'};nodes.ctMassExtra={value:'5'};
 const values={id:'2',method:'yield',quantity:'5900',unit:'kg',extra_pct:'5'};
 ctx.document.querySelectorAll=()=>[{querySelector:selector=>({value:values[selector.match(/"(.*?)"/)[1]]})}];
 vm.runInContext("PM.editor={ficha:{cost_model:{items:[{source:'inventory',source_label:'Lámina toffee'}]}}}",ctx);
 const read=ctx.pmRead(),valid=require('../lib/product-master').validate(read);
 assert.equal(valid.ficha.cost_model.items[0].quantity,5900);assert.equal(valid.ficha.cost_model.basis,'weight');assert.equal(valid.ficha.lamina,null);
 ctx.bfReadLines=()=>[{quantity:.25,unit:'kg'}];ctx.bfLines=()=>{};
 vm.runInContext("BF.data={inventory:[{id:1,unidad:'g'}]};BF.editor={data:{}};bfSelect(0,1)",ctx);
 assert.equal(vm.runInContext('BF.editor.data.lines[0].unit',ctx),'kg');
});
test('preparar SKU conserva importes manuales y no altera productos archivados',()=>{
 const ctx=ui();ctx.templates=structuredClone(templates.products);ctx.pmRead=()=>({nombre:'Toffee existente',sku:'SKU-1',marca:'Anterior',peso_bulto:11,costos_adicionales:{empaques:3,componentes:0,proceso:1}});ctx.pmForm=()=>{};
 vm.runInContext("PM.templates=templates;PM.inventory=[];PM.formulations=[];PM.editor={activo:true,ficha:{}};ctApplyProduct(6)",ctx);
 assert.equal(vm.runInContext('PM.editor.ficha.peso_unitario_g',ctx),6);
 assert.equal(vm.runInContext('PM.editor.ficha.costos_adicionales.empaques',ctx),3);
 assert.equal(vm.runInContext('PM.editor.peso_bulto',ctx),11);
 assert.equal(vm.runInContext('PM.editor.nombre',ctx),'Toffee existente');
 assert.equal(vm.runInContext('PM.editor.formula_id',ctx),null);
 const before=vm.runInContext('PM.editor.activo=false;JSON.stringify(PM.editor)',ctx);ctx.ctApplyProduct(0);
 assert.equal(vm.runInContext('JSON.stringify(PM.editor)',ctx),before);
});

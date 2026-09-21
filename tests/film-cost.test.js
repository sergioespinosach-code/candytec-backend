'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const film=require('../lib/film-cost'),costs=require('../lib/product-costs');
const item={id:17,nombre:'Lámina',tipo:'materia_prima',unidad:'kg',costo_prom:6};
const config={item_id:17,unidades_por_kg:2000};
test('precio por kg y rendimiento calculan consumo y costo por pieza/presentación',()=>{const r=film.calculate(config,1000,[item]);assert.equal(r.unit_cost,6);assert.equal(r.quantity,.5);assert.equal(r.per_piece,.003);assert.equal(r.amount,3);});
test('misma lámina con rendimiento distinto tiene costo distinto y sigue precio actual',()=>{assert.equal(film.calculate({...config,unidades_por_kg:1000},1000,[item]).amount,6);assert.equal(film.calculate(config,1000,[{...item,costo_prom:8}]).amount,4);});
test('gramos convierten correctamente a precio por kg; volumen no se presume masa',()=>{assert.equal(film.priceKg({...item,unidad:'g',costo_prom:.006}),6);assert.throws(()=>film.priceKg({...item,unidad:'L'}),/convertir/);assert.equal(film.choices([item,{...item,id:18,unidad:'L'}]).length,1);});
test('rendimiento inválido se rechaza y costo ausente no se convierte en cero',()=>{assert.throws(()=>film.validate({...config,unidades_por_kg:0}),/rendimiento/);assert.throws(()=>film.validate({...config,unidades_por_kg:'no'}),/rendimiento/);const a=film.calculate(config,1000,[{...item,costo_prom:0}]);assert.equal(a.amount,null);assert.match(a.reason,/costo promedio/);assert.equal(film.calculate(config,1000,[]).amount,null);});
test('costo SKU añade lámina y otros empaques una vez',()=>{const p={id:1,nombre:'Yum',ficha:{presentacion:'Funda',peso_masa_g:5,unidades_presentacion:1000,peso_neto_kg:5,lamina:config,costos_adicionales:{empaques:1,componentes:0,proceso:0}}};const base={id:2,data:{name:'Base',yield_kg:10,labor:0,overhead:0},current:{per_kg:2,lines:[{name:'Ingrediente',inventory_quantity:10,source_unit:'kg',unit_cost:2,total:20}]}};const r=costs.calculate(p,base,[item]);assert.equal(r.total,14);assert.equal(r.rows.find(x=>x.group==='Lámina del inventario').amount,3);assert.equal(r.rows.find(x=>x.name==='Otros empaques (sin la lámina seleccionada)').amount,1);assert.equal(costs.calculate(p,base,[]).total,null);});
test('falta de unidades impide costo de presentación sin impedir costo por pieza',()=>{const r=film.calculate(config,null,[item]);assert.equal(r.per_piece,.003);assert.equal(r.amount,null);});
test('vista previa y cambio de modo evitan reutilizar importe manual con lámina',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');const nodes={pm_film_id:{value:'17'},pm_film_yield:{value:'2000'},pm_unidades_presentacion:{value:'1000'},pmFilmPreviewText:{},pmFilmNotice:{},pm_extra_empaques:{value:'5',parentElement:{firstChild:{}}}};
 const ctx=vm.createContext({PM:{editor:{ficha:{}},filmMode:false,films:[{...item,costo_kg:6}]},document:{getElementById:id=>nodes[id]},bcMoney:(v)=>String(v)});
 vm.runInContext(html.slice(html.indexOf('function pmFilmFields('),html.lastIndexOf('</script>')),ctx);
 ctx.pmFilmChanged();assert.equal(nodes.pm_extra_empaques.value,'');assert.match(nodes.pmFilmNotice.textContent,/dos veces/);assert.match(nodes.pmFilmPreviewText.textContent,/0.003/);assert.equal(nodes.pm_film_yield.required,true);
 nodes.pm_extra_empaques.value='1';ctx.pmFilmChanged();assert.equal(nodes.pm_extra_empaques.value,'1');
});

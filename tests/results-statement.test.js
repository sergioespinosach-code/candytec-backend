'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const results=require('../lib/results-statement');
const base={id:8,version:1,data:{name:'Masa',yield_kg:10,labor:0,overhead:0},current:{per_kg:1,lines:[{name:'Azúcar',inventory_quantity:10,source_unit:'kg',unit_cost:1,total:10}]}};
const formulations={inventory:[],rows:[base]};
const catalog=[{id:1,nombre:'YumYum',activo:true,formula_id:8,ficha:{peso_masa_g:10,unidades_presentacion:100,peso_neto_kg:1,presentacion:'Fundón',costos_adicionales:{empaques:0,componentes:0,proceso:0}}}];
const order=()=>({numero_pedido:'CT-1',fecha_orden:'2026-10-10',estado:'ENTREGADO',products:[{name:'YumYum',qty:10,price:10}],entregas:[{numeroFactura:'FAC-1',fecha:'10/10/2026',estado:'ENTREGADO',items:[{name:'YumYum',qty:10}],costoTransporte:5,costoEstibaje:2}],descuento:0,iva_tasa:15,history:[],cliente:'Cliente'});
const expenses=[{data:{date:'2026-10-12',amount:20,category:'Marketing',treatment:'operativo',status:'pagado'}},{data:{date:'2026-10-12',amount:3,category:'Mantenimiento',treatment:'fabricacion',status:'pendiente'}},{data:{date:'2026-10-12',amount:10,category:'Marketing',status:'anulado'}},{data:{date:'2026-09-12',amount:5,category:'Marketing',status:'pagado'}}];
const run=(orders=[order()],products=catalog,rows=expenses)=>results.summarize(orders,products,formulations,rows,'2026-10-01','2026-10-31');
test('facturación sin IVA menos costo SKU, despacho y gastos del período',()=>{
 const r=run();assert.equal(r.sales,100);assert.equal(r.iva,15);assert.equal(r.knownCost,10);assert.equal(r.gross,90);assert.equal(r.logistics,7);assert.equal(r.operating,20);assert.equal(r.manufacturing,3);assert.equal(r.estimated,60);assert.equal(r.months[0].profit,60);assert.equal(r.categories.find(x=>x.name==='Marketing').amount,20);
});
test('notas de crédito reducen ventas pero no presumen retorno de unidades',()=>{
 const o=order();o.financial_data={snapshots:[{numero:'FAC-1',base:100,iva:15}],events:[{id:'credit-1',type:'NC',invoice:'FAC-1',base:10,iva:1.5}]};
 const r=run([o]);assert.equal(r.sales,90);assert.equal(r.knownCost,10);assert.equal(r.estimated,50);assert.equal(r.unallocated,-10);
});
test('dos facturas parciales no duplican logística ni costo',()=>{
 const o=order();o.products[0].qty=5;o.entregas=[{numeroFactura:'A',estado:'ENTREGADO',items:[{name:'YumYum',qty:2}],costoTransporte:5},{numeroFactura:'B',estado:'EN_TRANSITO',items:[{name:'YumYum',qty:3}],costoEstibaje:8}];
 const r=run([o],catalog,[]);assert.equal(r.sales,50);assert.equal(r.knownCost,5);assert.equal(r.logistics,13);assert.equal(r.invoices,2);assert.equal(r.estimated,32);
});
test('producto archivado conserva costo; faltante oculta utilidad estimada',()=>{
 const archived=run([order()],[{...catalog[0],activo:false}],[]);assert.equal(archived.estimated,83);
 const missing=run([order()],[],[]);assert.equal(missing.sales,100);assert.equal(missing.complete,false);assert.equal(missing.gross,null);assert.equal(missing.estimated,null);assert.equal(missing.missing[0].product,'YumYum');
});
test('gastos sin ventas aparecen en su mes; pedidos fuera del período no cuentan',()=>{
 const o=order();o.fecha_orden='2026-09-10';const r=run([o]);assert.equal(r.sales,0);assert.equal(r.logistics,0);assert.equal(r.operating,20);assert.equal(r.estimated,-23);assert.equal(r.months[0].profit,-23);
});
test('el endpoint exige gerencia antes de consultar pedidos',async()=>{
 let queries=[];const db={release(){},async query(sql){queries.push(sql);if(sql.includes('FROM users'))return {rows:[{id:1,role:'facturacion'}]};return {rows:[]};}};
 await assert.rejects(results.report({connect:async()=>db},1,'2026-10-01','2026-10-31'),{status:403});assert.ok(!queries.some(q=>q.includes('FROM pedidos')));assert.ok(queries.includes('ROLLBACK'));
});
test('consulta consistente de gerente incluye productos archivados y fechas DATE de PostgreSQL',async()=>{
 const queries=[];const db={release(){},async query(sql){queries.push(sql);if(sql.includes('FROM users'))return {rows:[{id:1,role:'gerente'}]};if(sql.includes('FROM catalogo'))return {rows:[{...catalog[0],activo:false}]};if(sql.includes('FROM inventario'))return {rows:[{id:2,nombre:'Azúcar',tipo:'materia_prima',unidad:'kg',costo_prom:1}]};if(sql.includes('FROM base_formulations'))return {rows:[{...base,data:{...base.data,lines:[{mode:'inventory',kind:'material',item_id:2,quantity:10,unit:'kg'}]}}]};if(sql.includes('FROM pedidos'))return {rows:[{...order(),fecha_orden:new Date('2026-10-10T00:00:00Z')}]};if(sql.includes('FROM business_expenses'))return {rows:expenses};return {rows:[]};}};
 const r=await results.report({connect:async()=>db},1,'2026-10-01','2026-10-31');assert.equal(r.estimated,60);assert.ok(queries[0].includes('REPEATABLE READ READ ONLY'));assert.ok(queries.includes('COMMIT'));
});
test('rango inválido se rechaza antes de abrir una conexión',async()=>{
 await assert.rejects(results.report({connect(){throw Error('No se debía conectar');}},1,'2026-02-30','2026-10-31'),{status:400});
});

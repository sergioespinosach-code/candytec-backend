'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const prices=require('../lib/product-sales-pricing');
const stock=require('../lib/finished-stock-valuation');
const costs=require('../lib/product-costs');
const recipe={id:3,version:1,data:{name:'Duro',yield_kg:10,labor:0,overhead:0,lines:[{mode:'inventory',kind:'material',item_id:1,quantity:10,unit:'kg'}]}};
const sugar=[{id:1,nombre:'Azúcar',tipo:'materia_prima',unidad:'kg',costo_prom:1}];
const product={id:1,nombre:'YumYum',sku:'Y-1',activo:true,formula_id:3,ficha:{peso_masa_g:10,unidades_presentacion:100,presentacion:'Fundón',costos_adicionales:{empaques:0,componentes:0,proceso:0}}};
const order=()=>({numero_pedido:'CT-1',fecha_orden:'2026-10-12',estado:'ENTREGADO',products:[{name:'YumYum',qty:10,price:10}],factura:'F-1',entregas:[],descuento:10});
const items=[{id:4,nombre:'YumYum',tipo:'producto_terminado',unidad:'unidades',stock:5},{id:5,nombre:'Sin venta',tipo:'producto_terminado',unidad:'unidades',stock:2}];
test('precio promedio facturado sin IVA y después de descuento, sin repartir NC global',()=>{
 const o=order();o.financial_data={snapshots:[{numero:'F-1',base:90,iva:13.5}],events:[{id:'nc',type:'NC',invoice:'F-1',base:20,iva:3}]};
 const p=prices.pricing([o],'2026-10-26').byName.get('YumYum');
 assert.equal(p.price,9);assert.equal(p.pricedQuantity,10);
 const v=stock.summarize([items[0]],[o],'2026-10-26');assert.equal(v.total,45);assert.equal(v.rows[0].price,9);
});
test('facturas parciales suman presentaciones una sola vez',()=>{
 const o=order();o.factura=null;o.entregas=[{numeroFactura:'F-1',items:[{name:'YumYum',qty:4}]},{numeroFactura:'F-2',items:[{name:'YumYum',qty:6}]}];
 const p=prices.pricing([o],'2026-10-26').byName.get('YumYum');assert.equal(p.price,9);assert.equal(p.pricedQuantity,10);
});
test('stock sin ventas no se valora a cero y no infla el total',()=>{
 const v=stock.summarize(items,[order()],'2026-10-26');assert.equal(v.knownTotal,45);assert.equal(v.total,null);assert.equal(v.missing,1);
 const empty=stock.summarize([{...items[1],stock:0}],[],'2026-10-26');assert.equal(empty.total,0);assert.equal(empty.missing,0);
});
test('margen bruto usa costo vigente por presentación y precio medio ponderado',async()=>{
 const sqls=[];const db={release(){},async query(sql){sqls.push(sql);if(sql.includes('FROM users'))return {rows:[{id:1,role:'gerente'}]};if(sql.includes('FROM catalogo'))return {rows:[product]};if(sql.includes('FROM inventario'))return {rows:sugar};if(sql.includes('FROM base_formulations'))return {rows:[recipe]};if(sql.includes('FROM pedidos'))return {rows:[order()]};return {rows:[]};}};
 const result=await costs.report({connect:async()=>db},1),r=result.rows[0];
 assert.equal(r.total,1);assert.equal(r.sale_price,9);assert.equal(r.gross_margin,8);assert.equal(r.gross_margin_pct,88.89);assert.equal(r.sold_quantity,10);
 assert.equal(sqls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('sin venta o con ficha incompleta el margen queda pendiente',async()=>{
 const noSales={release(){},async query(sql){if(sql.includes('FROM users'))return {rows:[{id:1,role:'gerente'}]};if(sql.includes('FROM catalogo'))return {rows:[product,{...product,id:2,nombre:'Sin venta',activo:false,ficha:{}}]};if(sql.includes('FROM inventario'))return {rows:sugar};if(sql.includes('FROM base_formulations'))return {rows:[recipe]};if(sql.includes('FROM pedidos'))return {rows:[order()]};return {rows:[]};}};
 const rows=(await costs.report({connect:async()=>noSales},1)).rows;
 assert.equal(rows[1].active,false);assert.equal(rows[1].sale_price,null);assert.equal(rows[1].gross_margin_pct,null);
});
test('endpoint de valoración respeta el acceso de bodega y rechaza facturación',async()=>{
 let role='bodega',queries=[];const db={release(){},async query(sql){queries.push(sql);if(sql.includes('FROM users'))return {rows:[{role}]};if(sql.includes('FROM inventario'))return {rows:[items[0]]};if(sql.includes('FROM pedidos'))return {rows:[order()]};return {rows:[]};}};
 const pool={connect:async()=>db};assert.equal((await stock.report(pool,1)).total,45);
 role='facturacion';queries=[];await assert.rejects(stock.report(pool,1),{status:403});assert.ok(!queries.some(s=>s.includes('FROM pedidos')));
});

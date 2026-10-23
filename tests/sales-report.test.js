'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Core=require('../lib/sales-report-core');
const order=(extra={})=>({id:1,num:'CT-1',fechaOrden:'01/10/2026',vendedor:'Ana',client:'Cliente',ruc:'001',ciudad:'Quito',state:'ENTREGADO',factura:'F1',products:[{name:'Yum 5kg',qty:10,price:10}],descuento:0,ivaTasa:15,...extra});
const report=orders=>Core.build(orders,'2026-10-01','2026-10-31');
test('promedio ponderado por producto y vendedor después de descuentos, sin IVA',()=>{
 const m=report([order({descuento:10}),order({id:2,factura:'F2',products:[{name:'Yum 5kg',qty:30,price:20}]}),order({id:3,vendedor:'Beto',factura:'F3',products:[{name:'Yum 5kg',qty:5,price:8}]})]);
 assert.equal(m.total.base,73000);assert.equal(m.total.iva,10950);assert.equal(m.sellerProducts.find(r=>r.seller==='Ana').average,17.25);assert.equal(m.products[0].average,730/45);assert.equal(m.total.orders,3);assert.equal(m.total.unallocated,0);
});
test('facturación parcial sin cabecera, productos repetidos y entregas pendientes',()=>{
 const m=report([order({factura:null,products:[{name:'Yum',qty:3,price:10},{name:'Yum',qty:7,price:20}],entregas:[{numeroFactura:'FP',items:[{name:'Yum',qty:2}]},{numeroFactura:'FP',items:[{name:'Yum',qty:1}]},{items:[{name:'Yum',qty:7}]}]})]);
 assert.equal(m.total.invoices,1);assert.equal(m.total.base,5100);assert.equal(m.products[0].qty,3);assert.equal(m.products[0].average,17);
});
test('descuento identificado se aplica al producto y NC global queda separada',()=>{
 const finanzas={events:[{id:'d',invoice:'F1',type:'CORRECCION',base:80,iva:12,lineDiscounts:[{name:'Yum 5kg',qty:10,base:100,net:80,discount:20}]},{id:'nc',invoice:'F1',type:'NC',base:10,iva:1.5}]};
 const m=report([order({finanzas})]);assert.equal(m.products[0].average,8);assert.equal(m.total.base,7000);assert.equal(m.total.unallocated,-1000);assert.equal(m.total.attributed+m.total.unallocated,m.total.base);assert.equal(m.warnings.length,1);
});
test('corrección global y reverso no inventan precios ni duplican NC',()=>{
 const m=report([order({finanzas:{events:[{id:'c',invoice:'F1',type:'CORRECCION',base:85,iva:0},{id:'n',invoice:'F1',type:'NC',base:20,iva:0},{id:'r',type:'REVERSO',target:'n'}]}})]);
 assert.equal(m.total.base,8500);assert.equal(m.total.iva,0);assert.equal(m.products[0].average,10);assert.equal(m.total.unallocated,-1500);
});
test('última corrección global no reutiliza un descuento anterior',()=>{
 const m=report([order({finanzas:{events:[{id:'d',invoice:'F1',type:'CORRECCION',base:80,iva:12,lineDiscounts:[{name:'Yum 5kg',qty:10,base:100,net:80}]},{id:'g',invoice:'F1',type:'CORRECCION',base:90,iva:13.5}]}})]);
 assert.equal(m.products[0].average,10);assert.equal(m.total.unallocated,-1000);
});
test('snapshot sin detalle o precio conserva ventas, sin asumir precio cero',()=>{
 const m=report([order({products:[],finanzas:{snapshots:[{numero:'F1',base:80,iva:12}]}})]);
 assert.equal(m.total.base,8000);assert.equal(m.products.length,0);assert.equal(m.total.unallocated,8000);assert.ok(m.warnings.some(r=>r.reason.includes('incompleto')));
 const missing=report([order({products:[{name:'Yum',qty:2}],finanzas:{snapshots:[{numero:'F1',base:80,iva:12}]}})]);assert.equal(missing.products[0].average,null);assert.equal(missing.products[0].pricedQty,0);
});
test('rango inclusivo y comparación de igual duración, incluyendo un solo día',()=>{
 const m=Core.build([order({fechaOrden:'31/10/2026'}),order({id:2,fechaOrden:'30/09/2026'}),order({id:3,fechaOrden:'01/11/2026'})],'2026-10-01','2026-10-31');
 assert.equal(m.days,31);assert.equal(m.priorFrom,'2026-08-31');assert.equal(m.priorTo,'2026-09-30');assert.equal(m.total.base,10000);assert.equal(m.previous.base,10000);assert.equal(m.change,0);assert.equal(Core.build([order()],'2026-10-01','2026-10-01').days,1);
});
test('semanas lunes-domingo, meses, períodos vacíos y sumas conciliadas',()=>{
 const m=Core.build([order({fechaOrden:'2026-10-01'}),order({id:2,fechaOrden:'05/10/2026'})],'2026-10-01','2026-11-02');
 assert.equal(m.weeks[0].key,'2026-09-28');assert.equal(m.weeks[0].partial,true);assert.equal(m.weeks[1].base,10000);assert.equal(m.weeks[2].base,0);assert.equal(m.months[1].partial,true);
 for(const rows of [m.sellers,m.weeks,m.months,m.sellerWeeks,m.sellerMonths,m.clients,m.cities])assert.equal(rows.reduce((s,r)=>s+r.base,0),m.total.base);
});
test('fechas inválidas, anulados, pendientes y clientes homónimos',()=>{
 const m=report([order(),order({id:2,ruc:'002'}),order({id:3,fechaOrden:'31/02/2026'}),order({id:4,state:'CANCELADO'}),order({id:5,factura:null})]);
 assert.equal(m.total.base,20000);assert.equal(m.total.clients,2);assert.equal(m.undated,1);assert.equal(m.cancelled,1);assert.throws(()=>Core.build([],'2026-02-31','2026-03-03'),/válido/);
});
test('vendedor sin ventas actuales aparece; crecimiento sin base es nulo',()=>{
 const m=report([order({fechaOrden:'30/09/2026',vendedor:'Anterior'}),order({vendedor:'Actual'})]);assert.equal(m.sellers.find(s=>s.key==='Anterior').change,-100);assert.equal(m.sellers.find(s=>s.key==='Actual').change,null);
});
test('centavos y varias facturas de un pedido conservan la suma sin duplicar pedidos',()=>{
 const m=report([order({descuento:17,products:[{name:'A',qty:3,price:0.17},{name:'B',qty:7,price:0.13}],factura:null,entregas:[{numeroFactura:'P1',items:[{name:'A',qty:1},{name:'B',qty:2}]},{numeroFactura:'P2',items:[{name:'A',qty:2},{name:'B',qty:5}]}]})]);
 assert.equal(m.total.orders,1);assert.equal(m.total.invoices,2);assert.equal(m.total.unallocated,0);assert.equal(m.products.reduce((s,r)=>s+r.base,0),m.total.base);
});
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
const render=html.slice(html.indexOf('function computeReportMetrics('),html.indexOf('/* ============================================================\n   PRODUCCIÓN Y LOGÍSTICA'));
function context(){const messages=[],tables=[],sheets=[],ctx=vm.createContext({CandySalesReport:Core,ORDERS:[order()],verTodo:()=>true,guardDouble:()=>false,releaseGuard(){},money:n=>'$'+n.toFixed(2),hoyStr:()=> '23/10/2026',toast:s=>messages.push(s),document:{getElementById:id=>({value:id==='rep_desde'?'2026-10-01':'2026-10-31'})},window:{},XLSX:{utils:{book_new:()=>({}),json_to_sheet:r=>({rows:r,'!ref':'A1:D3'}),book_append_sheet:(w,s,n)=>sheets.push({sheet:s,name:n})},writeFile:(w,n)=>{ctx.savedExcel=n;}}});
 class PDF{constructor(){this.lastAutoTable={finalY:25};this.page=1;}setFontSize(){}setTextColor(){}splitTextToSize(s){return [s];}text(){}addPage(){this.page++;}autoTable(t){tables.push(t);this.lastAutoTable.finalY=80;}getNumberOfPages(){return this.page;}setPage(){}save(n){ctx.savedPDF=n;}}
 ctx.window.jspdf={jsPDF:PDF};vm.runInContext(render,ctx);return {ctx,messages,tables,sheets};}
test('PDF y Excel incluyen todos los productos y vendedores y 15 hojas numéricas',()=>{
 const {ctx,tables,sheets}=context();ctx.ORDERS=Array.from({length:9},(_,i)=>order({id:i,ruc:'000'+i,vendedor:'Vendedor '+i,products:[{name:'Producto '+i,qty:1,price:i+1}]}));ctx.generarInformePDF();ctx.generarInformeExcel();
 assert.match(ctx.savedPDF,/Informe_Comercial/);assert.equal(sheets.length,15);assert.equal(sheets.find(s=>s.name==='Productos').sheet.rows.length,9);assert.equal(typeof sheets.find(s=>s.name==='Vendedores').sheet.rows[0]['Venta neta sin IVA'],'number');assert.equal(sheets.find(s=>s.name==='Clientes').sheet.rows[0].RUC,'0008');assert.equal(tables.find(t=>t.head[0][0]==='Vendedor').body.length,9);
});
test('permisos, dependencias faltantes y período vacío se manejan sin errores ocultos',()=>{
 const {ctx,messages}=context();ctx.verTodo=()=>false;ctx.generarInformePDF();assert.equal(ctx.savedPDF,undefined);assert.match(messages.pop(),/Solo Gerencia/);ctx.verTodo=()=>true;ctx.ORDERS=[];ctx.generarInformePDF();ctx.generarInformeExcel();assert.ok(ctx.savedPDF);assert.ok(ctx.savedExcel);ctx.window.jspdf=null;ctx.generarInformePDF();assert.match(messages.pop(),/librería PDF/);
});
test('modelo incrustado coincide con el probado y todos los scripts compilan',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/sales-report-core.js'),'utf8').trim();assert.equal(html.slice(html.indexOf('/* BEGIN SALES REPORT CORE */'),html.indexOf('/* END SALES REPORT CORE */')+'/* END SALES REPORT CORE */'.length),source);for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(s[1]);assert.match(html,/onclick="generarInformeExcel\(\)"/);
});

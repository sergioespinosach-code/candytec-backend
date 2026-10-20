'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8'),Finance=require('../lib/order-finance-core');
const order=(p={})=>({id:'P1',client:'Cliente Uno',ruc:'0123456789001',vendedor:'Ana',fechaOrden:'01/10/2026',factura:'F1',state:'ENTREGADO',products:[{name:'Yum',qty:10,price:10}],descuento:10,ivaTasa:15,...p});
function context(){const c=vm.createContext({CandyFinance:Finance,Intl,Date,money:n=>'$'+n.toFixed(2),verTodo:()=>true,ORDERS:[],renderView(){},financeEscape:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')});vm.runInContext(html.slice(html.indexOf('function parseFecha('),html.indexOf('const HOY =')),c);vm.runInContext(html.slice(html.indexOf("let vendFilter='todos'"),html.indexOf('function renderView(')),c);return c;}
test('lista clientes del vendedor y separa homónimos por RUC conservando ceros',()=>{
 const c=context(),orders=[order(),order({id:'P2',ruc:'0123456789002'}),order({id:'P3',vendedor:'Beto',client:'Cliente Dos'}),order({id:'P4',ruc:'0123456789-001',client:'Nombre corregido'})];
 const clients=c.orderCustomers(orders,'Ana');assert.equal(clients.length,2);assert.equal(clients.find(x=>x.key==='r:0123456789001').orders.length,2);assert.ok(!clients.some(x=>x.name==='Cliente Dos'));
 assert.equal(c.orderCustomerKey(order({ruc:'',client:'  José  Pérez '})),c.orderCustomerKey(order({ruc:null,client:'JOSE PEREZ'})));
});
test('total histórico y anual descuentan NC y correcciones e incluyen entregados pagados',()=>{
 const c=context(),a=order({pago:{estado:'pagado'}}),b=order({id:'P2',factura:'F2',fechaOrden:'01/01/2025',finanzas:{events:[{id:'c',invoice:'F2',type:'CORRECCION',base:80,iva:12},{id:'n',invoice:'F2',type:'NC',base:20,iva:3}]}});
 const s=c.orderCustomerTotals([a,b],2026);assert.equal(s.net,150);assert.equal(s.annual,90);assert.equal(s.pending,0);assert.equal(s.invoicedOrders,2);
});
test('facturación parcial separa unidades pendientes y una NC no las duplica',()=>{
 const c=context(),p=order({factura:null,entregas:[{numeroFactura:'FP',items:[{name:'Yum',qty:4}]}],finanzas:{events:[{id:'n',invoice:'FP',type:'NC',base:6,iva:.9}]}});
 const s=c.orderCustomerTotals([p],2026);assert.equal(s.net,30);assert.equal(s.pending,54);
 const fresh=c.orderCustomerTotals([order({factura:null,entregas:[]})],2026);assert.equal(fresh.net,0);assert.equal(fresh.pending,90);
});
test('líneas repetidas y entregas sin factura no duplican el pendiente; cancelados no se suman',()=>{
 const c=context();const p=order({factura:null,products:[{name:'Yum',qty:5,price:8},{name:'Yum',qty:5,price:12}],entregas:[{numeroFactura:'F1',items:[{name:'Yum',qty:2}]},{numeroFactura:'F1',items:[{name:'Yum',qty:2}]},{items:[{name:'Yum',qty:6}]}]});
 assert.equal(c.orderCustomerTotals([p],2026).pending,54);assert.equal(c.orderCustomerTotals([order({factura:null,state:'CANCELADO'})],2026).pending,0);
});
test('pedidos sin fecha solo suman histórico y los centavos se acumulan sin errores',()=>{
 const c=context(),s=c.orderCustomerTotals([order({fechaOrden:'',products:[{name:'Yum',qty:1,price:.1}],descuento:0}),order({products:[{name:'Yum',qty:1,price:.2}],descuento:0})],2026);assert.equal(s.net,.3);assert.equal(s.annual,.2);assert.equal(s.undated,1);
});
test('seleccionar cliente filtra pedidos y cambiar vendedor restablece todos sus clientes',()=>{
 const c=context();c.ORDERS=[order(),order({id:'P2',ruc:'2',client:'Otro'}),order({id:'P3',vendedor:'Beto'})];c.setVendFilter('Ana');c.setOrderCustomerFilter('r:0123456789001');assert.equal(c.porPedidoCliente(c.porVend(c.ORDERS)).length,1);
 c.setVendFilter('Beto');assert.equal(vm.runInContext('orderCustomerFilter',c),'');assert.equal(c.porPedidoCliente(c.porVend(c.ORDERS))[0].id,'P3');c.setOrderCustomerFilter('r:2');assert.equal(vm.runInContext('orderCustomerFilter',c),'');
});
test('resumen mantiene totales aunque la grilla esté filtrada y escapa nombres',()=>{
 const c=context();c.ORDERS=[order({client:'Cliente <script>',vendedor:'Ana "ventas"'}),order({id:'P2',client:'Cliente <script>',vendedor:'Ana "ventas"',state:'POR_ENTREGAR'})];c.setVendFilter('Ana "ventas"');c.setOrderCustomerFilter('r:0123456789001');
 const s=c.orderCustomerFilterHTML();assert.ok(s.includes('$180.00'));assert.ok(s.includes('Cliente &lt;script>'));assert.ok(s.includes('Ana &quot;ventas&quot;'));assert.ok(s.includes('independientes del buscador'));assert.equal(c.porPedidoCliente(c.ORDERS.filter(o=>o.state==='POR_ENTREGAR')).length,1);assert.equal(c.orderCustomerFilterHTML(),s);
});
test('no expone controles a vendedores y una selección obsoleta se limpia',()=>{
 const c=context();c.ORDERS=[order()];c.setOrderCustomerFilter('r:0123456789001');c.ORDERS=[];c.orderCustomerFilterHTML();assert.equal(vm.runInContext('orderCustomerFilter',c),'');c.verTodo=()=>false;assert.equal(c.orderCustomerFilterHTML(),'');c.setOrderCustomerFilter('r:1');assert.equal(vm.runInContext('orderCustomerFilter',c),'');
});
test('todos los clientes se ven por defecto y la integración conserva otros filtros',()=>{
 const c=context();c.ORDERS=[order(),order({id:'P2',ruc:'2'})];assert.equal(c.porPedidoCliente(c.ORDERS).length,2);
 assert.match(html,/baseFn:\(\)=>porPedidoCliente\(porVend\(stateBase\(\)\)\)/);assert.match(html,/baseFn:\(\)=>porVend\(ORDERS.filter\(o=>esCompletado/);
 for(const s of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(s[1]);
});

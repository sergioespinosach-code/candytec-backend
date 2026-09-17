const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../lib/order-reconciliation'),F=require('../lib/order-finance-core'),Route=require('../lib/order-finance');
const make=()=>({numero_pedido:'P1',estado:'ENTREGADO',factura:'F1',products:[{name:'Yum',qty:495,price:10}],subtotal:4950,descuento:0,iva_tasa:15,
 entregas:[{numeroFactura:'F1',items:[{name:'Yum',qty:495}],estado:'ENTREGADO',recibioNombre:'Cliente',attach:{url:'https://example.invalid/original.pdf'}}],pago:{abonos:[{monto:500}]},financial_data:{events:[],snapshots:[]},history:[]});
const input=(over={})=>({type:'CONCILIAR_PEDIDO',invoice:'F1',number:'F1',base:4000,iva:600,date:'2026-09-16',reason:'Corregir según factura contable',attachment:{name:'F1.pdf',url:'https://example.invalid/F1.pdf'},operation_key:'reconciliation-test-00001',lines:[{deliveryIndex:0,name:'Yum',qty:400,price:10}],...over});
const apply=(o,b=input())=>R.reconcile(o,b,{id:1,name:'Sergio',role:'gerente'},'2026-09-16T12:00:00Z');
test('corrige un pedido entregado 495 a 400, conserva pagos y estado, deja historial',()=>{
 const o=make(),before=JSON.stringify(o),next=apply(o);
 assert.equal(JSON.stringify(o),before);assert.equal(next.cantidad,'400 unidades');assert.equal(next.products[0].qty,400);
 assert.equal(next.entregas[0].items[0].qty,400);assert.equal(next.entregas[0].estado,'ENTREGADO');
 assert.equal(next.entregas[0].recibioNombre,'Cliente');assert.deepEqual(next.pago.abonos,o.pago.abonos);
 assert.equal(F.summary(next).net,4600);assert.equal(next.pago.saldo,4100);assert.equal(F.summary(next).original,5692.5);
 assert.equal(next.financial_data.events[0].before.products[0].qty,495);
 assert.equal(next.financial_data.events[0].after.products[0].qty,400);
});
test('corregir una factura parcial conserva cantidades pendientes y otra factura',()=>{
 const o=make();o.products=[{name:'Yum',qty:100,price:10}];o.subtotal=1000;
 o.entregas=[{numeroFactura:'F1',items:[{name:'Yum',qty:40}],estado:'ENTREGADO'},{numeroFactura:'F2',items:[{name:'Yum',qty:30}],estado:'POR_DESPACHAR'}];
 const next=apply(o,input({lines:[{deliveryIndex:0,name:'Yum',qty:20,price:12}],base:240,iva:36}));
 assert.equal(next.products.reduce((a,p)=>a+p.qty,0),80);
 assert.equal(next.entregas[1].items[0].qty,30);
 assert.equal(next.products.reduce((a,p)=>a+p.qty,0)-next.entregas.reduce((a,e)=>a+e.items[0].qty,0),30);
 assert.equal(F.summary(next).invoices.find(i=>i.numero==='F2').base,300);
 assert.equal(R.describe(next).invoices.find(i=>i.numero==='F1').lines[0].price,12);
});
test('permite cambiar productos sin crear pendientes falsos de los eliminados',()=>{
 const next=apply(make(),input({lines:[{deliveryIndex:0,name:'Cream',qty:10,price:20}],base:200,iva:0}));
 assert.equal(next.products.length,1);assert.equal(next.products[0].name,'Cream');
 assert.equal(next.entregas[0].items[0].name,'Cream');assert.equal(F.summary(next).iva,0);
});
test('preserva notas de crédito y detecta importes incompatibles',()=>{
 const o=make();o.financial_data=F.append(o,{...input(),type:'NC',number:'NC1',base:100,iva:15},{},'now');
 const next=apply(o,input({operation_key:'reconciliation-test-00002'}));
 assert.equal(F.summary(next).credits,115);assert.equal(F.summary(next).net,4485);
 assert.throws(()=>apply(o,input({base:50,iva:0})),/negativo/);
});
test('pedido antiguo sin entregas y segunda corrección',()=>{
 const o=make();o.entregas=[];
 const next=apply(o,input({lines:[{deliveryIndex:-1,name:'Yum',qty:400,price:10}]}));
 assert.equal(next.products[0].qty,400);assert.equal(next.entregas.length,0);
 const again=apply(next,input({operation_key:'reconciliation-test-00002',lines:[{deliveryIndex:-1,name:'Yum',qty:390,price:10}],base:3900,iva:585}));
 assert.equal(again.products[0].qty,390);assert.equal(F.summary(again).net,4485);
});
test('no permite atribuir cantidades a otra entrega ni números inválidos',()=>{
 assert.throws(()=>apply(make(),input({lines:[{deliveryIndex:1,name:'Yum',qty:10,price:1}]})),/no pertenece/);
 for(const qty of [0,-1,Infinity,'',true,1.001])assert.throws(()=>apply(make(),input({lines:[{deliveryIndex:0,name:'Yum',qty,price:10}]})));
});
function harness(role='gerente'){
 let row=make(),writes=0,commits=0,handler;
 const client={release(){},async query(sql,args){
  if(sql.startsWith('SELECT id,name'))return {rows:[{id:1,name:'Sergio',role}]};
  if(sql.startsWith('SELECT * FROM pedidos'))return {rows:[structuredClone(row)]};
  if(sql==='COMMIT'){commits++;return {rows:[]};}
  if(sql.startsWith('UPDATE pedidos')){
   assert.match(sql,/products=\$2::jsonb/);assert.equal(args[8],'P1');writes++;
   row={...row,financial_data:JSON.parse(args[0]),products:JSON.parse(args[1]),entregas:JSON.parse(args[2]),producto:args[3],cantidad:args[4],subtotal:args[5],history:JSON.parse(args[6]),pago:JSON.parse(args[7])};return {rows:[structuredClone(row)]};
  }
  if(sql.includes('inventario')||sql.includes('movimientos'))throw Error('No modificar inventario');
  return {rows:[]};
 }};
 Route.register({get(){},post(_p,_v,h){handler=h;}},{connect:async()=>client},()=>{});
 return {row:()=>row,writes:()=>writes,commits:()=>commits,async run(b){
  const res={code:200,status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
  await handler({params:{id:'P1'},user:{userId:1},body:b},res);return res;
 }};
}
test('ruta real guarda cantidades y finanzas juntas; reintentar no duplica',async()=>{
 const h=harness(),body={...input(),expected_token:Route.token(h.row())};
 const response=await h.run(body);assert.equal(response.code,200);assert.equal(response.body.pedido.cantidad,'400 unidades');
 assert.equal(response.body.summary.balance,4100);assert.equal(h.commits(),1);
 const retry=await h.run(body);assert.equal(retry.code,200);assert.equal(h.writes(),1);assert.equal(h.row().financial_data.events.length,1);
});
test('ruta valida rol y rechaza formularios obsoletos antes de guardar',async()=>{
 const forbidden=harness('vendedor');assert.equal((await forbidden.run(input())).code,403);assert.equal(forbidden.writes(),0);
 for(const role of ['gerente','facturacion']){
  const h=harness(role);assert.equal((await h.run({...input(),expected_token:'old'})).code,409);assert.equal(h.writes(),0);
  assert.equal((await h.run({...input(),expected_token:Route.token(h.row())})).code,200);
 }
});

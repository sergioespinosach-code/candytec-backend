const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../lib/order-finance-core'),R=require('../lib/order-reconciliation');
test('formulario recalcula, no confirma un fallo y reintenta con la misma operación',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8'),nodes={};
 const row={numero_pedido:'P1',products:[{name:'Yum',qty:495,price:10}],factura:'F1',estado:'ENTREGADO',entregas:[],descuento:0,iva_tasa:15,pago:{abonos:[{monto:500}]},financial_data:{events:[],snapshots:[]}};
 const data={pedido:row,summary:F.summary(row),correction:R.describe(row),token:'expected'};
 let calls=[],fail=true,opened;
 const context=vm.createContext({CandyFinance:F,CATALOGO:['Yum'],ORDERS:[{id:'P1',qty:'495 unidades'}],crypto:{randomUUID:()=> 'test-form-operation-00001'},
  document:{getElementById:id=>nodes[id]||(nodes[id]={value:'',textContent:'',innerHTML:'',disabled:false})},
  esFacturacion:()=>true,isGerente:()=>false,money:n=>String(n),
  apiPost:async(_url,b)=>{calls.push(b.operation_key);if(fail)throw Error('Conexión interrumpida');const pedido=R.reconcile(row,b,{name:'Test',role:'facturacion'},'now');return {pedido,summary:F.summary(pedido)};},
  mapPedido:p=>({...p,id:p.numero_pedido}),renderView(){},buildNav(){},openOrder:id=>{opened=id;},toast(){}});
 vm.runInContext(html.slice(html.indexOf('let financeEditor=null'),html.indexOf('/* ---- init ---- */')),context);
 context.data=data;
 vm.runInContext("financeEditor={id:'P1',data,pending:null,attachment:{name:'F1.pdf',url:'https://example.invalid/F1.pdf'}}",context);
 for(const [id,value] of Object.entries({f_type:'CONCILIAR_PEDIDO',f_invoice:'F1',f_date:'2026-09-16',f_reason:'Corregir según factura'}))context.document.getElementById(id).value=value;
 context.financeDefaults();context.reconciliationChange(0,'qty','400');
 assert.equal(nodes.f_base.value,'4000.00');assert.equal(nodes.f_iva.value,'600.00');
 await context.saveFinance();assert.equal(context.ORDERS[0].qty,'495 unidades');assert.equal(opened,undefined);
 assert.match(nodes.financeStatus.textContent,/Conexión interrumpida/);assert.equal(nodes.financeFields.disabled,true);
 fail=false;await context.saveFinance();assert.equal(opened,'P1');assert.equal(context.ORDERS[0].cantidad,'400 unidades');
 assert.deepEqual(calls,['test-form-operation-00001','test-form-operation-00001']);
});

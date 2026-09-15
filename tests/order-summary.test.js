const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const serverSummary=require('../lib/order-summary');

const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
const helper=html.slice(html.indexOf('function pedidoResumenProductos'),html.indexOf('function computeTotals'));
const browser=vm.createContext({});
vm.runInContext(helper,browser);

test('la cantidad visible se recalcula desde las líneas actuales',()=>{
  const products=[{name:'YumYum',qty:300},{name:'YumYum',qty:95},{name:'Cream',qty:25.5}];
  const result=browser.pedidoResumenProductos(products,'Dato viejo','495 unidades');
  assert.equal(result.product,'YumYum (+1 más)');
  assert.match(result.qty,/420[,.]5 unidades/);
  const order={product:'Dato viejo',qty:'495 unidades',products};
  browser.actualizarResumenPedido(order);
  assert.notEqual(order.qty,'495 unidades');
});

test('el servidor sincroniza los campos heredados con products',()=>{
  const result=serverSummary.summarize([{name:'YumYum',qty:300},{name:'YumYum',qty:95},{name:'Cream',qty:25.5}],{producto:'Viejo',cantidad:'495 unidades'});
  assert.deepEqual(result,{producto:'YumYum (+1 más)',cantidad:'420.5 unidades'});
});

test('pedidos antiguos sin detalle conservan su resumen anterior',()=>{
  assert.deepEqual(serverSummary.summarize(null,{producto:'Producto histórico',cantidad:'12 cajas'}),{producto:'Producto histórico',cantidad:'12 cajas'});
  assert.match(html,/function computeTotals\(o\)\{\s*actualizarResumenPedido\(o\)/);
});

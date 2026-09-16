const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
async function run(body,protect=()=>{}){
  let handler,write;
  const row={numero_pedido:'P1',products:[{name:'Yum',qty:495,price:10}],cantidad:'495 unidades',producto:'Yum',financial_data:{events:[],snapshots:[]}};
  const pool={query:async(sql,args)=>{
    if(sql.startsWith('SELECT'))return {rows:[row]};
    write={sql,args};
    return {rows:[{...row,products:JSON.parse(args[10]),producto:args[17],cantidad:args[18]}]};
  }};
  const start=server.indexOf("app.put('/api/pedidos/:id'");
  const end=server.indexOf('\n// ============================================================',start);
  vm.runInNewContext(server.slice(start,end),{app:{put:(_url,_auth,fn)=>{handler=fn;}},verifyToken(){},pool,orderFinance:{protect},orderSummary:require('../lib/order-summary')});
  const res={code:200,status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
  await handler({params:{id:'P1'},body},res);
  return {res,write};
}
test('PUT pedidos guarda las líneas nuevas y devuelve la cantidad actualizada',async()=>{
  const {res,write}=await run({products:[{name:'Yum',qty:338,price:10}]});
  assert.equal(res.code,200);assert.equal(res.body.cantidad,'338 unidades');
  assert.equal(res.body.products[0].qty,338);assert.equal(write.args[19],'P1');
  assert.match(write.sql,/cantidad=\$19/);
});
test('PUT parcial conserva los productos cuando solo cambia el estado',async()=>{
  const {res,write}=await run({estado:'POR_ENTREGAR'});
  assert.equal(res.code,200);assert.equal(res.body.cantidad,'495 unidades');
  assert.equal(write.args[1],'POR_ENTREGAR');
});
test('la protección financiera sigue impidiendo guardar cambios rechazados',async()=>{
  const {res,write}=await run({products:[]},()=>{throw Object.assign(new Error('Ajustes protegidos'),{status:409});});
  assert.equal(res.code,409);assert.equal(write,undefined);
});

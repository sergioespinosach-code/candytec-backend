'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Seller=require('../lib/order-seller'),Planner=require('../lib/planner-core');
const users=[{id:1,username:'gerente_proy',name:'Sergio',role:'gerente'},{id:2,username:'gerente',name:'Esteban',role:'gerente'},{id:3,username:'jventas',name:'Jefe',role:'jventas'},{id:4,username:'ana',name:'Ana',role:'vendedor'},{id:5,username:'beto',name:'Beto',role:'vendedor'},{id:6,username:'bodega',name:'Bodega',role:'bodega'}];
const initial=()=>({id:42,numero_pedido:'CT-42',vendedor:'Ana',estado:'ENTREGADO',factura:'F1',products:[{name:'Yum',qty:10,price:10}],pago:{estado:'pagado'},entregas:[{numeroFactura:'F1',estado:'ENTREGADO'}],financial_data:{events:[],snapshots:[]},history:[{s:'ENTREGADO',actor:'Bodega',t:'01/10/2026',note:'Entrega real'}]});
function dbMock(row=initial()){
  const state={row:structuredClone(row),audit:[],writes:[],users:structuredClone(users),released:0,failAudit:false};let snapshot;
  const db={release(){state.released++;},async query(sql,args=[]){
    if(sql==='BEGIN'){snapshot=structuredClone({row:state.row,audit:state.audit});return {rows:[]};}
    if(sql==='COMMIT')return {rows:[]};
    if(sql==='ROLLBACK'){if(snapshot)Object.assign(state,snapshot);return {rows:[]};}
    if(sql==='SELECT id,username,name,role FROM users WHERE id=$1')return {rows:state.users.filter(u=>u.id===Number(args[0]))};
    if(sql==='SELECT id FROM users WHERE name=$1')return {rows:state.users.filter(u=>u.name===args[0]).map(u=>({id:u.id}))};
    if(sql.startsWith('SELECT id,name,role FROM users'))return {rows:state.users.filter(u=>args[0].includes(u.role)).map(({id,name,role})=>({id,name,role}))};
    if(sql==='SELECT * FROM pedidos WHERE numero_pedido=$1 FOR UPDATE')return {rows:state.row?.numero_pedido===args[0]?[structuredClone(state.row)]:[]};
    if(sql==='UPDATE pedidos SET vendedor=$1, history=$2::jsonb WHERE id=$3 RETURNING *'){
      state.writes.push(sql);state.row.vendedor=args[0];state.row.history=JSON.parse(args[1]);return {rows:[structuredClone(state.row)]};
    }
    if(sql.startsWith('INSERT INTO business_audit')){if(state.failAudit)throw Error('audit unavailable');state.audit.push(args);return {rows:[]};}
    throw Error('SQL inesperado: '+sql);
  }};
  return {state,db,pool:{query:db.query,connect:async()=>db}};
}
test('gerentes y jefe eligen vendedor al crear; vendedor conserva su propia identidad',async()=>{
  const {pool}=dbMock();
  for(const id of [1,2,3])assert.equal((await Seller.creation(pool,id,{vendedor_id:5})).seller.name,'Beto');
  const own=await Seller.creation(pool,4,{vendedor:'Ana'});assert.equal(own.seller.name,'Ana');
  await assert.rejects(Seller.creation(pool,4,{vendedor:'Beto'}),{status:403});
  await assert.rejects(Seller.creation(pool,4,{vendedor_id:5}),{status:403});
});
test('listado autorizado contiene solo datos mínimos y valida destinos vigentes',async()=>{
  const {pool,state}=dbMock();const list=await Seller.options(pool,3);
  assert.ok(list.every(u=>Object.keys(u).sort().join(',')==='id,name,role'));
  assert.ok(!list.some(u=>u.role==='bodega'));await assert.rejects(Seller.options(pool,4),{status:403});
  for(const id of [0,'',-1,'x',1.5])await assert.rejects(Seller.creation(pool,1,{vendedor_id:id}),{status:400});
  await assert.rejects(Seller.creation(pool,1,{vendedor_id:6}),{status:400});
  await assert.rejects(Seller.creation(pool,1,{vendedor_id:99}));
  state.users.push({id:7,name:'Beto',role:'vendedor'});await assert.rejects(Seller.creation(pool,1,{vendedor_id:5}),{status:409});
});
test('solo Sergio reasigna pedidos, aunque el token anterior dijera otra cosa',async()=>{
  const {pool,state}=dbMock();
  for(const id of [2,3,4,6])await assert.rejects(Seller.reassign(pool,id,'CT-42',{vendedor_id:5,vendedor_anterior:'Ana'}),{status:403});
  state.users[0].role='vendedor';await assert.rejects(Seller.reassign(pool,1,'CT-42',{vendedor_id:5,vendedor_anterior:'Ana'}),{status:403});
  assert.equal(state.writes.length,0);
});
test('reasigna en cualquier estado conservando facturación, pagos, productos y entrega',async()=>{
  for(const estado of ['POR_FACTURAR','POR_ENTREGAR','EN_TRANSITO','ENTREGADO']){
    const before={...initial(),estado},mock=dbMock(before);
    const result=await Seller.reassign(mock.pool,1,'CT-42',{vendedor_id:5,vendedor_anterior:'Ana'});
    assert.equal(result.vendedor,'Beto');
    const {vendedor,history,...rest}=result;const {vendedor:old,history:oldHistory,...oldRest}=before;
    assert.deepEqual(rest,oldRest);assert.deepEqual(history.slice(0,-1),oldHistory);
    assert.equal(history.at(-1).actorId,1);assert.equal(history.at(-1).from,'Ana');assert.equal(history.at(-1).to,'Beto');
    assert.equal(mock.state.audit.length,1);assert.equal(mock.state.released,1);
  }
});
test('reintento no duplica auditoría y cambio simultáneo rechaza una ficha vieja',async()=>{
  const {pool,state}=dbMock(),body={vendedor_id:5,vendedor_anterior:'Ana'};
  await Seller.reassign(pool,1,'CT-42',body);await Seller.reassign(pool,1,'CT-42',body);
  assert.equal(state.audit.length,1);assert.equal(state.writes.length,1);
  await assert.rejects(Seller.reassign(pool,1,'CT-42',{vendedor_id:3,vendedor_anterior:'Ana'}),{status:409});
  await assert.rejects(Seller.reassign(pool,1,'CT-42',{vendedor_id:3}),{status:400});
  assert.equal(state.row.vendedor,'Beto');
});
test('fallo de auditoría revierte toda la asignación',async()=>{
  const {pool,state}=dbMock();state.failAudit=true;
  await assert.rejects(Seller.reassign(pool,1,'CT-42',{vendedor_id:5,vendedor_anterior:'Ana'}),/audit/);
  assert.deepEqual(state.row,initial());assert.equal(state.released,1);
});
test('cambiar vendedor no levanta un bloqueo de corrección pendiente en despachos',()=>{
  const row={...initial(),estado:'POR_FACTURAR',entregas:[],factura:null,history:[{devuelto:true},{kind:'SELLER_ASSIGNMENT'}]};
  assert.equal(Planner.sources([row],[])[0].blocked,'Devuelto para corrección');
});
const root=path.join(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8'),html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8');
test('POST guarda vendedor elegido e historial identifica al creador real',async()=>{
  let handler,params;const mock=dbMock();
  const pool={async query(sql,args){
    if(sql.startsWith('SELECT nextval'))return {rows:[{n:100}]};
    if(sql.startsWith('INSERT INTO pedidos')){params=args;return {rows:[{vendedor:args[13],history:JSON.parse(args[16])}]};}
    return mock.pool.query(sql,args);
  }};
  const start=server.indexOf("app.post('/api/pedidos',"),end=server.indexOf("app.put('/api/pedidos/:id'",start);
  vm.runInNewContext(server.slice(start,end),{app:{post:(_url,_auth,fn)=>handler=fn},verifyToken(){},pool,orderSeller:Seller});
  const res={status(code){this.code=code;return this;},json(body){this.body=body;}};
  await handler({user:{userId:3},body:{vendedor:'Jefe',vendedor_id:4,estado:'POR_FACTURAR',history:[{actor:'Falso',note:'Pedido creado con descuento.'}]}},res);
  assert.equal(params[13],'Ana');assert.equal(res.body.history[0].createdBy.id,3);assert.equal(res.body.history[0].actor,'Jefe · jventas');assert.match(res.body.history[0].note,/descuento/);
});
test('PUT general no permite cambiar vendedor ni borrar su historial de asignación',async()=>{
  let handler,writes=0;const row=initial();row.history.push({kind:'SELLER_ASSIGNMENT',operation:'a',from:'X',to:'Ana'});
  const pool={query:async sql=>{if(sql.startsWith('SELECT'))return {rows:[row]};writes++;return {rows:[row]};}};
  const start=server.indexOf("app.put('/api/pedidos/:id'"),end=server.indexOf('\n// ============================================================',start);
  vm.runInNewContext(server.slice(start,end),{app:{put:(_url,_auth,fn)=>handler=fn},verifyToken(){},pool,orderFinance:{protect(){}},orderSummary:require('../lib/order-summary')});
  for(const [body,expected] of [[{vendedor:'Beto'},403],[{vendedor_id:5},403],[{history:[]},409]]){
    const res={status(code){this.code=code;return this;},json(body){this.body=body;}};
    await handler({params:{id:'CT-42'},body},res);assert.equal(res.code,expected);
  }
  assert.equal(writes,0);assert.match(server,/history IS NOT DISTINCT FROM \$22::jsonb/);
});
function ui(){
  const nodes={change_order_seller:{value:'5',disabled:false},orderSellerError:{},orderSellerSave:{},f_order_seller:{},f_order_seller_status:{},f_order_seller_retry:{}};
  const order={id:'CT-42',vendedor:'Ana'};const c=vm.createContext({currentRole:'gerente_proy',isGerente:()=>true,isJefeVentas:()=>false,document:{getElementById:id=>nodes[id]},ORDERS:[order],mapPedido:r=>({id:r.numero_pedido,vendedor:r.vendedor}),closeModal(){},renderView(){},buildNav(){},openOrder(){},toast(){},financeEscape:s=>String(s).replace(/</g,'&lt;'),ROLE_KIND_META:{vendedor:{label:'Vendedor'}}});
  vm.runInContext(html.slice(html.indexOf('let sellerWriteVersion=0;'),html.indexOf('function viewNuevo(){')),c);
  vm.runInContext("sellerEdit={id:'CT-42',before:'Ana',busy:false}",c);
  return {c,nodes,order};
}
test('interfaz espera guardado, evita doble envío y actualiza vendedor solo al confirmar',async()=>{
  const {c,order}=ui();let resolve,calls=0;c.apiPost=async(url,body)=>{calls++;assert.equal(body.vendedor_anterior,'Ana');assert.equal(body.vendedor_id,5);return new Promise(r=>resolve=r);};
  const saving=c.saveOrderSeller();await c.saveOrderSeller();assert.equal(calls,1);assert.equal(order.vendedor,'Ana');
  resolve({numero_pedido:'CT-42',vendedor:'Beto'});await saving;assert.equal(order.vendedor,'Beto');
});
test('fallo visible permite reintentar y no altera el pedido local',async()=>{
  const {c,nodes,order}=ui();c.apiPost=async()=>{throw Error('Error de red');};await c.saveOrderSeller();
  assert.equal(order.vendedor,'Ana');assert.equal(nodes.orderSellerError.textContent,'Error de red');assert.equal(nodes.orderSellerSave.disabled,false);
  c.currentRole='jventas';let called=false;c.apiPost=async()=>{called=true;};await c.saveOrderSeller();assert.equal(called,false);
});
test('selector carga sin reiniciar el formulario y permite reintentar errores',async()=>{
  const {c,nodes}=ui();c.apiGet=async()=>{throw Error('Sin conexión');};await c.loadOrderSellers('f_order_seller');
  assert.equal(nodes.f_order_seller.disabled,true);assert.equal(nodes.f_order_seller_retry.hidden,false);
  c.apiGet=async()=>[{id:5,name:'Beto <sur>',role:'vendedor'}];await c.loadOrderSellers('f_order_seller');
  assert.equal(nodes.f_order_seller.disabled,false);assert.match(nodes.f_order_seller.innerHTML,/Beto &lt;sur>/);
});
test('scripts válidos y selector integrado en la creación',()=>{
  for(const s of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(s[1]);
  assert.ok(html.includes("canChooseOrderSeller()?orderSellerField('f_order_seller'):''"));
  assert.ok(html.includes('...(selectedSeller?{vendedor_id:Number(selectedSeller.value)}:{})'));
});

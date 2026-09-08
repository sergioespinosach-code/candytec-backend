const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const CandyPlanner=require('../lib/planner-core');
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
const code=html.slice(html.indexOf('const DP={'),html.indexOf('/* ---- init ---- */',html.indexOf('const DP={')));
function setup(){
  const orders=[
    {numero_pedido:'P1',cliente:'Norte <b>',ciudad:'Quito',estado:'POR_FACTURAR',products:[{name:'YumYum',qty:10},{name:'Cream',qty:4}],entregas:[],fecha_entrega:'2026-09-10'},
    {numero_pedido:'P2',cliente:'Sur',ciudad:'Cuenca',estado:'POR_FACTURAR',products:[{name:'YumYum',qty:6}],entregas:[],fecha_entrega:'2026-09-11'}
  ];
  const data={sources:CandyPlanner.sources(orders,[]),catalog:[{nombre:'YumYum',peso_bulto:5},{nombre:'Cream',peso_bulto:10}],inventory:[],plans:[],canEdit:true,asOf:'2026-09-08T12:00:00Z'};
  const ctx=vm.createContext({CandyPlanner,console,crypto:{randomUUID:()=> 'selection-test'},hoyISO:()=> '2026-09-08',currentView:'other',document:{getElementById:()=>null},window:{addEventListener(){}},confirm:()=>true,setTimeout,apiGet:async()=>JSON.parse(JSON.stringify(data))});
  vm.runInContext(code,ctx);const dp=vm.runInContext('DP',ctx);dp.data=data;dp.draft=ctx.dpNewDraft();
  return {ctx,dp,data,orders};
}
test('la selección suma productos y pesos por pedido y total, y permite quitar',()=>{
  const {ctx,dp}=setup();ctx.dpSelect('P1:pendiente');ctx.dpSelect('P2:pendiente');
  assert.equal(ctx.dpSummary().quantity,20);assert.equal(ctx.dpSummary().knownKg,120);
  assert.equal(ctx.dpSummary().rows.find(r=>r.name==='YumYum').qty,16);
  assert.deepEqual(Array.from(ctx.dpOrderTotals(dp.draft.paradas),p=>p.knownKg),[90,30]);
  ctx.dpQuantity(0,0,2);assert.equal(ctx.dpSummary().knownKg,100); // Cream first alphabetically
  ctx.dpToggle('P2:pendiente',false);assert.equal(ctx.dpSummary().knownKg,70);
});
test('los filtros conservan la selección y marcar disponibles no duplica',()=>{
  const {ctx,dp}=setup();dp.city='Quito';ctx.dpSelectVisible();ctx.dpSelectVisible();assert.equal(dp.draft.paradas.length,1);
  dp.city='Cuenca';const out=ctx.dpCandidatesHTML();assert.match(out,/Seleccionados fuera del filtro/);assert.match(out,/Norte &lt;b&gt;/);
  ctx.dpSelectVisible();assert.equal(dp.draft.paradas.length,2);
});
test('los documentos validan una selección sin guardar y no crean planes',async()=>{
  const {ctx,dp}=setup();ctx.dpSelect('P1:pendiente');assert.equal(dp.dirty,true);assert.equal(dp.draft.id,undefined);
  const doc=await ctx.dpDocument();assert.equal(doc.s.knownKg,90);assert.equal(doc.d.paradas[0].client,'Norte <b>');
  assert.equal(dp.data.plans.length,0);assert.equal(dp.draft.id,undefined);
});
test('los pesos desconocidos se identifican como incompletos',async()=>{
  const {ctx,data}=setup();data.catalog=data.catalog.filter(p=>p.nombre!=='Cream');ctx.dpSelect('P1:pendiente');
  const doc=await ctx.dpDocument();assert.equal(doc.s.knownKg,50);assert.deepEqual(Array.from(doc.s.missingWeights),['Cream']);assert.match(ctx.dpSummaryHTML(),/Peso incompleto/);
});
test('un pedido facturado después de seleccionarlo obliga a revisarlo',async()=>{
  const {ctx,data,orders}=setup();ctx.dpSelect('P1:pendiente');orders[0].entregas=[{numeroFactura:'F1',estado:'POR_DESPACHAR',items:[{name:'YumYum',qty:10}]}];data.sources=CandyPlanner.sources(orders,[]);
  await assert.rejects(ctx.dpDocument(),/Un pedido cambió/);
});
test('las cantidades asignadas a otro plan se descuentan y se revalidan al exportar',async()=>{
  const {ctx,data}=setup();ctx.dpSelect('P1:pendiente');
  const source=data.sources[0];data.plans=[{id:8,estado:'BORRADOR',paradas:[{...source,items:[{name:'YumYum',qty:8}]}]}];
  await assert.rejects(ctx.dpDocument(),/disponibles para planificar/);
});
test('se rechazan cambios de selección durante la consulta',async()=>{
  const {ctx,dp,data}=setup();ctx.dpSelect('P1:pendiente');let finish;ctx.apiGet=()=>new Promise(resolve=>finish=resolve);
  const pending=ctx.dpDocument();dp.draft.nombre='Otro nombre';finish(data);await assert.rejects(pending,/selección cambió/);
});
test('dos entregas del mismo pedido se agrupan sin duplicar la cantidad facturada',()=>{
  const {ctx,dp,data,orders}=setup();orders[0].entregas=[{numeroFactura:'F1',estado:'POR_DESPACHAR',items:[{name:'YumYum',qty:4}]}];data.sources=CandyPlanner.sources(orders,[]);
  ctx.dpSelect('P1:pendiente');ctx.dpSelect('P1:entrega:0');const rows=ctx.dpOrderTotals(dp.draft.paradas);
  assert.equal(rows.length,1);assert.equal(rows[0].quantity,14);assert.equal(rows[0].knownKg,90);
});
test('cantidades inválidas fallan y cantidades cero se excluyen del documento',async()=>{
  const {ctx}=setup();ctx.dpSelect('P1:pendiente');ctx.dpQuantity(0,0,-2);await assert.rejects(ctx.dpDocument(),/Cantidad inválida/);
  ctx.dpQuantity(0,0,0);const doc=await ctx.dpDocument();assert.equal(doc.s.quantity,10);assert.equal(doc.s.knownKg,50);
});
test('consulta permite calcular sin guardar pero mantiene planes archivados sin editar',async()=>{
  const {ctx,dp,data}=setup();data.canEdit=false;ctx.dpSelect('P1:pendiente');assert.equal(dp.draft.paradas.length,1);await ctx.dpDocument();
  dp.draft.id=1;dp.draft.estado='CERRADO';assert.equal(vm.runInContext('dpWritable()',ctx),false);
});
test('el HTML conserva sintaxis válida en todos sus scripts',()=>{
  for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});

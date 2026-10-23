/* BEGIN SALES REPORT CORE */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./order-finance-core'));else root.CandySalesReport=factory(root.CandyFinance);})(typeof globalThis!=='undefined'?globalThis:this,function(Finance){
  'use strict';
  const day=86400000,list=v=>Array.isArray(v)?v:[],cents=v=>Math.round(Number(v||0)*100),amount=v=>v/100;
  const text=(v,fallback)=>String(v??'').trim()||fallback;
  function date(value){
    const s=String(value||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m){const d=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(d)m=[d[0],d[3],d[2],d[1]];}
    if(!m)return null;const key=m[1]+'-'+m[2]+'-'+m[3],n=Date.parse(key+'T00:00:00Z');
    return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===key?key:null;
  }
  const iso=n=>new Date(n).toISOString().slice(0,10);
  function monday(key){const n=Date.parse(key+'T00:00:00Z'),d=new Date(n).getUTCDay();return iso(n-((d+6)%7)*day);}
  const percent=(a,b)=>b>0?(a-b)/b*100:null;
  function invoiceLines(order,invoice,summary){
    const sources=new Map(),quantities=new Map();
    list(order.products).forEach(p=>{
      const name=text(p.name,'Producto sin nombre'),r=sources.get(name)||{qty:0,gross:0,valid:true};
      const q=Number(p.qty),price=Number(p.price);
      if(!Number.isFinite(q)||q<0||p.price==null||p.price===''||!Number.isFinite(price)||price<0)r.valid=false;
      else{r.qty+=q;r.gross+=q*price;}sources.set(name,r);
    });
    const deliveries=list(order.entregas);
    const add=p=>{const name=text(p.name,'Producto sin nombre'),q=Number(p.qty);if(Number.isFinite(q)&&q>0)quantities.set(name,(quantities.get(name)||0)+q);};
    if(deliveries.length)deliveries.filter(e=>String(e.numeroFactura||'').trim()===String(invoice.numero)).forEach(e=>list(e.items).forEach(add));
    else if(String(order.factura||'').trim()===String(invoice.numero))list(order.products).forEach(add);
    let running=0,previous=0;
    const factor=1-Math.min(100,Math.max(0,Number(order.descuento||0)))/100;
    const rows=[...quantities].map(([name,qty])=>{
      const s=sources.get(name),price=s?.valid&&s.qty>0?s.gross/s.qty:null;
      if(price===null)return {name,qty,gross:null,base:null};
      running+=qty*price*factor;const rounded=cents(running),base=rounded-previous;previous=rounded;
      return {name,qty,gross:cents(qty*price),base};
    });
    const correction=list(summary.events).filter(e=>e.invoice===invoice.numero&&e.type==='CORRECCION'&&!summary.reversed.includes(e.id)).slice(-1)[0];
    const saved=list(correction?.lineDiscounts);
    // Solo se atribuyen correcciones cuyo desglose coincide con cantidades y base actuales.
    const valid=saved.length===rows.length&&rows.length>0&&rows.every(r=>{const matches=saved.filter(s=>s.name===r.name);const s=matches[0];return matches.length===1&&r.base!==null&&Number(s.qty)===r.qty&&cents(s.base)===r.base&&Number.isFinite(Number(s.net))&&Number(s.net)>=0;})&&saved.reduce((sum,r)=>sum+cents(r.net),0)===cents(invoice.base);
    if(valid)rows.forEach(r=>{r.base=cents(saved.find(s=>s.name===r.name).net);});
    return rows;
  }
  function build(orders,from,to){
    if(date(from)!==from||date(to)!==to||from>to)throw Error('Selecciona un rango de fechas válido.');
    const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z'),days=Math.round((end-start)/day)+1;
    if(days>3660)throw Error('Selecciona un período de hasta 10 años.');
    const priorFrom=iso(start-days*day),priorTo=iso(start-day),facts=[],lines=[],warnings=[];
    let undated=0,cancelled=0;
    list(orders).forEach((o,index)=>{
      if(['ANULADO','CANCELADO'].includes(o.state)){cancelled++;return;}
      const summary=Finance.summary(o);if(!summary.invoices.length)return;
      const when=date(o.fechaOrden);if(!when){undated++;return;}
      if(when<priorFrom||when>to)return;
      const seller=text(o.vendedor,'Sin vendedor'),client=text(o.client,'Sin cliente'),tax=text(o.ruc,'');
      const orderKey=String(o.id??('fila-'+index)),clientKey=tax?'r:'+tax:'n:'+client.toLocaleUpperCase('es');
      summary.invoices.forEach(inv=>{
        const detail=invoiceLines(o,inv,summary),attributed=detail.reduce((s,r)=>s+(r.base??0),0);
        const fact={orderKey,orderNumber:text(o.num||o.numero||o.codigo||o.id,'Sin número'),invoice:String(inv.numero),date:when,seller,client,clientKey,city:text(o.ciudad,'Sin ciudad'),state:text(o.state,''),original:cents(inv.originalBase),corrected:cents(inv.base),credits:cents(inv.ncBase),base:cents(inv.netBase),iva:cents(inv.netIva),total:cents(inv.total),attributed,unallocated:cents(inv.netBase)-attributed,qty:detail.reduce((s,r)=>s+r.qty,0),current:when>=from};
        facts.push(fact);
        if(!fact.current)return;
        detail.forEach(r=>lines.push({...r,orderKey,invoice:fact.invoice,date:when,seller,client}));
        if(fact.unallocated!==0)warnings.push({invoice:fact.invoice,seller,client,amount:amount(fact.unallocated),reason:'Ajuste global / nota de crédito / diferencia histórica sin desglose atribuible por producto'});
        if(detail.some(r=>r.base===null)||!detail.length)warnings.push({invoice:fact.invoice,seller,client,amount:0,reason:'Detalle o precio de productos incompleto; la venta neta sí se incluye'});
      });
    });
    const selected=facts.filter(f=>f.current),prior=facts.filter(f=>!f.current);
    function aggregate(items,keyFn){
      const groups=new Map();
      items.forEach(f=>{const key=keyFn(f);let g=groups.get(key);if(!g){g={key,base:0,iva:0,total:0,original:0,credits:0,corrected:0,attributed:0,unallocated:0,qty:0,invoices:0,orders:new Set(),clients:new Set()};groups.set(key,g);}
        for(const k of ['base','iva','total','original','credits','corrected','attributed','unallocated','qty'])g[k]+=f[k];g.invoices++;g.orders.add(f.orderKey);g.clients.add(f.clientKey);
      });
      return [...groups.values()].map(g=>({...g,orders:g.orders.size,clients:g.clients.size,ticket:g.orders.size?amount(g.base)/g.orders.size:0}));
    }
    const zero={base:0,iva:0,total:0,original:0,credits:0,corrected:0,attributed:0,unallocated:0,qty:0,invoices:0,orders:0,clients:0,ticket:0};
    const total=aggregate(selected,()=> 'Total')[0]||{...zero},previous=aggregate(prior,()=> 'Anterior')[0]||{...zero};
    const priorSeller=new Map(aggregate(prior,f=>f.seller).map(r=>[r.key,r.base]));
    const currentSeller=new Map(aggregate(selected,f=>f.seller).map(r=>[r.key,r]));
    const sellers=[...new Set([...currentSeller.keys(),...priorSeller.keys()])].map(key=>{const r=currentSeller.get(key)||{...zero,key};return {...r,previous:priorSeller.get(key)||0,change:percent(r.base,priorSeller.get(key)||0),share:total.base>0?r.base/total.base*100:0};}).sort((a,b)=>b.base-a.base||a.key.localeCompare(b.key,'es'));
    function products(keyFn){const map=new Map();lines.forEach(r=>{const key=keyFn(r);let g=map.get(key);if(!g){g={key,name:r.name,seller:r.seller,qty:0,pricedQty:0,gross:0,base:0,missing:0,min:null,max:null,orders:new Set()};map.set(key,g);}g.qty+=r.qty;g.orders.add(r.orderKey);if(r.base===null){g.missing++;return;}g.pricedQty+=r.qty;g.base+=r.base;g.gross+=r.gross;const unit=amount(r.base)/r.qty;g.min=g.min===null?unit:Math.min(g.min,unit);g.max=g.max===null?unit:Math.max(g.max,unit);});return [...map.values()].map(g=>({...g,orders:g.orders.size,average:g.pricedQty?amount(g.base)/g.pricedQty:null,grossAverage:g.pricedQty?amount(g.gross)/g.pricedQty:null})).sort((a,b)=>b.base-a.base||a.name.localeCompare(b.name,'es'));}
    function periods(kind){const key=f=>kind==='week'?monday(f.date):f.date.slice(0,7);const existing=new Map(aggregate(selected,key).map(r=>[r.key,r]));const keys=new Set();for(let n=start;n<=end;n+=day)keys.add(kind==='week'?monday(iso(n)):iso(n).slice(0,7));return [...keys].sort().map(k=>{const periodStart=kind==='week'?k:k+'-01';const periodEnd=kind==='week'?iso(Date.parse(k+'T00:00:00Z')+6*day):iso(Date.UTC(Number(k.slice(0,4)),Number(k.slice(5,7)),0));return {...(existing.get(k)||{...zero,key:k}),from:periodStart<from?from:periodStart,to:periodEnd>to?to:periodEnd,partial:periodStart<from||periodEnd>to};});}
    const clients=aggregate(selected,f=>f.clientKey).map(r=>({...r,name:selected.find(f=>f.clientKey===r.key).client})).sort((a,b)=>b.base-a.base);
    const cities=aggregate(selected,f=>f.city).sort((a,b)=>b.base-a.base);
    const series=kind=>aggregate(selected,f=>JSON.stringify([kind==='week'?monday(f.date):f.date.slice(0,7),f.seller])).map(r=>{const [period,seller]=JSON.parse(r.key);return {...r,period,seller};}).sort((a,b)=>a.period.localeCompare(b.period)||a.seller.localeCompare(b.seller,'es'));
    const notes=[
      'Fecha de agrupación: fecha del pedido, no fecha de emisión de la factura. Incluye lo facturado de esos pedidos hasta el momento de exportar.',
      'Ventas netas sin IVA = base corregida menos notas de crédito vigentes. Las correcciones y notas se reflejan en el período del pedido, no en su fecha contable.',
      'Precio promedio ponderado = importe del detalle después de descuentos / unidades con precio. La unidad es la presentación vendida (funda, caja, etc.), no necesariamente una pieza.',
      'Los ajustes globales sin desglose por producto se muestran separados. No se reparten entre productos ni modifican sus promedios. Las cantidades no descuentan devoluciones sin detalle de unidades.',
      'Semanas de lunes a domingo; las semanas y meses parciales solo suman fechas dentro del rango. Los períodos sin ventas aparecen con cero.',
      'Vendedor y cliente corresponden a la asignación actual del pedido. Se incluyen todas las filas, sin limitar a los cinco primeros.'
    ];
    if(undated)notes.push(undated+' pedidos facturados sin fecha válida excluidos de los períodos.');
    if(cancelled)notes.push(cancelled+' pedidos anulados/cancelados excluidos.');
    return {from,to,priorFrom,priorTo,days,total,previous,change:percent(total.base,previous.base),sellers,products:products(r=>r.name),sellerProducts:products(r=>JSON.stringify([r.seller,r.name])),weeks:periods('week'),months:periods('month'),sellerWeeks:series('week'),sellerMonths:series('month'),clients,cities,facts:selected,lines,warnings,notes,undated,cancelled};
  }
  return {build,date,monday,invoiceLines};
});
/* END SALES REPORT CORE */

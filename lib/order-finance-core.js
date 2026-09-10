/* BEGIN ORDER FINANCE CORE */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CandyFinance=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const list=v=>Array.isArray(v)?v:[], cents=v=>Math.round(Number(v||0)*100), amount=v=>v/100;
  function invoices(o){
    const products=list(o.products),price=new Map();
    products.forEach(p=>{const r=price.get(p.name)||{qty:0,value:0};r.qty+=Number(p.qty||0);r.value+=Number(p.qty||0)*Number(p.price||0);price.set(p.name,r);});
    const gross=products.reduce((s,p)=>s+Number(p.qty||0)*Number(p.price||0),0),factor=1-Math.min(100,Math.max(0,Number(o.descuento||0)))/100;
    const rate=Number(o.iva_tasa??o.ivaTasa??15),groups=new Map(),deliveries=list(o.entregas);
    if(deliveries.length){
      deliveries.forEach(e=>{if(!e.numeroFactura)return;const key=String(e.numeroFactura).trim();let value=0;
        list(e.items).forEach(i=>{const p=price.get(i.name);value+=Number(i.qty||0)*(p&&p.qty?p.value/p.qty:0);});
        groups.set(key,(groups.get(key)||0)+value);
      });
    }else if(o.factura)groups.set(String(o.factura).trim(),gross||Number(o.subtotal||0));
    return [...groups].map(([numero,value])=>{const base=cents(value*factor);return {numero,base:amount(base),iva:amount(Math.round(base*rate/100))};});
  }
  function summary(o){
    const data=o.financial_data||o.finanzas||{},events=list(data.events),snapshots=list(data.snapshots);
    const reversed=new Set(events.filter(e=>e.type==='REVERSO').map(e=>e.target));
    const live=events.filter(e=>e.type!=='REVERSO'&&!reversed.has(e.id));
    const source=invoices(o),byNumber=new Map(source.map(i=>[i.numero,i]));
    snapshots.forEach(i=>byNumber.set(i.numero,i));
    let original=0,corrected=0,credit=0,baseNet=0,ivaNet=0;
    const rows=[...byNumber.values()].map(i=>{
      let base=cents(i.base),iva=cents(i.iva),ncBase=0,ncIva=0;
      live.filter(e=>e.invoice===i.numero).forEach(e=>{if(e.type==='CORRECCION'){base=cents(e.base);iva=cents(e.iva);}else if(e.type==='NC'){ncBase+=cents(e.base);ncIva+=cents(e.iva);}});
      original+=cents(i.base)+cents(i.iva);corrected+=base+iva;credit+=ncBase+ncIva;baseNet+=base-ncBase;ivaNet+=iva-ncIva;
      return {numero:i.numero,originalBase:Number(i.base),originalIva:Number(i.iva),base:amount(base),iva:amount(iva),ncBase:amount(ncBase),ncIva:amount(ncIva),netBase:amount(base-ncBase),netIva:amount(iva-ncIva),total:amount(base+iva-ncBase-ncIva)};
    });
    const paid=list(o.pago?.abonos).reduce((s,a)=>s+cents(a.monto),0),net=baseNet+ivaNet;
    return {invoices:rows,original:amount(original),corrections:amount(corrected-original),credits:amount(credit),base:amount(baseNet),iva:amount(ivaNet),net:amount(net),paid:amount(paid),balance:amount(Math.max(0,net-paid)),creditBalance:amount(Math.max(0,paid-net)),events,reversed:[...reversed]};
  }
  function moneyInput(v){
    if(v==null||v===''||typeof v==='boolean')throw Error('Ingresa base e IVA; usa 0 cuando no corresponda.');
    const n=Number(v);if(!Number.isFinite(n)||n<0||n>=1e8||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('Los importes deben ser positivos o cero, con hasta dos decimales.');return amount(cents(n));
  }
  function append(o,input,actor,now){
    const data=JSON.parse(JSON.stringify(o.financial_data||{events:[],snapshots:[]}));data.events=list(data.events);data.snapshots=list(data.snapshots);
    if(!['NC','CORRECCION','REVERSO'].includes(input.type))throw Error('Tipo de ajuste inválido.');
    const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max;
    if(!text(input.reason,2000))throw Error('Indica el motivo del ajuste.');
    if(!text(input.operation_key,100)||!/^[a-zA-Z0-9_-]{16,100}$/.test(input.operation_key))throw Error('Identificador inválido.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!Number.isFinite(Date.parse(input.date+'T00:00:00Z'))||new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)!==input.date)throw Error('Fecha inválida.');
    const event={id:input.operation_key,type:input.type,reason:input.reason.trim(),date:input.date,actor,createdAt:now};
    if(input.type==='REVERSO'){
      const target=data.events.find(e=>e.id===input.target&&e.type!=='REVERSO');
      if(!target||data.events.some(e=>e.type==='REVERSO'&&e.target===target.id))throw Error('El ajuste no existe o ya está revertido.');
      Object.assign(event,{target:target.id,invoice:target.invoice});
    }else{
      if(!text(input.invoice,255))throw Error('Selecciona una factura.');
      const invoice=summary(o).invoices.find(i=>i.numero===input.invoice);if(!invoice)throw Error('La factura ya no pertenece al pedido. Actualiza los datos.');
      if(!data.snapshots.some(i=>i.numero===input.invoice))data.snapshots.push({numero:invoice.numero,base:invoice.originalBase,iva:invoice.originalIva});
      if(!text(input.number,100))throw Error('Ingresa el número del documento de respaldo.');
      if(!input.attachment||typeof input.attachment.name!=='string'||!/^https:\/\//i.test(input.attachment.url||''))throw Error('Adjunta el documento emitido en el sistema contable.');
      Object.assign(event,{invoice:input.invoice,number:input.number.trim(),base:moneyInput(input.base),iva:moneyInput(input.iva),attachment:{name:input.attachment.name.slice(0,255),url:input.attachment.url}});
      if(event.type==='NC'&&event.base+event.iva===0)throw Error('La nota de crédito debe tener un valor mayor que cero.');
      if(event.type==='NC'&&data.events.some(e=>e.type==='NC'&&e.number?.toUpperCase()===event.number.toUpperCase()&&!data.events.some(r=>r.type==='REVERSO'&&r.target===e.id)))throw Error('Esta nota de crédito ya está registrada en el pedido.');
    }
    data.events.push(event);
    const next=summary({...o,financial_data:data});
    if(next.invoices.some(i=>i.netBase<0||i.netIva<0))throw Error('El ajuste deja la base o el IVA de una factura en negativo. Revisa las notas de crédito y sus importes.');
    return data;
  }
  return {invoices,summary,append,moneyInput};
});
/* END ORDER FINANCE CORE */

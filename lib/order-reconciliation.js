'use strict';
const Finance=require('./order-finance-core');
const Summary=require('./order-summary');
const list=v=>Array.isArray(v)?v:[];
const round=v=>Math.round(v*100)/100;
const invoiceOf=e=>String(e.numeroFactura||'').trim();
function describe(row){
  const groups=new Map(),products=list(row.products);
  products.forEach(p=>{
    const x=groups.get(p.name)||{qty:0,value:0};
    x.qty+=Number(p.qty);x.value+=Number(p.qty)*Number(p.price);groups.set(p.name,x);
  });
  const price=name=>{const x=groups.get(name);return x?.qty?x.value/x.qty:0;};
  const deliveries=list(row.entregas);
  const invoices=Finance.summary(row).invoices.map(invoice=>{
    const lines=deliveries.length?deliveries.flatMap((e,index)=>invoiceOf(e)===invoice.numero?list(e.items).map(it=>({deliveryIndex:index,name:it.name,qty:Number(it.qty),price:round(price(it.name))})):[]):products.map(p=>({deliveryIndex:-1,name:p.name,qty:Number(p.qty),price:round(Number(p.price))}));
    const prior=list(row.financial_data?.events).filter(e=>e.invoice===invoice.numero&&e.subtype==='CONCILIACION_PEDIDO').at(-1);
    return {...invoice,lines:prior?.invoiceLines||lines};
  });
  return {invoices,deliveries:deliveries.map((e,index)=>({index,invoice:invoiceOf(e),state:e.estado})),discount:Number(row.descuento||0)};
}
function reconcile(row,input,actor,now){
  const invoices=Finance.summary(row).invoices;
  const invoice=invoices.find(i=>i.numero===input.invoice);
  if(!invoice)throw Error('Selecciona una factura vigente.');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>250)throw Error('Incluye de 1 a 250 líneas.');
  const deliveries=list(row.entregas),indexes=deliveries.length?deliveries.flatMap((e,i)=>invoiceOf(e)===input.invoice?[i]:[]):[-1];
  if(!indexes.length)throw Error('No se encontró la entrega de esa factura.');
  const lines=input.lines.map(line=>{
    if(!Number.isInteger(line.deliveryIndex)||!indexes.includes(line.deliveryIndex))throw Error('La entrega no pertenece a la factura seleccionada.');
    if(typeof line.name!=='string'||!line.name.trim()||line.name.length>255)throw Error('Revisa el nombre del producto.');
    const qty=Finance.moneyInput(line.qty),price=Finance.moneyInput(line.price);
    if(qty<=0)throw Error('La cantidad debe ser mayor a cero; quita la línea si no corresponde.');
    if(qty*price>=1e8)throw Error('El valor de una línea supera el límite.');
    return {deliveryIndex:line.deliveryIndex,name:line.name.trim(),qty,price,desc:''};
  });
  for(const index of indexes)if(!lines.some(l=>l.deliveryIndex===index))throw Error('Conserva al menos un producto por entrega. Este formulario no anula entregas.');
  const before=JSON.parse(JSON.stringify({products:row.products,entregas:row.entregas,subtotal:row.subtotal}));
  const next=JSON.parse(JSON.stringify(row));
  if(!deliveries.length){
    next.products=lines.map(({deliveryIndex,...p})=>p);
  }else{
    // Keep all unbilled quantities and all other invoices; replace only the selected invoice's part.
    const oldSelected=new Map(),totalBilled=new Map();
    deliveries.forEach(e=>list(e.items).forEach(it=>{
      totalBilled.set(it.name,round((totalBilled.get(it.name)||0)+Number(it.qty)));
      if(invoiceOf(e)===input.invoice)oldSelected.set(it.name,round((oldSelected.get(it.name)||0)+Number(it.qty)));
    }));
    const ordered=new Map();
    list(row.products).forEach(p=>ordered.set(p.name,round((ordered.get(p.name)||0)+Number(p.qty))));
    for(const [name,qty] of totalBilled)if(qty>(ordered.get(name)||0)+0.005)throw Error('Las entregas ya superan el pedido para '+name+'. Revisa esa inconsistencia antes de conciliar.');
    next.products=[];
    // Subtract billed quantities proportionally from duplicate order lines, preserving their prices.
    const removed=new Map(),processed=new Map();
    list(row.products).forEach((p,index,all)=>{
      const selected=oldSelected.get(p.name)||0,total=ordered.get(p.name)||0;
      const isLast=!all.slice(index+1).some(x=>x.name===p.name);
      const remaining=round(selected-(removed.get(p.name)||0)),remainingQty=round(total-(processed.get(p.name)||0));
      const take=isLast?remaining:Math.min(Number(p.qty),remaining,round(remaining*Number(p.qty)/(remainingQty||1)));
      processed.set(p.name,round((processed.get(p.name)||0)+Number(p.qty)));
      removed.set(p.name,round((removed.get(p.name)||0)+take));
      const qty=round(Number(p.qty)-take);
      if(qty>0)next.products.push({...p,qty});
    });
    next.products.push(...lines.map(({deliveryIndex,...p})=>p));
    indexes.forEach(index=>{
      const grouped=new Map();
      lines.filter(l=>l.deliveryIndex===index).forEach(l=>grouped.set(l.name,round((grouped.get(l.name)||0)+l.qty)));
      next.entregas[index].items=[...grouped].map(([name,qty])=>({name,qty}));
    });
  }
  next.subtotal=round(next.products.reduce((sum,p)=>sum+Number(p.qty)*Number(p.price),0));
  if(!Number.isFinite(next.subtotal)||next.subtotal>=1e8)throw Error('El total del pedido supera el límite.');
  // Pin every invoice before prices/quantities change so other invoices cannot be repriced accidentally.
  const data=JSON.parse(JSON.stringify(row.financial_data||{events:[],snapshots:[]}));
  data.snapshots=list(data.snapshots);data.events=list(data.events);
  invoices.forEach(i=>{if(!data.snapshots.some(s=>s.numero===i.numero))data.snapshots.push({numero:i.numero,base:i.originalBase,iva:i.originalIva});});
  next.financial_data=data;
  next.financial_data=Finance.append(next,{...input,type:'CORRECCION'},actor,now);
  const event=next.financial_data.events.at(-1);
  event.subtype='CONCILIACION_PEDIDO';event.invoiceLines=lines;
  event.before=before;event.after=JSON.parse(JSON.stringify({products:next.products,entregas:next.entregas,subtotal:next.subtotal}));
  Object.assign(next,Summary.summarize(next.products,next));
  next.history=[...list(next.history),{s:next.estado,actor:actor.name+' · '+actor.role,t:now,note:'Pedido conciliado con factura '+input.invoice+'. '+input.reason.trim()+' Se corrigieron productos/cantidades del registro; revisar movimientos físicos de bodega por separado.'}];
  if(next.pago){
    const s=Finance.summary(next);
    Object.assign(next.pago,{cobrado:s.paid,saldo:s.balance,saldoFavor:s.creditBalance,estado:s.balance<=0.005?'pagado':s.paid?'parcial':'pendiente'});
  }
  return next;
}
module.exports={describe,reconcile};

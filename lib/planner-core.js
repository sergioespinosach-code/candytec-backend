/* Shared pure rules. Also embedded in index.html by the release builder. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.CandyPlanner=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const active=p=>['BORRADOR','PLANIFICADO'].includes(p.estado);
  const arr=v=>Array.isArray(v)?v:[];
  const number=v=>Number.isFinite(Number(v))?Number(v):0;
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  function quantities(items,nameKey='name'){
    const m=new Map();
    arr(items).forEach(p=>{const name=String(p[nameKey]||'');if(name)m.set(name,round((m.get(name)||0)+number(p.qty)));});
    return m;
  }
  function sources(orders,clients){
    const out=[];
    arr(orders).forEach(o=>{
      const products=quantities(o.products), deliveries=arr(o.entregas);
      const c=arr(clients).find(c=>o.ruc&&c.ruc===o.ruc)||{};
      const common={orderId:o.numero_pedido,client:o.cliente||'',ruc:o.ruc||'',city:o.ciudad||'',sector:c.sector||'',address:o.direccion_entrega||'',vendor:o.vendedor||'',dueDate:o.fecha_entrega instanceof Date?[o.fecha_entrega.getFullYear(),String(o.fecha_entrega.getMonth()+1).padStart(2,'0'),String(o.fecha_entrega.getDate()).padStart(2,'0')].join('-'):(o.fecha_entrega?String(o.fecha_entrega).slice(0,10):''),blocked:arr(o.history).slice(-1)[0]?.devuelto?'Devuelto para corrección':''};
      function add(key,kind,status,items,invoice,index){
        items=items.filter(x=>x.qty>0).sort((a,b)=>a.name.localeCompare(b.name,'es'));
        if(!items.length)return;
        const s={...common,key,kind,status,items,invoice:invoice||'',deliveryIndex:index};
        s.signature=JSON.stringify([s.orderId,s.kind,s.status,s.invoice,s.client,s.ruc,s.vendor,s.address,s.city,s.sector,s.dueDate,s.blocked,s.items]);
        out.push(s);
      }
      deliveries.forEach((e,i)=>add(o.numero_pedido+':entrega:'+i,'entrega',e.estado,[...quantities(e.items)].map(([name,qty])=>({name,qty})),e.numeroFactura,i));
      if(!deliveries.length&&['POR_ENTREGAR','EN_TRANSITO','ENTREGADO'].includes(o.estado))add(o.numero_pedido+':pedido','pedido',o.estado==='POR_ENTREGAR'?'POR_DESPACHAR':o.estado,[...products].map(([name,qty])=>({name,qty})),o.factura,null);
      if(o.estado==='ENTREGADO'||(!deliveries.length&&o.estado!=='POR_FACTURAR'))return;
      const billed=quantities(deliveries.flatMap(e=>arr(e.items)));
      add(o.numero_pedido+':pendiente','pendiente','POR_FACTURAR',[...products].map(([name,qty])=>({name,qty:Math.max(0,round(qty-(billed.get(name)||0)))})),'',null);
    });
    return out;
  }
  const selectable=s=>s&&['POR_FACTURAR','POR_DESPACHAR'].includes(s.status);
  const itemKey=(source,name)=>JSON.stringify([source,name]);
  function allocated(plans,excludeId){
    const m=new Map();
    arr(plans).filter(p=>active(p)&&String(p.id)!==String(excludeId)).forEach(p=>arr(p.paradas).forEach(s=>arr(s.items).forEach(i=>{
      const key=itemKey(s.key,i.name);m.set(key,round((m.get(key)||0)+number(i.qty)));
    })));
    return m;
  }
  function candidates(all,plans,excludeId){
    const taken=allocated(plans,excludeId);
    const index=new Map(arr(all).map(s=>[s.key,s])), review=new Map();
    arr(plans).filter(p=>active(p)&&String(p.id)!==String(excludeId)).forEach(p=>arr(p.paradas).forEach(stop=>{
      const now=index.get(stop.key);
      if(!now||(selectable(now)&&now.signature!==stop.signature))review.set(stop.orderId,p.id);
    }));
    return arr(all).filter(selectable).map(s=>({...s,blocked:s.blocked||(review.has(s.orderId)?'Actualizar primero el plan #'+review.get(s.orderId)+' de este pedido':'') ,items:s.items.map(i=>({...i,available:Math.max(0,round(i.qty-(taken.get(itemKey(s.key,i.name))||0)))}))}));
  }
  function summarize(stops,catalog,inventory,plans,excludeId,all){
    const demand=new Map(),other=new Map();
    arr(stops).forEach(s=>arr(s.items).forEach(i=>demand.set(i.name,round((demand.get(i.name)||0)+number(i.qty)))));
    const byKey=new Map(arr(all).map(s=>[s.key,s]));
    arr(plans).filter(p=>active(p)&&String(p.id)!==String(excludeId)).forEach(p=>arr(p.paradas).forEach(s=>{
      if(!selectable(byKey.get(s.key)))return;
      arr(s.items).forEach(i=>other.set(i.name,round((other.get(i.name)||0)+number(i.qty))));
    }));
    const rows=[...demand].sort((a,b)=>a[0].localeCompare(b[0],'es')).map(([name,qty])=>{
      const product=arr(catalog).find(p=>p.nombre===name);
      const weight=product&&number(product.peso_bulto)>0?number(product.peso_bulto):null;
      const stock=arr(inventory).filter(i=>i.tipo==='producto_terminado'&&i.nombre===name).reduce((s,i)=>s+number(i.stock),0);
      const elsewhere=other.get(name)||0, available=Math.max(0,round(stock-elsewhere));
      return {name,qty,weight,kg:weight===null?null:round(qty*weight),stock,elsewhere,available,shortage:Math.max(0,round(qty-available))};
    });
    return {rows,knownKg:round(rows.reduce((s,r)=>s+(r.kg||0),0)),missingWeights:rows.filter(r=>r.weight===null).map(r=>r.name),shortages:rows.filter(r=>r.shortage>0),quantity:round(rows.reduce((s,r)=>s+r.qty,0))};
  }
  function validateStops(input,all,plans,excludeId){
    if(!Array.isArray(input)||!input.length||input.length>250)throw Error('Selecciona entre 1 y 250 entregas o pedidos.');
    const byKey=new Map(candidates(all,plans,excludeId).map(s=>[s.key,s]));
    const seen=new Set();
    return input.map(row=>{
      const source=byKey.get(row.key);
      if(!source)throw Error('El pedido o entrega '+row.key+' cambió de estado. Retíralo y selecciona su entrega actual.');
      if(source.blocked)throw Error(source.orderId+': '+source.blocked+'.');
      if(seen.has(row.key))throw Error('Una entrega está repetida en el plan.');seen.add(row.key);
      if(!Array.isArray(row.items)||!row.items.length)throw Error('Selecciona cantidades para '+source.orderId+'.');
      const names=new Set();
      const items=row.items.map(i=>{
        const original=source.items.find(p=>p.name===i.name),qty=Number(i.qty);
        if(!original||names.has(i.name))throw Error('Producto inválido o repetido en '+source.orderId+'.');names.add(i.name);
        if(!Number.isFinite(qty)||qty<=0||Math.abs(qty-round(qty))>0.000001)throw Error('Cantidad inválida en '+source.orderId+'. Usa hasta 2 decimales.');
        if(qty>original.available+0.000001)throw Error(source.orderId+': '+i.name+' tiene '+original.available+' disponibles para planificar.');
        return {name:i.name,qty:round(qty)};
      });
      // An existing invoice travels as one delivery; partial picking happens before invoicing.
      if(source.kind!=='pendiente'&&(items.length!==source.items.length||items.some(i=>i.qty!==source.items.find(p=>p.name===i.name).qty)))throw Error('La entrega facturada '+source.invoice+' debe planificarse completa.');
      const {items:ignored,...snapshot}=source;
      return {...snapshot,items};
    });
  }
  function issues(plan,all){
    const index=new Map(arr(all).map(s=>[s.key,s]));
    return arr(plan.paradas).map(s=>{
      const now=index.get(s.key);
      if(now&&['EN_TRANSITO','ENTREGADO'].includes(now.status))return {key:s.key,status:now.status,changed:false};
      return {key:s.key,status:now?.status||'REVISAR',changed:!now||now.signature!==s.signature,blocked:now?.blocked||''};
    });
  }
  return {active,number,round,sources,selectable,allocated,candidates,summarize,validateStops,issues};
});

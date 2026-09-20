'use strict';
const CATEGORIES=['Marketing','Comisiones','Viáticos','Transporte y despachos','Servicios básicos','Arriendo','Sueldos y honorarios','Mantenimiento','Suministros','Otros'];
const AREAS=['Ventas','Marketing','Producción','Administración','Despachos'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function text(v,label,max=250,required=true){if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))throw fail(label+' inválido.');return v.trim();}
function num(v,label,min=0,max=1e9){if(v==null||v===''||!['number','string'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)throw fail(label+' inválido.');return Number(v);}
function id(v){const n=num(v,'Identificador',1);if(!Number.isSafeInteger(n))throw fail('Identificador inválido.');return n;}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number(v.slice(0,4))<2000||Number(v.slice(0,4))>2200||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw fail('Fecha inválida.');return v;}
function choice(v,values,label){if(!values.includes(v))throw fail(label+' inválido.');return v;}
const round=(v,d=6)=>Math.round((v+Number.EPSILON)*10**d)/10**d;
function unit(v){const u=String(v||'').trim().toLowerCase();return ({kilogramo:'kg',kilogramos:'kg',gramos:'g',gramo:'g',litros:'l',litro:'l',unidades:'u',unidad:'u',und:'u',uds:'u'})[u]||u;}
function convert(q,from,to){const a=unit(from),b=unit(to);if(!a||!b)throw fail('Falta la unidad de medida.');if(a===b)return q;const groups=[{kg:1,g:.001,mg:.000001},{l:1,ml:.001}];for(const g of groups)if(g[a]&&g[b])return q*g[a]/g[b];throw fail('No se puede convertir '+from+' a '+to+'. Usa la unidad del inventario.');}
function formula(b){
 const f={name:text(b.name,'Nombre de fórmula'),product_id:id(b.product_id),yield_quantity:num(b.yield_quantity,'Rendimiento',.000001),yield_unit:text(b.yield_unit,'Unidad de producto terminado',40),yield_kg:b.yield_kg==null||b.yield_kg===''?null:num(b.yield_kg,'Peso vendible',.000001),sale_price:b.sale_price==null||b.sale_price===''?null:num(b.sale_price,'Precio de venta',.000001),labor:num(b.labor,'Mano de obra'),overhead:num(b.overhead,'Otros costos de fabricación'),notes:text(b.notes||'','Notas',2000,false)};
 if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>150)throw fail('Incluye entre 1 y 150 ingredientes o empaques.');
 f.lines=b.lines.map(l=>{if(!l||typeof l!=='object')throw fail('Línea inválida.');const mode=choice(l.mode,['inventory','manual'],'Origen');const x={mode,kind:choice(l.kind,['material','packaging'],'Tipo'),quantity:num(l.quantity,'Cantidad',.000001),unit:text(l.unit,'Unidad',40)};
 if(mode==='inventory')x.item_id=id(l.item_id);else{if(x.kind!=='packaging')throw fail('Las materias primas deben vincularse al inventario.');x.name=text(l.name,'Nombre del empaque');x.unit_cost=num(l.unit_cost,'Costo del empaque',.000001);}
 return x;});return f;
}
function calculate(f,inventory,at=new Date().toISOString()){
 const items=new Map(inventory.map(i=>[Number(i.id),i]));const missing=[];
 const lines=f.lines.map((l,index)=>{let cost=null,quantity=null,name=l.name,sourceUnit=l.unit,reason=null;
 if(l.mode==='manual'){cost=l.unit_cost;quantity=l.quantity;}else{const item=items.get(l.item_id);name=item?.nombre||'Ítem eliminado #'+l.item_id;sourceUnit=item?.unidad||l.unit;
 if(!item||item.tipo!=='materia_prima')reason='No está en materias primas';else if(!(Number(item.costo_prom)>0))reason='Falta costo promedio';else{try{quantity=convert(l.quantity,l.unit,item.unidad);cost=Number(item.costo_prom);}catch(e){reason=e.message;}}}
 if(reason)missing.push({line:index+1,name,reason});return {...l,name,source_unit:sourceUnit,inventory_quantity:quantity,unit_cost:cost,total:reason?null:round(quantity*cost),reason};});
 const subtotal=round(lines.reduce((sum,l)=>sum+(l.total||0),0));const complete=missing.length===0;const total=complete?round(subtotal+f.labor+f.overhead):null;
 const per=complete?round(total/f.yield_quantity):null;
 return {at,complete,missing,lines,known_materials:subtotal,total,per_unit:per,per_kg:complete&&f.yield_kg?round(total/f.yield_kg):null,margin_percent:complete&&f.sale_price?round((f.sale_price-per)/f.sale_price*100,2):null};
}
function attachment(v){if(v==null)return null;let url;try{url=new URL(v.url);}catch(e){throw fail('Adjunto inválido.');}if(url.protocol!=='https:'||url.username||url.password||v.url.length>2000)throw fail('Adjunto inválido.');return {url:url.href,name:text(v.name,'Nombre del adjunto',250)};}
function expense(b){const amount=num(b.amount,'Valor',.01,99999999);if(Math.abs(amount*100-Math.round(amount*100))>.00001)throw fail('El valor admite hasta dos decimales.');return {date:date(b.date),amount:round(amount,2),category:choice(b.category,CATEGORIES,'Categoría'),area:choice(b.area,AREAS,'Área'),description:text(b.description,'Descripción',1000),responsible:text(b.responsible||'','Responsable',250,false),payee:text(b.payee||'','Proveedor o beneficiario',250,false),reference:text(b.reference||'','Referencia',100,false),order_id:text(b.order_id||'','Pedido',100,false),status:choice(b.status,['pendiente','pagado','anulado'],'Estado'),treatment:choice(b.treatment,['operativo','fabricacion'],'Clasificación'),attachment:attachment(b.attachment)};}
function totals(rows){const active=rows.filter(x=>x.status!=='anulado');const sum=list=>round(list.reduce((s,x)=>s+Number(x.amount),0),2);const group=key=>Object.entries(active.reduce((a,x)=>{const k=x[key]||'Sin asignar';a[k]=(a[k]||0)+Number(x.amount);return a;},{})).map(([name,value])=>({name,total:round(value,2)})).sort((a,b)=>b.total-a.total);
 return {total:sum(active),paid:sum(active.filter(x=>x.status==='pagado')),pending:sum(active.filter(x=>x.status==='pendiente')),operating:sum(active.filter(x=>x.treatment==='operativo')),manufacturing:sum(active.filter(x=>x.treatment==='fabricacion')),categories:group('category'),areas:group('area'),responsibles:group('responsible')};}
module.exports={CATEGORIES,AREAS,fail,id,text,date,formula,calculate,expense,totals,convert};

'use strict';
const price=m=>m.precio!=null?Number(m.precio):(Number(m.edit_version||0)===0&&m.operation_payload?.precio!=null?Number(m.operation_payload.precio):null);
function calculate(rows){
  let quantity=0,total=0,priced=0,missing=0;
  for(const m of rows){
    if(m.tipo!=='ingreso')continue;
    const q=Number(m.cantidad),p=price(m);
    if(!Number.isFinite(q)||q<=0||!Number.isFinite(p)||p<=0){missing++;continue;}
    quantity+=q;total+=q*p;priced++;
  }
  const cost=quantity>0?total/quantity:null;
  if(cost!==null&&!Number.isFinite(cost))throw Object.assign(Error('Los importes de los ingresos superan el límite permitido.'),{status:400});
  return {cost,basis:{method:'purchase_weighted',quantity,total,priced_count:priced,unpriced_count:missing}};
}
module.exports={calculate,price};

'use strict';

function summarize(products,fallback={}){
  if(!Array.isArray(products)||!products.length)return {producto:fallback.producto||'',cantidad:fallback.cantidad||''};
  const names=[...new Set(products.map(p=>String(p&&p.name||'').trim()).filter(Boolean))];
  const total=Math.round(products.reduce((sum,p)=>sum+(Number(p&&p.qty)||0),0)*100)/100;
  return {
    producto:(names[0]||fallback.producto||'')+(names.length>1?` (+${names.length-1} más)`:''),
    cantidad:String(total)+' unidades',
  };
}

module.exports={summarize};

'use strict';
// Cantidades del Excel y confirmaciones de Sergio del 16/10/2026. Sin precios históricos.
const line=(source_label,quantity,group='')=>({source_label,quantity,unit:'kg',mix_group:group});
const colors=(quantities)=>['COLOR ROJO','COLOR NARANJA','COLOR VERDE','COLOR BLANCO','COLOR UVA','COLOR AMARILLO','COLOR CARAMELO'].map((n,i)=>line(n,quantities[i],'colorantes'));
const formulas=[
 {key:'candytec-hard-20261016',name:'Caramelo duro · surtido promedio',yield_kg:60,labor:0,overhead:0,
  notes:'Excel FORMULACIONESCOSTOS A6:G24. Rendimiento de 60 kg del documento, revisar contra producción. Esencias y colorantes se promedian por separado, igual que el Excel. Costeo estándar de surtido equiproporcional; no es una orden de dosificación conjunta. Costos de fabricación no incluidos (0).',
  lines:[line('AZUCAR',42),line('GLUCOSA',19),line('ÁCIDO CÍTRICO',.6),
   ...[['CEREZA',.125],['FRESA',.25],['NARANJA',.25],['LIMÓN',.15],['COCO',.25],['PIÑA',.1],['UVA',.25],['TAMARINDO',.25],['TUTTI FRUTTI',.25]].map(([n,q])=>line('ESENCIA '+n,q,'esencias')),
   ...colors([.3,.3,.15,.68,.3,.3,.55])]},
 {key:'candytec-toffee-20261016',name:'Toffee · surtido promedio',yield_kg:70,labor:0,overhead:0,
  notes:'Excel FORMULACIONESCOSTOS I6:O34. Rendimiento de 70 kg del documento, revisar contra producción. Esencias y colorantes se promedian por separado. Surtido equiproporcional confirmado; pieza de 6 g. Revisar qué sabores utiliza cada producto. Costos de fabricación no incluidos (0).',
  lines:[line('AZUCAR',32.2764),line('GLUCOSA',32.2764),line('ÁCIDO CÍTRICO',.11),line('LECITINA',.07),line('VERSILAC',1),line('DANFAT',4.36),line('AZUCAR PULVERIZADA',2.017),line('MALTODEXTRINA',2),line('SAL',.24),
   ...[['FRUTILLA',.25],['LIMÓN',.25],['NARANJA',.25],['COCO',.25],['CHOCOLATE',.125],['MANTEQUILLA',.125],['LECHE MIEL',.125],['LECHE CREMA',.125],['RON PASAS',.125],['TUTTI',.25],['MANÍ',.25],['PASAS',.25],['ALMENDRA',.125]].map(([n,q])=>line('ESENCIA '+n,q,'esencias')),
   ...colors(Array(7).fill(.01))]},
 {key:'candytec-acid-powder-20261016',name:'Polvo ácido · limón',yield_kg:1.615,labor:0,overhead:0,
  notes:'Lote confirmado por Sergio el 16/10/2026: 250 g ácido cítrico, 200 g maltodextrina, 50 g fosfato, 50 g citrato, 15 g Aerosil, 50 g esencia de limón y 1 kg sal. Rendimiento teórico 1,615 kg antes de pérdidas de mezcla. Costos de fabricación no incluidos (0).',
  lines:[line('ÁCIDO CÍTRICO',.25),line('MALTODEXTRINA',.2),line('FOSFATO',.05),line('CITRATO',.05),line('AEROSIL',.015),line('ESENCIA LIMÓN',.05),line('SAL',1)]}
];
const item=(source_label,method,quantity,unit='kg',extra_pct=0,source='inventory')=>({source_label,source,method,quantity,unit,extra_pct});
const film=(name,yieldQty)=>item(name,'yield',yieldQty,'kg',5);
const bag=(name,q=1)=>item(name,'presentation',q,'u');
const products=[];
for(const twist of [false,true])for(const kg of [5,10])products.push({key:(twist?'dobletwist':'yumyum')+'-'+kg,name:(twist?'YumYum DobleTwist':'YumYum Flowpack')+' '+kg+' kg',marca:twist?'YumYum DobleTwist':'YumYum',categoria:'Caramelo duro',formula_key:formulas[0].key,peso_unitario_g:5,peso_masa_g:5,peso_neto_kg:kg,presentacion:'Fundón '+kg+' kg',basis:'weight',mass_extra_pct:5,items:[film(twist?'LAMINA YUM YUM DOBLE TWIS':'LAMINA YUM YUM FLOWPACK',7700),bag(kg===5?'FUNDÓN CARAMELO 5 KG':'FUNDÓN YUM YUM 10 KG')]});
products.push({key:'chispipop-200',name:'ChispiPop navideño · 200 unidades',marca:'ChispiPop',categoria:'Chupete',formula_key:formulas[0].key,peso_unitario_g:10,peso_masa_g:10,unidades_presentacion:200,peso_neto_kg:2,presentacion:'Fundón 200 unidades',basis:'pieces',mass_extra_pct:5,items:[film('LAMINA CHUPETE NAVIDEÑO CHISPIPOP',7700),item('PALO 0.6g. CHUPETE NAVIDEÑO','piece',.6,'g',5),bag('FUNDÓN CHUPETE 200 U')]});
products.push({key:'acidazo-150',name:'Acidazo con polvo · 150 unidades',marca:'Acidazo',categoria:'Chupete',formula_key:formulas[0].key,peso_unitario_g:12,peso_masa_g:10,unidades_presentacion:150,peso_neto_kg:1.8,presentacion:'Fundón 150 unidades',basis:'pieces',mass_extra_pct:5,items:[{...item('Polvo ácido · limón','piece',2,'g',0,'formula'),formula_key:formulas[2].key},film('LAMINA CHUPETE ACIDAZO',7700),item('PALO 0.6g. CHUPETE NAVIDEÑO','piece',.6,'g',5),bag('FUNDÓN CHUPETE 150 U')]});
for(const [name,lamina] of [['Bocado','LAMINA TOFFE BOCADO'],['Navideño','LAMINA TOFFE NAVIDEÑO'],['Cream','LAMINA TOFFE CREAM']])products.push({key:'toffee-'+name.toLowerCase(),name:'Toffee '+name+' · caja 10 kg',marca:'Toffee '+name,categoria:'Toffee',formula_key:formulas[1].key,peso_unitario_g:6,peso_masa_g:6,peso_neto_kg:10,presentacion:'Caja 2 fundones de 5 kg',basis:'weight',mass_extra_pct:5,items:[film(lamina,5900),film('LAMINA INTERNA DE TOFFE REFILE',10000),bag('FUNDÓN TOFFEE 5 KG',2),bag('CAJA TOFFEE')]});
module.exports={formulas,products};

# Costos por formulación y presentación

## Qué cambia

- Mis productos permite filtrar por categoría y preparar una ficha con las cantidades de referencia del Excel. Conserva el producto existente, su nombre, su peso de despacho y los adicionales manuales para revisión.
- Formulaciones incluye tres referencias: caramelo duro surtido, toffee surtido y polvo ácido de limón. Se cargan como borradores; requieren revisión y guardado. Repetir la carga abre la misma formulación guardada.
- Una ficha puede incluir varias láminas, palitos, fundones, cajas y formulaciones adicionales. Se pueden consumir por pieza, por presentación o por rendimiento de piezas/kg de material.
- El centro de costos calcula con los promedios actuales del inventario. No importa los precios históricos del Excel ni modifica existencias.
- Los accesos siguen limitados a Gerencia, igual que los módulos de formulaciones y productos existentes.

## Primer uso

1. Abrir **Formulaciones** y usar **Cargar cantidades del Excel**. Revisar las tres referencias que se necesiten. Seleccionar las materias primas que estén en blanco: solo se asocian automáticamente nombres coincidentes o vínculos previamente revisados.
2. Revisar unidades y rendimiento real del lote. Los rendimientos de referencia son 60 kg para caramelo duro y 70 kg para toffee, tomados del documento. Guardar cada formulación. Si ya existía una base equivalente sin referencia de importación, revisar antes de cargar otra: la detección de duplicados se hace por referencia, no por parecido de nombres.
3. En **Mis productos**, abrir el SKU existente, seleccionar una referencia en **Preparar ficha con datos del Excel** y revisar presentación, fórmula base, sabores, pesos y cada empaque. Se puede configurar todo manualmente con **Desglosar varios empaques y componentes**.
4. Completar los adicionales manuales solo si no están desglosados. Escribir 0 si no aplican; vacío significa pendiente. Los importes antiguos se conservan para que no se pierda información, pero deben revisarse para evitar contar dos veces la misma lámina, palito o fundón.
5. Guardar la ficha y abrir **Centro de costos → Actualizar → Ver desglose**. Volver a actualizar el informe después de cambiar precios o formulaciones.

## Cantidades confirmadas

Toffees: 6 g de masa por pieza. Para una caja de 10 kg se calculan 1.666,6667 piezas aproximadas para costear sus envoltorios; esa estimación no cambia las unidades de inventario o despacho.

Polvo ácido de limón, lote de 1,615 kg:

| Ingrediente | kg |
| --- | ---: |
| Ácido cítrico | 0,250 |
| Maltodextrina | 0,200 |
| Fosfato | 0,050 |
| Citrato | 0,050 |
| Aerosil | 0,015 |
| Esencia de limón | 0,050 |
| Sal | 1,000 |

El rendimiento del polvo es la suma teórica de ingredientes antes de pérdidas de mezcla. Si se obtiene menos masa utilizable, corregir el rendimiento real.

## Surtidos y consumo adicional

Las esencias se agrupan en `esencias`, y los colorantes en `colorantes`. El cálculo divide la cantidad de cada alternativa por el número de alternativas del mismo grupo. Las líneas sin grupo se suman completas. Así se reproduce el promedio del documento con proporciones iguales, usando precios actuales. No representa una instrucción de mezclar todos los sabores juntos. Revisar que las alternativas correspondan al surtido real de cada producto; para un sabor individual, crear su base con la esencia y color correspondientes sin grupo.

El 5 % del Excel se interpreta como **consumo adicional**: cantidad × 1,05. Es distinto del rendimiento real del lote. Usar 0 % cuando la pérdida ya esté incluida en el rendimiento, para no duplicarla. La lámina antigua se traslada con 0 % adicional porque su rendimiento ya se definía como real.

Las referencias de presentación y de láminas requieren revisión por SKU. La referencia de Acidazo tiene 10 g de masa + 2 g de polvo por pieza y no restaura productos archivados. Los toffees incluyen lámina exterior e interior, dos fundones de 5 kg y una caja; ajustar cuando la presentación real sea otra.

## Alcance del total

Se detallan materias primas de la base, fabricación registrada, formulaciones adicionales, materiales de empaque y otros costos manuales. El costo de una formulación adicional se muestra por kg; su detalle de ingredientes está en Formulaciones.

Mano de obra y otros costos de fabricación de las referencias empiezan en 0 porque no se importan importes históricos. Completar esos valores si se necesita un costo de fabricación completo. Los gastos comerciales y administrativos no se distribuyen automáticamente. Un material sin precio o unidad compatible deja el total incompleto; no se sustituye por cero ni se convierte de volumen a masa sin información.

## Verificación técnica

Ejecutar:

```sh
node --test tests/cost-model.test.js tests/base-formulations.test.js tests/product-master.test.js tests/product-costs.test.js tests/film-cost.test.js
```

Las pruebas cubren cantidades, grupos, conversiones, cambio de promedios, ausencia de datos, lectura de formularios, permisos, guardado con historial, reintentos y compatibilidad con fichas anteriores. No requieren una base de producción. Las operaciones de base de datos se verifican con simulaciones transaccionales; la carga con los registros reales se revisa al aplicar el parche.

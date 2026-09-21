# Formulaciones base y corrección de Guardar ficha

Esta actualización requiere las versiones de Costos y Gastos, Mis productos y menú por categorías entregadas anteriormente.

## Corrección de guardado

El formulario contenía un botón con `id="pmSave"`, igual al nombre de la función invocada por su evento `onsubmit`. Los controles pueden resolverse por nombre dentro de esos eventos y ocultar la función global. El parche da identificadores distintos a los controles de Guardar/Volver en Mis productos y a los controles equivalentes de Costos y Gastos. También muestra los errores de validación del navegador junto al botón y captura errores de preparación del envío.

Se añadió una regresión que ejecuta el evento generado con un ámbito de controles por nombre: reproduce el fallo con el ID anterior y verifica el envío con el ID corregido. No equivale a una prueba en un navegador real contra Render.

## Formulaciones

En **Productos y costos → Formulaciones** (Gerencia):

1. Crea una base, por ejemplo «Caramelo duro» o «Toffee».
2. Agrega las materias primas del inventario y cantidades consumidas en el lote. Puedes utilizar kg/g/mg y L/ml compatibles con la unidad del insumo.
3. Ingresa el rendimiento real de masa terminada, en kg, después de las pérdidas de producción.
4. Ingresa mano de obra y otros costos de fabricación del lote, o cero si no los estás incluyendo.
5. Calcula y guarda. La base queda disponible para todos tus productos.

El costo se obtiene del costo promedio de las materias primas en el servidor. No se permite convertir volumen a masa sin equivalencia ni vincular insumos inexistentes. Si faltan precios, la fórmula puede conservarse como incompleta y el costo no se presenta como cero.

Cada edición requiere motivo y versión vigente. El historial conserva receta, rendimiento, costos usados, autor y fecha; los reintentos no duplican la operación.

## Vincular productos

En **Mis productos → Abrir**, selecciona **Formulación base** y guarda. Puedes usar la misma base en varios SKUs.

- YumYum de 5 g y chupete de 10 g pueden seleccionar la misma base cuando comparten receta.
- El costo de masa por pieza se calcula como costo por kg de la base × peso de masa en gramos / 1000.
- El costo de masa por presentación multiplica ese resultado por las unidades por presentación.
- Es necesario completar **peso de masa por pieza**: no se reemplaza automáticamente por el peso total porque podría incluir polvo o relleno.
- Estos valores no incluyen empaques, palitos, polvo, rellenos ni procesos adicionales del SKU. No son el costo final del producto.
- La consulta usa el costo actual de la receta vinculada. Al actualizar una receta o un costo de inventario, recarga las fichas para ver los valores actuales. Los historiales previos mantienen sus fotografías.

Se puede dejar el producto sin vincular por ahora. Los nombres de familia escritos anteriormente se conservan internamente, pero no se transforman automáticamente en una receta: debes seleccionar la formulación correcta. Tampoco se convierten automáticamente las fórmulas por producto creadas en Centro de costos. Esas siguen disponibles sin cambios.

## Instalación y validación

El inicio del servidor crea `base_formulations` y agrega `catalogo.formula_id`, con referencia a la base existente. No modifica pedidos, saldos de inventario ni pesos de despacho. Las rutas del módulo y la vinculación se autorizan contra el rol Gerencia actual del usuario.

Las pruebas locales cubren cálculos, cantidades incompatibles, costos incompletos, vinculación válida/inválida, conservación del vínculo desde un cliente anterior, permisos, rollback, idempotencia, control de versiones y la regresión de los botones. Persistencia y ámbito del formulario se simulan; no se ha conectado esta prueba a la base real de Render.

Después del despliegue, recarga completamente la página. Primero guarda una ficha existente y recarga para comprobarla. Luego crea una base con tu receta real, guárdala, selecciónala desde un producto y vuelve a abrir la ficha para comprobar el vínculo y su costo de masa.

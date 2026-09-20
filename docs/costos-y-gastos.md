# Centro de costos y control de gastos

## Acceso

- Gerencia: fórmulas, cálculo, historial de costos y control de gastos.
- Facturación: registro, edición, anulación, consulta e historial de gastos.
- Los demás perfiles no tienen acceso a estas nuevas rutas. Los permisos se verifican contra el usuario vigente en PostgreSQL.

## Costear un producto

1. Abre **Centro de costos → Nueva fórmula** y selecciona un producto del catálogo.
2. Da un nombre a la fórmula. Puedes tener varias fórmulas o presentaciones del mismo producto.
3. Escribe el rendimiento real vendible del lote y su presentación. Ejemplo: 20 y «funda de 5 kg». Si conoces el peso total vendible del lote, agrega 100 kg. El rendimiento debe descontar la merma: no se vuelve a sumar otro porcentaje de merma.
4. Agrega los ingredientes y las cantidades consumidas en todo el lote. Se toma `inventario.costo_prom` del servidor. Se admiten conversiones g/kg/mg y ml/L; para otras unidades utiliza exactamente la unidad del inventario. No se convierten litros a kilos sin una equivalencia.
5. Incluye los empaques. Si están registrados en materias primas, vincúlalos al inventario; si no, elige **Empaque con costo manual** y escribe su precio por unidad. Este precio manual no se actualiza automáticamente.
6. Agrega mano de obra y otros costos de fabricación del lote; pueden ser cero si todavía no se incluyen. No repitas valores ya incluidos en otra línea.
7. Opcionalmente ingresa el precio de venta sin impuestos por la misma presentación del rendimiento.
8. Pulsa **Calcular costo actual** y después **Guardar**.

Se muestran costo por lote, costo por presentación, costo por kg cuando hay peso y margen antes de gastos comerciales y administrativos. El margen no es utilidad neta.

Si falta el precio de una materia prima, el ítem desapareció o la conversión es incompatible, se puede guardar la fórmula como incompleta; el sistema señala el problema y no muestra un costo total ni un margen falsamente bajos. Es necesario resolverlo para obtener un resultado completo.

La tabla muestra el costo calculado con el inventario al abrir/actualizar y el costo del último guardado. Cada guardado conserva una fotografía de ingredientes, cantidades, costos, rendimiento, fecha y autor. El historial mantiene los valores anteriores aunque después cambien los precios. Para registrar una nueva fotografía de la misma fórmula, ábrela, indica el motivo y guarda nuevamente.

El costeo no consume existencias, registra producción ni modifica pedidos. Tampoco recalcula retroactivamente el costo de ventas histórico.

## Registrar gastos

1. Abre **Control de gastos → Registrar gasto**.
2. Completa fecha, valor total en USD, descripción, categoría, área y estado.
3. Puedes indicar responsable o vendedor, proveedor o beneficiario, referencia y código de pedido (CT-…). Si indicas pedido, debe existir.
4. Elige gasto operativo o fabricación. La segunda clasificación identifica costos que podrían estar incluidos en una fórmula; las dos cifras se muestran separadas. No se calcula una utilidad neta sumando ambos módulos.
5. Adjunta un PDF o foto **solo si deseas**. Puedes guardar sin archivo y adjuntarlo en una edición posterior. Si el almacenamiento de archivos falla, puedes continuar sin adjunto.
6. Guarda y espera la confirmación del servidor.

Categorías: Marketing, Comisiones, Viáticos, Transporte y despachos, Servicios básicos, Arriendo, Sueldos y honorarios, Mantenimiento, Suministros y Otros.

Las comisiones y viáticos se registran por su importe; esta versión no los calcula automáticamente sobre ventas o cobros.

Selecciona el mes para consultar totales por fecha del gasto, pagos, pendientes y comparación con el mes anterior completo. La comparación no iguala el número de días transcurridos. Se muestran desgloses por categoría, área y responsable, búsqueda, filtro y exportación CSV del mes (incluye anulados identificados como tales; los indicadores excluyen anulados).

Para corregir un gasto, pulsa **Editar** e indica el motivo. Para retirarlo de los totales, cambia su estado a **anulado**. El registro y su historial se conservan. Una edición con versión antigua se rechaza: vuelve a abrir el registro para incorporar el cambio más reciente.

Este registro comienza vacío; no importa automáticamente costos históricos de logística, movimientos de inventario ni otros registros. Los indicadores abarcan los gastos registrados en este módulo. No registres una compra de materia prima como gasto operativo si ya se contabilizará en el producto consumido.

## Guardado y archivos

- El guardado es transaccional: registro, historial y clave de reintento se confirman juntos.
- Un fallo incierto de conexión mantiene el formulario bloqueado y ofrece **Reintentar guardado**, usando la misma clave para no duplicar. No recargues hasta obtener confirmación.
- La prevención de duplicados cubre reintentos de una misma operación. Dos registros nuevos independientes no se identifican automáticamente como una misma factura.
- Los adjuntos usan el servicio de archivos existente. Quitar la vinculación no elimina archivos remotos ni respaldos del historial.
- No hay nuevos servicios, credenciales ni dependencias npm.

## Instalación y migración

El parche modifica `server.js` y `frontend/index.html`, agrega los módulos `lib/business-control*.js`, pruebas y este documento. Está construido sobre la copia de CandyTec utilizada en este chat; `git apply --check` verifica que los cambios encajen antes de aplicarlos.

Al iniciar, el servidor crea cuatro tablas nuevas (`cost_formulas`, `business_expenses`, `business_audit`, `business_operations`) e índices. Amplía el costo promedio del inventario a NUMERIC(18,6) cuando tiene menos de seis decimales, conservando los valores existentes. No recupera decimales perdidos antes de esta ampliación. No elimina ni reinicia información.

La nueva migración debe completarse antes de que el servidor escuche conexiones; si falla, revisa el registro del despliegue. En un retroceso de código, conserva las tablas y su historial: no hace falta eliminarlas.

## Verificación

Pruebas locales de cálculos, conversiones, costos incompletos, categorías, permisos, reintentos, versiones, rollback e historial. Las pruebas de persistencia usan un adaptador de PostgreSQL simulado; los formularios se prueban con un DOM simulado. No equivalen a una prueba contra la base de datos de Render ni a una revisión visual en navegador real.

Después del despliegue:

1. Entra como gerencia y confirma ambas opciones de menú.
2. Crea tu primera fórmula real; compara manualmente un ingrediente, el costo de lote y el rendimiento. Recarga y verifica que permanece.
3. Registra un gasto real de Marketing sin comprobante. Recarga, verifica importe y mes; edítalo y comprueba el historial.
4. Entra como facturación: debe ver gastos y poder registrarlos; no debe ver Centro de costos.
5. Si trabajas con costos logísticos históricos, considera su alcance por separado: aún no están importados al nuevo registro.

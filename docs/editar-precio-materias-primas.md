# Corrección de precios de materias primas

En Movimientos → Editar, corregir el precio por unidad del ingreso y guardar. Acceso: Bodega y Gerencia.

Al editar una materia prima, se calcula el promedio ponderado de todos sus ingresos con precio registrado:

promedio = suma(cantidad × precio) / suma(cantidad)

Incluye ingresos anteriores y posteriores al editado. No usa el promedio actual ni reconstruye el costo del saldo inicial. Salidas, consumos y ajustes no intervienen en este promedio de compras. Esto cambia el método anterior de promedio móvil de existencias para la materia prima corregida. Las nuevas compras de esa materia prima conservan el promedio de ingresos; las demás materias primas conservan su método hasta que se corrijan.

Un cambio exclusivo de precio mantiene exactamente el stock. Las correcciones de cantidad también ajustan el saldo, con validación de cantidades negativas. El precio del ingreso se sustituye, no se crea otro ingreso. El guardado es atómico e incluye auditoría, versión y reintentos sin duplicación.

Los ingresos antiguos con precio en operation_payload se incluyen. Los que no tienen precio se excluyen de numerador y denominador; su cantidad de registros aparece en la tarjeta del inventario. No se inventa un precio ni se considera cero. Si no queda ningún ingreso con precio, el costo es desconocido (NULL), no cero. El saldo inicial sin un ingreso con precio no forma parte de este promedio de compras.

La tarjeta identifica la base del cálculo. Formulaciones y centro de costos reciben el nuevo promedio al volver a cargar. El parche no modifica automáticamente los costos de todo el inventario ni documentos contables.

Pruebas: node --test tests/inventory-edit.test.js tests/inventory-movement.test.js. Los casos incluyen corrección de 25000 kg a 0.66 con stock inicial sin valoración, ingresos antes y después, faltantes de precio, permisos, reversión de errores y reintentos. Las pruebas de persistencia usan un adaptador simulado; el despliegue debe verificarse con los datos reales.

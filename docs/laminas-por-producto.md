# Lámina del inventario y rendimiento por producto

En **Mis productos → Abrir**, la sección **Lámina de empaque** permite elegir un material del inventario de materias primas cuya unidad sea compatible con kg. No se adivina si un material es una lámina por su nombre: selecciona el material correcto.

Ingresa el **rendimiento en piezas envueltas por 1 kg de lámina**, específico de ese SKU. Por ejemplo, 2.000 indica que un kilogramo alcanza para envolver 2.000 caramelos o chupetes. Usa el rendimiento real incluyendo las pérdidas; no se añade otra merma automática.

Cálculos:

- Costo de lámina por pieza = costo promedio por kg / piezas por kg.
- Kg de lámina por presentación = unidades de la presentación / piezas por kg.
- Costo de lámina por presentación = kg consumidos × costo promedio por kg.

Ejemplo ilustrativo: lámina a $6/kg, rendimiento de 2.000 piezas/kg y presentación de 1.000 piezas. El costo es $0,003 por pieza, consumo de 0,5 kg y $3 por presentación. Es un ejemplo, no un precio asignado a tus materiales.

## Guardar y consultar

La ficha muestra una vista previa con los datos cargados. Guarda para registrar la selección y el rendimiento. El historial conserva el material, rendimiento y precio por kg de referencia al guardar.

En **Centro de costos → Ver desglose** se muestra una línea independiente de lámina: consumo en kg, costo promedio por kg e importe por presentación. Se toma el precio vigente del inventario al consultar o actualizar, sin tener que reescribirlo en cada producto. Una misma lámina puede tener rendimientos distintos en SKUs diferentes.

Si el inventario registra el material en gramos, el precio se convierte a kg. No se convierten litros, metros, rollos u otras unidades sin equivalencia. Si el material no existe, su unidad es incompatible o falta su costo promedio, se muestra un pendiente y no un costo cero.

## Evitar duplicar el empaque

Con lámina vinculada, el campo manual pasa a **Otros empaques sin lámina**: registra allí solo fundas, cajas, etiquetas u otros materiales adicionales. Ingresa 0 si no hay otros empaques. La lámina calculada no debe estar incluida también en esos importes ni en la receta base.

Al cambiar entre empaque manual y lámina vinculada, el importe manual queda vacío para que lo revises. Cambiar entre dos láminas conserva el importe de otros empaques. Sin lámina vinculada, se mantiene la opción de empaque manual.

La selección corresponde a una lámina para envolver las piezas del SKU. Si necesitas otra lámina para un empaque exterior, su rendimiento y cantidad no se deducen automáticamente en esta versión.

## Alcance técnico

Requiere el parche anterior de Centro de costos por producto. No crea nuevas tablas ni dependencias: usa la ficha existente. No descuenta inventario, registra consumos físicos ni cambia fórmulas, pedidos o pesos de despacho. Las opciones siguen limitadas a Gerencia.

Las pruebas locales cubren rendimiento, unidades, precio actualizado, desglose por SKU, costos incompletos, persistencia, historial, conservación desde clientes anteriores y prevención del doble conteo manual. Base y DOM de pruebas simulados; queda pendiente comprobar el despliegue con una lámina real en Render.

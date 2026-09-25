# Bodega de Láminas y Cajas

La sección Producción y bodega incluye Materias Primas, Láminas y Cajas y Producto Terminado. Bodega y Gerencia pueden registrar entradas, salidas, ajustes y cambiar la clasificación; Producción puede consultar la nueva bodega igual que la de materias primas.

Los materiales actuales permanecen inicialmente donde están. Desde su tarjeta en Materias Primas, usar Mover a Láminas y Cajas. La operación conserva el ID, existencias, unidad, mínimo, costo, movimientos y referencias de formulaciones/productos. Puede revertirse con Mover a Materias Primas. No registra un ingreso o salida porque es una clasificación dentro del sistema, no un movimiento físico.

En Láminas y Cajas se pueden crear nuevos materiales, consultar su valor y alertas, registrar ingresos con precio y salidas. Movimientos incluye un filtro propio. Las láminas continúan disponibles para asociarlas a productos, incluso antes de reclasificarlas; la conversión a kg sigue siendo necesaria para calcular costos de lámina. No se incorpora una nueva fórmula de costos de cajas.

Implementación: inventario.bodega separa materiales sin cambiar su tipo interno. La migración agrega la columna sin recrear materiales ni actualizar saldos. El cambio de bodega valida permisos en el servidor, bloquea la fila, registra auditoría y admite reintentos sin duplicación. La clasificación actual también se usa para agrupar los movimientos anteriores; el cambio queda documentado en business_audit.

Validación local: node --test tests/inventory-warehouse.test.js y pruebas existentes. Persistencia probada con adaptador simulado; verificar el despliegue moviendo un material conocido y comprobando que conserve stock y costo.

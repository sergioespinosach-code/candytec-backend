# Corregir precios de ingresos de materias primas

En Movimientos, filtrar Materias primas, pulsar Editar en el ingreso, corregir el precio por unidad de inventario, escribir el motivo y guardar. Bodega y Gerencia pueden hacerlo. El campo aparece únicamente para ingresos de materia prima; las salidas no tienen precio de compra editable.

Se conservan cantidad y tipo editables. Movimiento, stock, promedio y auditoría se guardan en una transacción. La pantalla confirma únicamente la respuesta del servidor; un fallo de conexión permite reintentar la misma operación. Una versión evita sobreescribir correcciones de otra persona.

Los precios ya almacenados en operation_payload se recuperan al recargar. Los nuevos ingresos guardan además precio explícito y valoración anterior. Los cambios se auditan en inventory_movement_edits, con usuario, fecha y datos anteriores/posteriores. Esta tabla es un registro técnico; este parche no incorpora otra pantalla de auditoría.

El promedio se corrige considerando saldos y compras posteriores al ingreso. Al editar cantidades o tipo se reconstruye la valoración y se rechaza cualquier saldo histórico negativo. Si un movimiento antiguo no conserva el precio o información necesaria, se rechaza la corrección con explicación; no se inventa un precio histórico. Historiales antiguos afectados por cambios directos de stock requieren revisión: sus saldos no siempre se pueden reconstruir. No se modifican consumos físicos por un cambio exclusivo de precio, ni facturas contables.

Las formulaciones y el centro de costos consultan el promedio actualizado en su siguiente carga; sus fotografías históricas se conservan.

Validación local: node --check server.js y node --test tests/*.test.js. Las pruebas de persistencia usan un adaptador de base de datos simulado, no una conexión al PostgreSQL de producción. Tras el despliegue, recargar los navegadores y verificar una corrección conocida volviendo a abrir el movimiento y comprobando el promedio.

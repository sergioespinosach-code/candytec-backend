# Despachos: selección rápida

La selección rápida pasa a ser la vista inicial del planificador. Esta guía reemplaza el requisito anterior de guardar un plan antes de generar sus documentos.

1. Filtra por ciudad, sector, fecha de entrega o estado. El buscador incluye cliente, pedido, vendedor y producto.
2. Marca los pedidos o usa «Marcar los disponibles» para seleccionar los del filtro, hasta 250 entregas/pedidos.
3. Consulta el acumulado por producto, el peso por pedido y el peso total. Si un pedido tiene varias entregas seleccionadas, el resumen las agrupa por número de pedido.
4. Ajusta cantidades de los pedidos por facturar directamente en su tarjeta. Una cantidad cero excluye ese producto al generar documentos. Las entregas facturadas se incluyen completas.
5. Descarga el Excel o abre la vista previa de la hoja de ruta y pulsa «Imprimir / Guardar PDF».

El Excel contiene Hoja de ruta, Preparación, Carga, Por pedido y Matriz de carga. Esta última cruza pedidos y productos e incluye totales de cantidades y peso.

Las cantidades mantienen la unidad que utiliza cada pedido: bultos, fundones, etc. No se convierten a caramelos individuales. Los kg se calculan con `peso_bulto` del catálogo. Un peso desconocido se señala como incompleto; no se supone que sea cero ni se presenta la suma conocida como total completo.

Cambiar los filtros conserva la selección. Los pedidos seleccionados que quedan fuera del filtro aparecen aparte. La selección permanece mientras se navega dentro de la sesión, pero no se guarda automáticamente al cerrar o recargar la página. El navegador advierte si hay cambios sin guardar. Para conservar una carga, usa «Planes guardados y opciones» y guarda un borrador.

Los planes existentes y sus opciones de vehículo, conductor, capacidad, observaciones, orden de paradas, guardar, confirmar, cerrar y cancelar siguen disponibles en esa sección. Las asignaciones a otros planes abiertos siguen descontándose; cerrar/cancelar esos planes las libera según las reglas existentes. No se cambian las tablas de base de datos ni los permisos de escritura.

Los roles con acceso de consulta al planificador pueden calcular y descargar selecciones temporales. Guardar y modificar planes continúa reservado a Gerencia, Facturación y Bodega. Vendedores mantienen sus permisos anteriores.

Generar documentos consulta datos recientes y valida cantidades, cambios en los pedidos y conflictos con planes guardados. Una selección temporal no modifica pedidos, stock ni planes. Cuando hay un error, se muestra y se desplaza la vista hasta el aviso. El Excel ofrece un enlace manual si el navegador no inicia la descarga automática. La impresión se realiza desde un botón en una vista previa visible.

## Validación

Ejecutar `node --test tests/planner-core.test.js tests/planner-selection.test.js`.

Se comprobaron 22 casos de reglas y selección, incluyendo facturación parcial, pesos desconocidos, edición, filtros, conflictos y cambios durante una consulta. Además se verificaron interacciones DOM con datos ficticios y se generó y reabrió un XLSX real de cinco hojas para comprobar su total. No se verificó una impresión física ni el diálogo nativo de Safari/Chrome en el Mac del usuario.

Esta actualización se aplica sobre la versión del planificador enviada como commit `073fdac`. El rediseño estético general del sistema no forma parte de este parche.

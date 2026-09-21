# Centro de costos por producto

La navegación queda separada:

- **Formulaciones**: crear y editar recetas base, cantidades, rendimiento real y costos de fabricación del lote.
- **Mis productos**: asignar la base al SKU, completar pesos y unidades por presentación e ingresar sus costos adicionales.
- **Centro de costos**: consultar el cálculo y desglose por SKU; no crea ni edita recetas.

## Qué muestra el informe

Por cada producto activo: base vinculada, presentación, costo de masa por presentación, costo total por presentación y costo por pieza. Se pueden buscar SKU, nombre, marca y base, o filtrar productos con pendientes.

**Ver desglose** muestra cada materia prima consumida para producir una presentación, la unidad usada en inventario, su costo promedio y el importe asignado. También muestra mano de obra y otros costos de la base, y los adicionales del SKU.

La asignación se calcula así:

- Masa de una presentación = peso de masa por pieza × unidades por presentación / 1000.
- Fracción de lote = masa de la presentación / rendimiento real en kg.
- Costo asignado de cada ingrediente = costo del ingrediente en el lote × fracción de lote.
- Fabricación de la base se asigna con la misma fracción; el rendimiento ya incorpora la merma.
- Se suman los costos adicionales por presentación ingresados en la ficha, una sola vez.

El peso neto por presentación sirve para mostrar el costo por kg del producto cuando está disponible. No se utiliza el peso para despachos como sustituto. El costo por pieza incluye la parte proporcional de los costos de esa presentación: no representa una presentación de venta individual distinta.

## Completar los adicionales

En **Mis productos**, al abrir una ficha, hay tres importes manuales por presentación de venta:

1. Empaques.
2. Otros componentes: palito, polvo, relleno, etc.
3. Proceso adicional del SKU.

Ingresa únicamente lo que no está incluido en la fórmula base. Vacío significa pendiente; 0 significa que no aplica o que no se asignará ese costo. Puedes seguir guardando fichas incompletas.

Estos tres importes manuales no se actualizan automáticamente con el inventario. Las materias primas de la base sí usan el costo promedio actual al consultar o pulsar **Actualizar costos**. No se calcula utilidad neta y no se suman automáticamente los gastos comerciales o administrativos.

Un costo se considera completo según la información registrada, no como una certificación contable. Si falta la base, sus precios, cantidades necesarias o alguno de los adicionales, el informe muestra un **subtotal conocido** y la lista de pendientes. No presenta ese subtotal como costo final. También pide revisar una masa por presentación que supere el peso neto informado.

## Historial y datos previos

**Costeos anteriores** permite consultar los cálculos e historiales del antiguo Centro de costos, sin mostrar un segundo editor de formulaciones ni sumarlos al cálculo actual. No se convierten ni se eliminan esos registros.

El informe actual es una consulta: no modifica inventario, recetas, fichas ni pedidos. Los cambios de receta conservan su historial en Formulaciones; los adicionales conservan el suyo en Mis productos. El nuevo informe no guarda fotografías propias ni revaloriza retroactivamente ventas históricas.

## Instalación y pruebas

Requiere el parche de Formulaciones y Guardar ficha, además de las actualizaciones anteriores. No agrega tablas ni dependencias; los adicionales se guardan en la ficha JSON existente del producto. Un cliente anterior que no envíe esos campos conserva los adicionales ya registrados.

Se verificaron cálculo con merma, distribución por presentación, costo por pieza/kg, componentes faltantes frente a cero explícito, incompatibilidad de pesos, permisos y conservación de adicionales. Las pruebas de persistencia usan una base simulada; no son una ejecución contra Render.

Después del despliegue, recarga completamente. Abre Centro de costos y el desglose de un producto con base asignada. Completa en su ficha los datos pendientes y los adicionales, guarda, vuelve al informe y actualiza. Contrasta un producto con tu cálculo manual para verificar los datos ingresados.

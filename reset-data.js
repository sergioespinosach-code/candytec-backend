/**
 * reset-data.js — Borra TODOS los datos operativos (clientes, pedidos, producción,
 * movimientos, solicitudes, inventario) para volver a empezar de cero.
 * Los usuarios (login) NO se borran, siguen intactos.
 *
 * Cómo correrlo (cuando quieras reiniciar las pruebas):
 *   En Render → tu servicio "candytec-backend" → pestaña "Shell" → ejecutar:
 *     npm run reset
 *
 * ADVERTENCIA: esto borra datos de verdad y no se puede deshacer.
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function reset() {
  console.log('Borrando todos los datos operativos...\n');
  const tablas = ['pedidos', 'clientes', 'producciones', 'movimientos', 'solicitudes', 'inventario'];
  for (const t of tablas) {
    await pool.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
    console.log(`✓ ${t} vaciada`);
  }
  // el catálogo no se borra, pero sus ítems de inventario sí — los recreamos en cero
  const catalogo = await pool.query('SELECT nombre FROM catalogo');
  for (const row of catalogo.rows) {
    await pool.query(
      `INSERT INTO inventario (tipo, nombre, unidad, stock, minimo) VALUES ('producto_terminado', $1, 'unidades', 0, 0)
       ON CONFLICT (tipo, nombre) DO NOTHING`,
      [row.nombre]
    );
  }
  console.log(`✓ ${catalogo.rows.length} productos del catálogo re-sincronizados a Bodega P. Terminado (stock 0)`);
  console.log('\nListo. Los usuarios (login) no se tocaron — todos pueden seguir entrando igual.');
  console.log('El sistema quedó vacío, listo para empezar de cero.');
  await pool.end();
}

reset();

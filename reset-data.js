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
  console.log('\nListo. Los usuarios (login) no se tocaron — todos pueden seguir entrando igual.');
  console.log('El sistema quedó vacío, listo para empezar de cero.');
  await pool.end();
}

reset();

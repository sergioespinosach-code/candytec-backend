/**
 * seed.js — Crea ÚNICAMENTE los usuarios reales del equipo CandyTec.
 * NO carga clientes, pedidos, producción ni ningún dato de prueba.
 * El sistema arranca completamente vacío para que empieces a operar desde cero.
 *
 * Cómo correrlo (una sola vez):
 *   En Render → tu servicio "candytec-backend" → pestaña "Shell" → ejecutar:
 *     npm run seed
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

// Contraseña temporal compartida para el primer ingreso de todos.
// IMPORTANTE: cada persona debe cambiarla apenas entre (ver README, sección "Cambiar contraseña").
const TEMP_PASSWORD = 'CandyTec2026!';

const USERS = [
  { username: 'v_bayron',    name: 'Bayron Pesantez',   role: 'vendedor' },
  { username: 'v_luisb',     name: 'Luis Barragán',     role: 'vendedor' },
  { username: 'v_johnny',    name: 'Johnny Hernández',  role: 'vendedor' },
  { username: 'v_diego',     name: 'Diego Pilatuña',    role: 'vendedor' },
  { username: 'v_lidia',     name: 'Lidia Santos',      role: 'vendedor' },
  { username: 'v_mayra',     name: 'Mayra Pérez',       role: 'vendedor' },
  { username: 'v_lizeth',    name: 'Lizeth Salazar',    role: 'vendedor' },
  { username: 'jventas',     name: 'Cristian Pilatuña', role: 'jventas' },
  { username: 'facturacion', name: 'Nathalia Cabrera',  role: 'facturacion' },
  { username: 'bodega',      name: 'Erika Usiña',       role: 'bodega' },
  { username: 'produccion',  name: 'Jefe de Producción',role: 'produccion' },
  { username: 'gerente_proy',name: 'Sergio Andrés Espinosa', role: 'gerente' },
  { username: 'gerente',     name: 'Sergio Espinosa',   role: 'gerente' },
];

async function seed() {
  console.log('Creando usuarios reales (sin datos de prueba)...\n');
  // Si el usuario 'jefe' ya existía de una versión anterior, lo renombramos a 'produccion'
  // sin borrar nada (su historial de producciones queda intacto).
  try {
    const old = await pool.query("SELECT id FROM users WHERE username = 'jefe'");
    if (old.rows.length) {
      await pool.query("UPDATE users SET username = 'produccion' WHERE username = 'jefe'");
      console.log("— Usuario 'jefe' renombrado a 'produccion'\n");
    }
  } catch (e) { /* tabla nueva, no hay nada que renombrar */ }

  const hashed = await bcrypt.hash(TEMP_PASSWORD, 10);

  for (const u of USERS) {
    try {
      const exists = await pool.query('SELECT id FROM users WHERE username = $1', [u.username]);
      if (exists.rows.length) {
        console.log(`— ${u.username} ya existía, se dejó igual`);
        continue;
      }
      await pool.query(
        'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
        [u.username, hashed, u.name, u.role]
      );
      console.log(`✓ ${u.name}  (usuario: ${u.username})`);
    } catch (err) {
      console.error(`✗ Error creando ${u.username}:`, err.message);
    }
  }

  console.log(`\nListo. Contraseña temporal para todos: ${TEMP_PASSWORD}`);
  console.log('Cada persona debe cambiarla en su primer ingreso.');
  console.log('\nNo se cargó ningún cliente, pedido, producción ni movimiento.');
  console.log('El sistema está listo para operar desde cero.');
  await pool.end();
}

seed();

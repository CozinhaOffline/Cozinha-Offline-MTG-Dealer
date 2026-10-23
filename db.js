const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cartas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      nome_pt TEXT,
      qtd INTEGER DEFAULT 1,
      set_name TEXT,
      set_code TEXT,
      scryfall_id TEXT,
      cond TEXT,
      lang TEXT,
      extras TEXT,
      foil INTEGER DEFAULT 0,
      pasta TEXT,
      ml REAL DEFAULT 0,
      custo REAL DEFAULT 0,
      pvs REAL DEFAULT 0,
      liquidez TEXT DEFAULT 'C',
      codigo TEXT,
      desconto REAL DEFAULT 0,
      obs TEXT,
      operacao TEXT,
      depara TEXT,
      data TEXT,
      atualizado_em TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE cartas ADD COLUMN IF NOT EXISTS cor TEXT`);
  await pool.query(`ALTER TABLE cartas ADD COLUMN IF NOT EXISTS raridade TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS classe_a (nome TEXT PRIMARY KEY)`);
}

init().catch(err => console.error('Erro ao criar tabela:', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};

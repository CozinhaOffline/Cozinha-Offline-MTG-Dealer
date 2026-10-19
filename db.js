const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'estoque.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS cartas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
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
    atualizado_em TEXT
  )`);
});

module.exports = db;

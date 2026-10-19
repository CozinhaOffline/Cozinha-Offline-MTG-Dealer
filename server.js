const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { buscarPrecoLigamagic } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Listar estoque
app.get('/api/estoque', (req, res) => {
  db.all('SELECT * FROM cartas ORDER BY nome', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Importar / substituir estoque
app.post('/api/estoque/importar', (req, res) => {
  const cartas = req.body;
  if (!Array.isArray(cartas)) return res.status(400).json({ error: 'Envie um array de cartas' });

  db.serialize(() => {
    db.run('DELETE FROM cartas');
    const stmt = db.prepare(`INSERT INTO cartas 
      (nome, qtd, set_name, set_code, scryfall_id, cond, lang, extras, foil, pasta, ml, custo, pvs, liquidez)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    cartas.forEach(c => {
      stmt.run(
        c.nome, c.qtd || 1, c.set || '', c.setCode || '', c.scryfallId || '',
        c.cond || 'NM', c.lang || 'EN', c.extras || '', c.foil ? 1 : 0,
        c.pasta || 'Geral', c.ml || 0, c.custo || 0, c.pvs || 0, c.liquidez || 'C'
      );
    });
    stmt.finalize();
  });

  res.json({ ok: true, importadas: cartas.length });
});

// Atualizar uma carta
app.put('/api/estoque/:id', (req, res) => {
  const { id } = req.params;
  const campos = req.body;
  const sets = [];
  const vals = [];
  Object.keys(campos).forEach(k => {
    sets.push(`${k} = ?`);
    vals.push(campos[k]);
  });
  vals.push(id);
  db.run(`UPDATE cartas SET ${sets.join(', ')} WHERE id = ?`, vals, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// Atualizar ML de todas as cartas (consulta Ligamagic)
app.post('/api/atualizar-ml', async (req, res) => {
  db.all('SELECT id, nome FROM cartas', [], async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let atualizadas = 0;
    for (const row of rows) {
      const preco = await buscarPrecoLigamagic(row.nome);
      if (preco !== null) {
        await new Promise(resolve => {
          db.run('UPDATE cartas SET ml = ?, atualizado_em = datetime("now") WHERE id = ?', [preco, row.id], resolve);
        });
        atualizadas++;
      }
      // Pausa para não sobrecarregar a Ligamagic
      await new Promise(r => setTimeout(r, 800));
    }
    res.json({ ok: true, atualizadas, total: rows.length });
  });
});

app.listen(PORT, () => {
  console.log(`Plataforma rodando em http://localhost:${PORT}`);
});

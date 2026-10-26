const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { buscarPrecoLigamagic } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Listar estoque
app.get('/api/estoque', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM cartas ORDER BY nome');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Substituir estoque completo (usado em exclusões e sincronização total)
app.post('/api/estoque/substituir', async (req, res) => {
  const cartas = req.body;
  if (!Array.isArray(cartas)) return res.status(400).json({ error: 'Envie um array de cartas' });

  try {
    await db.query('DELETE FROM cartas');
    for (const c of cartas) {
      await db.query(
        `INSERT INTO cartas (nome, nome_pt, qtd, set_name, set_code, scryfall_id, cond, lang, extras, foil, pasta, ml, custo, pvs, liquidez, codigo, desconto, obs, operacao, depara, data, cor, raridade, pvs_manual)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [
          c.nome, c.nomePt || '', c.qtd || 1, c.set || '', c.setCode || '', c.scryfallId || '',
          c.cond || 'NM', c.lang || 'EN', c.extras || '', c.foil ? 1 : 0,
          c.pasta || 'Geral', c.ml || 0, c.custo || 0, c.pvs || 0, c.liquidez || 'C',
          c.codigo || '', c.desconto || 0, c.obs || '', c.operacao || '', c.depara || '', c.data || '',
          c.cor || '', c.raridade || '', c.pvsManual ? 1 : 0
        ]
      );
    }
    res.json({ ok: true, total: cartas.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Importar / adicionar ao estoque (sem apagar o existente)
app.post('/api/estoque/importar', async (req, res) => {
  const cartas = req.body;
  if (!Array.isArray(cartas)) return res.status(400).json({ error: 'Envie um array de cartas' });

  try {
    for (const c of cartas) {
      await db.query(
        `INSERT INTO cartas (nome, nome_pt, qtd, set_name, set_code, scryfall_id, cond, lang, extras, foil, pasta, ml, custo, pvs, liquidez, codigo, desconto, obs, operacao, depara, data, cor, raridade, pvs_manual)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [
          c.nome, c.nomePt || '', c.qtd || 1, c.set || '', c.setCode || '', c.scryfallId || '',
          c.cond || 'NM', c.lang || 'EN', c.extras || '', c.foil ? 1 : 0,
          c.pasta || 'Geral', c.ml || 0, c.custo || 0, c.pvs || 0, c.liquidez || 'C',
          c.codigo || '', c.desconto || 0, c.obs || '', c.operacao || '', c.depara || '', c.data || '',
          c.cor || '', c.raridade || '', c.pvsManual ? 1 : 0
        ]
      );
    }
    res.json({ ok: true, importadas: cartas.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar uma carta
app.put('/api/estoque/:id', async (req, res) => {
  const { id } = req.params;
  const campos = req.body;
  const sets = [];
  const vals = [];
  let i = 1;
  Object.keys(campos).forEach(k => {
    sets.push(`${k} = $${i++}`);
    vals.push(campos[k]);
  });
  vals.push(id);
  try {
    await db.query(`UPDATE cartas SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atualizar ML de todas as cartas
app.post('/api/atualizar-ml', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, nome FROM cartas');
    let atualizadas = 0;
    for (const row of rows) {
      const preco = await buscarPrecoLigamagic(row.nome);
      if (preco !== null) {
        await db.query('UPDATE cartas SET ml = $1, atualizado_em = NOW() WHERE id = $2', [preco, row.id]);
        atualizadas++;
      }
      await new Promise(r => setTimeout(r, 350));
    }
    res.json({ ok: true, atualizadas, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teste de conexão com o banco
app.get('/api/status', async (req, res) => {
  const versao = 'pg-v2';
  if (!process.env.DATABASE_URL) {
    return res.json({ ok: false, versao, banco: 'falhou', erro: 'DATABASE_URL nao esta configurada no Render' });
  }
  if (typeof db.query !== 'function') {
    return res.json({ ok: false, versao, banco: 'falhou', erro: 'O arquivo db.js antigo ainda esta no ar. Substitua db.js e package.json.' });
  }
  try {
    const { rows } = await db.query('SELECT COUNT(*) AS total FROM cartas');
    res.json({ ok: true, versao, total: rows[0].total, banco: 'conectado' });
  } catch (err) {
    res.json({ ok: false, versao, erro: err.message, banco: 'falhou' });
  }
});

app.get('/api/classe-a', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT nome FROM classe_a ORDER BY nome');
    res.json(rows.map(r => r.nome));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/classe-a', async (req, res) => {
  const nomes = Array.isArray(req.body) ? req.body : (req.body && req.body.nomes);
  if (!Array.isArray(nomes)) return res.status(400).json({ error: 'Envie uma lista de nomes' });
  try {
    await db.query('DELETE FROM classe_a');
    for (const nome of nomes) {
      const n = String(nome || '').trim();
      if (!n) continue;
      await db.query('INSERT INTO classe_a (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [n]);
    }
    res.json({ ok: true, total: nomes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/:chave', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT valor FROM config WHERE chave = $1', [req.params.chave]);
    if (!rows.length || !rows[0].valor) return res.json(null);
    res.json(JSON.parse(rows[0].valor));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config/:chave', async (req, res) => {
  try {
    await db.query(
      `INSERT INTO config (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [req.params.chave, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Plataforma rodando em http://localhost:${PORT}`);
});

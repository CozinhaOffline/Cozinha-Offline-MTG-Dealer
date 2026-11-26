const express = require('express');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');
const { buscarPrecoLigamagic } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return salt + ':' + hash;
}

function confereSenha(senha, armazenada) {
  const partes = String(armazenada || '').split(':');
  if (partes.length !== 2) return false;
  const [salt, hash] = partes;
  let novo;
  try { novo = crypto.scryptSync(String(senha), salt, 32); }
  catch (e) { return false; }
  const antigo = Buffer.from(hash, 'hex');
  if (antigo.length !== novo.length) return false;
  return crypto.timingSafeEqual(antigo, novo);
}

const PAPEIS = ['admin', 'socio', 'cliente'];

async function usuarioDaReq(req) {
  const h = String(req.get('authorization') || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.login, u.nome, u.papel
     FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = $1 AND s.expira_em > NOW() AND u.ativo = 1`,
    [token]
  );
  return rows[0] || null;
}

function permitido(papel, method, path) {
  if (papel === 'admin') return true;
  if (method === 'GET' && path === '/api/eu') return true;
  if (method === 'POST' && path === '/api/logout') return true;
  if (papel === 'socio') {
    if (method !== 'GET') return false;
    if (path === '/api/estoque' || path === '/api/classe-a') return true;
    if (path.startsWith('/api/config/')) {
      const chave = decodeURIComponent(path.slice('/api/config/'.length));
      return ['orcamentos', 'saidas', 'pastas-meta', 'regras-pvs'].includes(chave);
    }
    return false;
  }
  if (papel === 'cliente') {
    if (method !== 'GET') return false;
    if (path === '/api/estoque' || path === '/api/classe-a') return true;
    if (path === '/api/edhrec') return true;
    return false;
  }
  return false;
}

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/login' || req.path === '/api/status') return next();
  try {
    const usuario = await usuarioDaReq(req);
    if (!usuario) return res.status(401).json({ error: 'Faça login.' });
    if (!permitido(usuario.papel, req.method, req.path)) {
      return res.status(403).json({ error: 'Seu perfil não pode fazer isso.' });
    }
    req.usuario = usuario;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const login = String((req.body && req.body.login) || '').trim().toLowerCase();
  const senha = String((req.body && req.body.senha) || '');
  if (!login || !senha) return res.status(400).json({ error: 'Informe usuário e senha.' });
  try {
    const { rows } = await db.query('SELECT * FROM usuarios WHERE lower(login) = $1 AND ativo = 1', [login]);
    const u = rows[0];
    if (!u || !confereSenha(senha, u.senha_hash)) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES ($1, $2, NOW() + INTERVAL \'14 days\')', [token, u.id]);
    res.json({ token, usuario: { id: u.id, login: u.login, nome: u.nome, papel: u.papel } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  const h = String(req.get('authorization') || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token) await db.query('DELETE FROM sessoes WHERE token = $1', [token]).catch(() => {});
  res.json({ ok: true });
});

app.get('/api/eu', (req, res) => {
  res.json(req.usuario);
});

app.get('/api/usuarios', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, login, nome, papel, ativo, criado_em FROM usuarios ORDER BY nome');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/usuarios', async (req, res) => {
  const login = String((req.body && req.body.login) || '').trim().toLowerCase();
  const nome = String((req.body && req.body.nome) || '').trim();
  const senha = String((req.body && req.body.senha) || '');
  const papel = String((req.body && req.body.papel) || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) return res.status(400).json({ error: 'Usuário: 3 a 40 letras ou números, sem espaço.' });
  if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
  if (senha.length < 4) return res.status(400).json({ error: 'A senha precisa de pelo menos 4 caracteres.' });
  if (!PAPEIS.includes(papel)) return res.status(400).json({ error: 'Perfil inválido.' });
  try {
    const { rows } = await db.query(
      'INSERT INTO usuarios (login, nome, senha_hash, papel) VALUES ($1, $2, $3, $4) RETURNING id, login, nome, papel, ativo',
      [login, nome, hashSenha(senha), papel]
    );
    res.json(rows[0]);
  } catch (err) {
    if (String(err.message).includes('duplicate') || err.code === '23505') {
      return res.status(400).json({ error: 'Já existe uma conta com esse usuário.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Usuário inválido.' });
  const nome = req.body && req.body.nome != null ? String(req.body.nome).trim() : null;
  const papel = req.body && req.body.papel != null ? String(req.body.papel) : null;
  const senha = req.body && req.body.senha ? String(req.body.senha) : '';
  const ativo = req.body && req.body.ativo != null ? (req.body.ativo ? 1 : 0) : null;
  if (papel && !PAPEIS.includes(papel)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (senha && senha.length < 4) return res.status(400).json({ error: 'A senha precisa de pelo menos 4 caracteres.' });
  try {
    const atual = await db.query('SELECT id, papel, ativo FROM usuarios WHERE id = $1', [id]);
    if (!atual.rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const eraAdmin = atual.rows[0].papel === 'admin' && atual.rows[0].ativo === 1;
    const continuaAdmin = (papel || atual.rows[0].papel) === 'admin' && (ativo == null ? atual.rows[0].ativo : ativo) === 1;
    if (eraAdmin && !continuaAdmin) {
      const outros = await db.query('SELECT COUNT(*)::int AS n FROM usuarios WHERE papel = \'admin\' AND ativo = 1 AND id <> $1', [id]);
      if (!outros.rows[0].n) return res.status(400).json({ error: 'Tem que ficar pelo menos um administrador ativo.' });
    }
    const sets = [];
    const vals = [];
    function add(col, val) { vals.push(val); sets.push(col + ' = $' + vals.length); }
    if (nome) add('nome', nome);
    if (papel) add('papel', papel);
    if (senha) add('senha_hash', hashSenha(senha));
    if (ativo != null) add('ativo', ativo);
    if (!sets.length) return res.status(400).json({ error: 'Nada para alterar.' });
    vals.push(id);
    const { rows } = await db.query(
      `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, login, nome, papel, ativo`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function garantirAdmin() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n > 0) return;
  await db.query(
    'INSERT INTO usuarios (login, nome, senha_hash, papel) VALUES ($1, $2, $3, $4)',
    ['admin', 'Administrador', hashSenha('123456'), 'admin']
  );
  console.log('Conta inicial criada: usuario admin');
}

db.ready.then(garantirAdmin).catch(err => console.error('Erro ao preparar contas:', err));

// Listar estoque
app.get('/api/estoque', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM cartas ORDER BY nome');
    const lista = req.usuario && req.usuario.papel === 'cliente'
      ? rows.map(c => ({
          id: c.id, nome: c.nome, nome_pt: c.nome_pt, qtd: c.qtd,
          set_name: c.set_name, set_code: c.set_code, scryfall_id: c.scryfall_id,
          cond: c.cond, lang: c.lang, extras: c.extras, foil: c.foil,
          pvs: c.pvs, liquidez: c.liquidez, cor: c.cor, raridade: c.raridade
        }))
      : rows;
    const body = JSON.stringify(lista);
    if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
      zlib.gzip(body, (err, buf) => {
        if (err) return res.type('json').send(body);
        res.setHeader('Content-Encoding', 'gzip');
        res.type('json').send(buf);
      });
    } else {
      res.type('json').send(body);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function numero(v, fallback) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v == null || v === '') return fallback;
  let s = String(v).trim().replace(/[R$\s%]/g, '');
  if (!s) return fallback;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function valoresCarta(c) {
  const qtd = Math.max(0, Math.round(numero(c.qtd, 1)));
  return [
    c.nome || 'Sem nome', c.nomePt || '', qtd,
    c.set || '', c.setCode || '', c.scryfallId || '',
    c.cond || 'NM', c.lang || 'EN', c.extras || '', c.foil ? 1 : 0,
    c.pasta || 'Geral', numero(c.ml, 0), numero(c.custo, 0), numero(c.pvs, 0), c.liquidez || 'C',
    c.codigo || '', numero(c.desconto, 0), c.obs || '', c.operacao || '', c.depara || '', c.data || '',
    c.cor || '', c.raridade || '', c.pvsManual ? 1 : 0
  ];
}

const COLS_CARTA = `(nome, nome_pt, qtd, set_name, set_code, scryfall_id, cond, lang, extras, foil, pasta, ml, custo, pvs, liquidez, codigo, desconto, obs, operacao, depara, data, cor, raridade, pvs_manual)`;

async function inserirEmLote(client, cartas) {
  const tamanho = 200;
  const nCols = 24;
  for (let i = 0; i < cartas.length; i += tamanho) {
    const fatia = cartas.slice(i, i + tamanho);
    const valores = [];
    const marcas = fatia.map((c, idx) => {
      valores.push(...valoresCarta(c));
      const inicio = idx * nCols;
      return `(${Array.from({ length: nCols }, (_, k) => '$' + (inicio + k + 1)).join(',')})`;
    });
    await client.query(`INSERT INTO cartas ${COLS_CARTA} VALUES ${marcas.join(',')}`, valores);
  }
}

// Substituir estoque completo. Tudo acontece numa transação:
// se a gravação falhar no meio, o estoque antigo continua inteiro.
app.post('/api/estoque/substituir', async (req, res) => {
  const cartas = req.body;
  if (!Array.isArray(cartas)) return res.status(400).json({ error: 'Envie um array de cartas' });
  if (cartas.length > 200000) return res.status(400).json({ error: 'Lote grande demais' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const atual = await client.query('SELECT COUNT(*)::int AS n FROM cartas');
    const tinha = atual.rows[0].n;
    const forcar = req.get('x-forcar') === 'sim';
    if (!forcar && tinha > 20 && cartas.length < tinha * 0.95) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Gravação bloqueada para não apagar estoque. O navegador enviou ${cartas.length} cartas e o banco tem ${tinha}. Recarregue a página.`,
        banco: tinha,
        enviado: cartas.length
      });
    }
    await client.query('DELETE FROM cartas');
    await inserirEmLote(client, cartas);
    await client.query('COMMIT');
    res.json({ ok: true, total: cartas.length, antes: tinha });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Importar / adicionar ao estoque (sem apagar o existente)
app.post('/api/estoque/importar', async (req, res) => {
  const cartas = req.body;
  if (!Array.isArray(cartas)) return res.status(400).json({ error: 'Envie um array de cartas' });
  if (!cartas.length) return res.json({ ok: true, importadas: 0 });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await inserirEmLote(client, cartas);
    await client.query('COMMIT');
    res.json({ ok: true, importadas: cartas.length });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
  const versao = 'pg-v5';
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

const edhCache = new Map();
const EDH_TTL = 6 * 60 * 60 * 1000;

function slugComandante(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function obterEdh(url) {
  const resp = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': 'CozinhaOfflineStore/1.0', 'Accept': 'application/json' },
    validateStatus: () => true
  });
  if (resp.status !== 200 || !resp.data || !resp.data.container) return null;
  return resp.data;
}

async function acharParEdh(slugA, slugB) {
  const raw = await obterEdh(`https://json.edhrec.com/pages/partners/${encodeURIComponent(slugA)}.json`);
  const listas = raw?.container?.json_dict?.cardlists || [];
  for (const cl of listas) {
    for (const c of cl.cardviews || []) {
      if (c.slug === slugB || c.sanitized === slugB) {
        return String(c.url || '').replace(/^\/commanders\//, '').replace(/\/$/, '');
      }
    }
  }
  return '';
}

function dadosEdh(raw, slug, nome, comandantes, tema) {
  const card = raw.container.json_dict?.card || {};
  const listas = (raw.container.json_dict?.cardlists || []).map(cl => ({
    tag: cl.tag || '',
    header: cl.header || '',
    cartas: (cl.cardviews || []).map(c => ({
      nome: c.name,
      sinergia: c.synergy || 0,
      decks: c.num_decks || 0,
      total: c.potential_decks || 0
    }))
  }));
  return {
    nome,
    comandantes,
    slug,
    url: `https://edhrec.com/commanders/${slug}${tema ? '/budget' : ''}`,
    decks: card.num_decks || 0,
    salt: card.salt || 0,
    cores: card.color_identity || [],
    cmc: card.cmc,
    contagens: {
      creature: raw.creature || 0,
      instant: raw.instant || 0,
      sorcery: raw.sorcery || 0,
      artifact: raw.artifact || 0,
      enchantment: raw.enchantment || 0,
      planeswalker: raw.planeswalker || 0,
      land: raw.land || 0,
      basic: raw.basic || 0,
      nonbasic: raw.nonbasic || 0
    },
    listas
  };
}

app.get('/api/edhrec', async (req, res) => {
  const nome = String(req.query.comandante || '').trim();
  const parceiro = String(req.query.parceiro || '').trim();
  const tema = req.query.tema === 'budget' ? 'budget' : '';
  if (!nome) return res.status(400).json({ error: 'Informe o comandante.' });
  const slugA = slugComandante(nome);
  const slugB = parceiro ? slugComandante(parceiro) : '';
  const cacheKey = `${slugA}|${slugB}|${tema}`;
  const hit = edhCache.get(cacheKey);
  if (hit && Date.now() - hit.em < EDH_TTL) return res.json(hit.dados);
  try {
    let slug = slugA;
    let comandantes = [nome];
    if (slugB) {
      if (slugB === slugA) return res.status(400).json({ error: 'O parceiro precisa ser outro comandante.' });
      slug = await acharParEdh(slugA, slugB) || await acharParEdh(slugB, slugA);
      if (!slug) return res.status(404).json({ error: 'Não encontrei essa dupla de parceiros no EDHREC. Use os nomes em inglês.' });
      comandantes = [nome, parceiro];
    }
    const path = tema ? `commanders/${slug}/budget` : `commanders/${slug}`;
    const raw = await obterEdh(`https://json.edhrec.com/pages/${path}.json`);
    if (!raw) return res.status(404).json({ error: 'Comandante não encontrado no EDHREC. Use o nome em inglês, como no Scryfall.' });
    const cardName = raw.container.json_dict?.card?.name;
    const titulo = slugB ? (cardName || `${nome} + ${parceiro}`) : (cardName || nome);
    if (!slugB && cardName) comandantes = [cardName];
    const dados = dadosEdh(raw, slug, titulo, comandantes, tema);
    edhCache.set(cacheKey, { em: Date.now(), dados });
    res.json(dados);
  } catch (err) {
    res.status(502).json({ error: 'Não consegui consultar o EDHREC agora. Tente de novo em instantes.' });
  }
});

app.listen(PORT, () => {
  console.log(`Plataforma rodando em http://localhost:${PORT}`);
});

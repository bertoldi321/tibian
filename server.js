import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './game.js';
import { createStore } from './store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PARTNERS = {
  forja: process.env.PARTNER_FORJA || '[Marca 1]',
  arsenal: process.env.PARTNER_ARSENAL || '[Marca 2]',
};
// COUPONS="RUNICA:marreta,OUTRO:marreta"
const COUPONS = Object.fromEntries(
  (process.env.COUPONS || 'RUNICA:marreta').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split(':')).filter(([c, w]) => c && G.WEAPONS[w]).map(([c, w]) => [c.toUpperCase(), w])
);

const store = await createStore();

// ---------- helpers ----------
let chain = Promise.resolve();
function locked(fn) {
  const p = chain.then(() => fn());
  chain = p.catch(() => {});
  return p;
}

async function mutate(docs, fn) {
  const backup = docs.map((d) => structuredClone(d));
  try {
    const r = await fn();
    await store.savePlayers(docs);
    return r;
  } catch (e) {
    docs.forEach((d, i) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, backup[i]); });
    throw e;
  }
}

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(pin, salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pin, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

const fails = new Map();
function guardLogin(nick) {
  const f = fails.get(nick);
  if (f && f.until > Date.now()) throw new G.GameError('Muitas tentativas. Espere 5 minutos.');
}
function noteFail(nick) {
  const f = fails.get(nick) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.n = 0; f.until = Date.now() + 5 * 60000; }
  fails.set(nick, f);
}

async function event(kind, text) {
  try { await store.addEvent({ at: Date.now(), kind, text }); } catch (e) { console.error('event', e); }
}

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16384) throw new G.GameError('Requisição grande demais.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new G.GameError('JSON inválido.'); }
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return token ? store.playerForToken(token) : undefined;
}
function requireMe(req) {
  const me = auth(req);
  if (!me) { const e = new G.GameError('Faça login de novo.'); e.status = 401; throw e; }
  return me;
}

function stateFor(me) {
  const now = Date.now();
  for (const p of store.all()) G.refresh(p, now);
  if (me) me.seenAt = now;
  return {
    now, nextReset: G.nextReset(now),
    me: me ? G.privateView(me, now) : null,
    players: store.all().map((p) => G.publicView(p, now)),
    events: store.events.slice(0, 30),
    partners: PARTNERS,
    catalog: {
      weapons: G.WEAPONS, layers: G.LAYERS, layerNames: G.LAYER_NAMES, tierNames: G.TIER_NAMES,
      paths: G.PATHS, maxBank: G.MAX_BANK, regen: G.REGEN_PER_DAY,
    },
  };
}

// ---------- API ----------
const NICK_RE = /^[\p{L}\p{N}_]{3,16}$/u;
const PIN_RE = /^\d{4,6}$/;

const routes = {
  'GET /api/health': async () => ({ ok: true, store: store.kind, players: store.players.size }),

  'GET /api/state': async (req) => stateFor(auth(req)),

  'POST /api/register': async (req, body) => locked(async () => {
    const nick = String(body.nick || '').trim();
    const pin = String(body.pin || '');
    const color = Math.max(0, Math.min(7, Number(body.color) | 0));
    if (!NICK_RE.test(nick)) throw new G.GameError('Nick com 3 a 16 letras, números ou _.');
    if (!PIN_RE.test(pin)) throw new G.GameError('PIN com 4 a 6 números.');
    if (store.findNick(nick)) throw new G.GameError('Esse nick já existe. Escolha outro ou entre.');
    const now = Date.now();
    const doc = G.newPlayer({ nick, pinHash: hashPin(pin), color, lot: store.players.size, now });
    await store.createPlayer(doc);
    const token = randomBytes(24).toString('hex');
    await store.addSession(token, doc.id);
    await event('chegou', `${nick} chegou na rua`);
    return { token, state: stateFor(doc) };
  }),

  'POST /api/login': async (req, body) => locked(async () => {
    const nick = String(body.nick || '').trim().toLowerCase();
    guardLogin(nick);
    const p = store.findNick(nick);
    if (!p || !checkPin(String(body.pin || ''), p.pinHash)) { noteFail(nick); throw new G.GameError('Nick ou PIN errado.'); }
    fails.delete(nick);
    const token = randomBytes(24).toString('hex');
    await store.addSession(token, p.id);
    return { token, state: stateFor(p) };
  }),

  'POST /api/attack': async (req, body) => locked(async () => {
    const me = requireMe(req);
    const tgt = store.get(body.target);
    if (!tgt) throw new G.GameError('Base não encontrada.');
    const now = Date.now();
    G.refresh(me, now); G.refresh(tgt, now);
    const receivers = [];
    const result = await mutate([me, tgt], async () => G.attack(me, tgt, String(body.layer), now));
    if (result.destroyed && result.payouts.length) {
      for (const pay of result.payouts) {
        const p = store.get(pay.id);
        if (p) { G.refresh(p, now); p.coins += pay.coins; receivers.push(p); }
      }
      await store.savePlayers(receivers);
    }
    const w = G.WEAPONS[result.weapon].name;
    if (result.destroyed) {
      await event('derrubou', `${me.nick} derrubou a base de ${tgt.nick} e o saque foi de ${result.loot} moedas`);
    } else {
      await event('ataque', `${me.nick} tirou ${result.dmg} do ${G.LAYER_NAMES[result.layer].toLowerCase()} de ${tgt.nick} com ${w}`);
    }
    if (result.broke) await event('quebrou', `A arma de ${me.nick} quebrou`);
    return { result, state: stateFor(me) };
  }),

  'POST /api/upgrade': async (req, body) => locked(async () => {
    const me = requireMe(req);
    G.refresh(me, Date.now());
    const r = await mutate([me], async () => G.upgrade(me, String(body.path)));
    await event('upgrade', `${me.nick} subiu ${G.PATHS[r.path].name} para o nível ${r.lvl}`);
    return { result: r, state: stateFor(me) };
  }),

  'POST /api/buy': async (req, body) => locked(async () => {
    const me = requireMe(req);
    G.refresh(me, Date.now());
    const r = await mutate([me], async () => G.buy(me, String(body.weapon)));
    const w = G.WEAPONS[r.weapon];
    const shop = w.shop === 'arsenal' ? `Arsenal ${PARTNERS.arsenal}` : `Forja ${PARTNERS.forja}`;
    await event('compra', `${me.nick} comprou ${w.name} na ${shop}`);
    return { result: r, state: stateFor(me) };
  }),

  'POST /api/equip': async (req, body) => locked(async () => {
    const me = requireMe(req);
    const r = await mutate([me], async () => G.equip(me, String(body.weapon)));
    return { result: r, state: stateFor(me) };
  }),

  'POST /api/coupon': async (req, body) => locked(async () => {
    const me = requireMe(req);
    const r = await mutate([me], async () => G.redeem(me, body.code, COUPONS));
    await event('cupom', `${me.nick} resgatou a ${G.WEAPONS[r.weapon].name}`);
    return { result: r, state: stateFor(me) };
  }),

  // Ajuda para testes: dá ações ou moedas a um jogador (exige ADMIN_KEY).
  'POST /api/admin/grant': async (req, body) => locked(async () => {
    if (!ADMIN_KEY || body.key !== ADMIN_KEY) { const e = new G.GameError('Proibido.'); e.status = 403; throw e; }
    const p = store.findNick(String(body.nick || ''));
    if (!p) throw new G.GameError('Jogador não encontrado.');
    G.refresh(p, Date.now());
    await mutate([p], async () => {
      p.tok.atk = Math.min(99, p.tok.atk + (Number(body.atk) | 0));
      p.tok.up = Math.min(99, p.tok.up + (Number(body.up) | 0));
      p.coins += Number(body.coins) || 0;
      if (body.clearShield) p.shieldUntil = null;
    });
    return { ok: true, me: G.privateView(p, Date.now()) };
  }),
};

// ---------- static ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) return send(res, 403, { error: 'Proibido.' });
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    const cache = ext === '.png' ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Não encontrado.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = `${req.method} ${url.pathname}`;
  const h = routes[key];
  if (!h) {
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido.' });
    return serveStatic(req, res, url.pathname);
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await h(req, body);
    send(res, 200, out);
  } catch (e) {
    if (e instanceof G.GameError) return send(res, e.status || 400, { error: e.message });
    console.error(key, e);
    send(res, 500, { error: 'Erro no servidor. Tente de novo.' });
  }
});

server.listen(PORT, () => console.log(`Tibian na porta ${PORT} · armazenamento: ${store.kind} · jogadores: ${store.players.size}`));

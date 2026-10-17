// Teste rápido de ponta a ponta: sobe o servidor em memória e joga algumas rodadas.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 3911;
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: 'k', COUPONS: 'RUNICA:marreta' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

async function call(path, body, token) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
let fails = 0;
async function check(name, fn) {
  try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); }
}

let A, B, C;
await check('health', async () => { const r = await call('/api/health'); assert.equal(r.data.ok, true); });
await check('estáticos', async () => {
  for (const p of ['/', '/app.js', '/style.css', '/assets/lot1S.png', '/assets/grass.png']) {
    const r = await fetch(BASE + p); assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(BASE + '/../server.js')).status !== 200, true);
});
await check('registro', async () => {
  A = await call('/api/register', { nick: 'Kaio_br', pin: '1234', color: 0 });
  assert.equal(A.status, 200); assert.ok(A.data.token); assert.equal(A.data.state.me.lot, 0);
  B = await call('/api/register', { nick: 'Nyx', pin: '9999', color: 1 });
  C = await call('/api/register', { nick: 'Zé_Ferro', pin: '4321', color: 2 });
  assert.equal(C.data.state.me.lot, 2);
});
await check('nick repetido e validações', async () => {
  assert.equal((await call('/api/register', { nick: 'kaio_BR', pin: '1234' })).status, 400);
  assert.equal((await call('/api/register', { nick: 'ab', pin: '1234' })).status, 400);
  assert.equal((await call('/api/register', { nick: 'Teste', pin: '12' })).status, 400);
});
await check('login', async () => {
  const r = await call('/api/login', { nick: 'nyx', pin: '9999' }); assert.equal(r.status, 200);
  const bad = await call('/api/login', { nick: 'nyx', pin: '0000' }); assert.equal(bad.status, 400);
});
await check('sem login não ataca', async () => {
  assert.equal((await call('/api/attack', { target: 1, layer: 'cerca' })).status, 401);
});
await check('escudo de novato bloqueia ataque', async () => {
  const r = await call('/api/attack', { target: 1, layer: 'cerca' }, B.data.token);
  assert.equal(r.status, 400); assert.match(r.data.error, /escudo/);
});
// tira escudos e dá ações para testar
for (const n of ['Kaio_br', 'Nyx', 'Zé_Ferro']) await call('/api/admin/grant', { key: 'k', nick: n, atk: 30, up: 5, coins: 2000, clearShield: true });
await check('admin protegido', async () => { assert.equal((await call('/api/admin/grant', { key: 'x', nick: 'Nyx' })).status, 403); });
await check('camada travada', async () => {
  const r = await call('/api/attack', { target: 1, layer: 'muro' }, B.data.token);
  assert.equal(r.status, 400); assert.match(r.data.error, /ainda não/);
});
await check('não ataca a si mesmo', async () => {
  assert.equal((await call('/api/attack', { target: 2, layer: 'cerca' }, B.data.token)).status, 400);
});
await check('upgrade', async () => {
  const r = await call('/api/upgrade', { path: 'atk' }, B.data.token);
  assert.equal(r.status, 200); assert.equal(r.data.state.me.up.atk, 1); assert.equal(r.data.state.me.level, 2);
});
await check('compra e equipa', async () => {
  const r = await call('/api/buy', { weapon: 'martelo' }, B.data.token);
  assert.equal(r.status, 200); assert.equal(r.data.state.me.weapon, 'martelo'); assert.equal(r.data.state.me.inv.martelo, 10);
  const lv = await call('/api/buy', { weapon: 'lanca' }, B.data.token); assert.equal(lv.status, 400);
  const eq = await call('/api/equip', { weapon: 'punhos' }, B.data.token); assert.equal(eq.data.state.me.weapon, 'punhos');
  await call('/api/equip', { weapon: 'martelo' }, B.data.token);
});
await check('cupom', async () => {
  const r = await call('/api/coupon', { code: 'runica' }, C.data.token);
  assert.equal(r.status, 200); assert.equal(r.data.state.me.weapon, 'marreta');
  assert.equal((await call('/api/coupon', { code: 'RUNICA' }, C.data.token)).status, 400);
  assert.equal((await call('/api/coupon', { code: 'NADA' }, C.data.token)).status, 400);
});
await check('ataques até derrubar a base', async () => {
  let destroyed = false, guard = 0, coinsBefore;
  const st = await call('/api/state', null, A.data.token); coinsBefore = st.data.state?.me?.coins ?? st.data.me.coins;
  while (!destroyed && guard++ < 40) {
    const s = (await call('/api/state', null, B.data.token)).data;
    const t = s.players.find((p) => p.id === 1);
    const order = ['cerca', 'portao', 'muro', 'nucleo'];
    const dead = (l) => t.hp[l] * t.max[l] < 1;
    let layer = 'cerca';
    if (dead('cerca')) layer = dead('portao') || dead('muro') ? 'nucleo' : 'portao';
    const who = guard % 2 ? B : C;
    const r = await call('/api/attack', { target: 1, layer }, who.data.token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    destroyed = r.data.result.destroyed;
    if (destroyed) {
      assert.ok(r.data.result.loot > 0);
      const after = r.data.state.players.find((p) => p.id === 1);
      assert.equal(after.fallen, true); assert.ok(after.shieldUntil);
    }
  }
  assert.ok(destroyed, 'base não caiu');
  const a = (await call('/api/state', null, A.data.token)).data.me;
  assert.ok(a.coins < coinsBefore, 'alvo devia perder moedas');
  assert.equal(a.falls, 1);
});
await check('arma quebra e volta aos punhos', async () => {
  const s = (await call('/api/state', null, B.data.token)).data.me;
  assert.ok(s.weapon === 'punhos' || s.inv[s.weapon] > 0);
});
await check('sem ações não ataca', async () => {
  const r = await call('/api/register', { nick: 'Novo', pin: '1111' });
  await call('/api/admin/grant', { key: 'k', nick: 'Zé_Ferro', clearShield: true });
  const a1 = await call('/api/attack', { target: 3, layer: 'cerca' }, r.data.token);
  assert.equal(a1.status, 200);
  const a2 = await call('/api/attack', { target: 3, layer: 'cerca' }, r.data.token);
  assert.equal(a2.status, 400); assert.match(a2.data.error, /já foi usado/);
});
await check('eventos', async () => {
  const s = (await call('/api/state')).data;
  assert.ok(s.events.length > 5); assert.equal(s.me, null);
});

srv.kill();
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);

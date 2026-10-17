// Tibian — cliente da Rua das Bases
const A = '/assets/';
const COL_W = 304, PAD = 40, TOP_Y = 56, BOT_Y = 456, ROAD_Y = 376, WORLD_H = 800;

let S = null;            // último estado do servidor
let skew = 0;            // relógio do servidor - relógio local
let token = loadToken();
let panel = null;        // { kind: 'base', id } | { kind: 'upgrade' } | ...
let selLayer = null;
let shopTab = 'forja';
let busy = false;
let worldW = 0;

const DEMO = new URLSearchParams(location.search).has('demo');
const $ = (s) => document.querySelector(s);
const world = $('#world'), viewport = $('#viewport'), sizer = $('#sizer');

function loadToken() { try { return localStorage.getItem('tibian_token') || ''; } catch { return ''; } }
function saveToken(t) { token = t; try { t ? localStorage.setItem('tibian_token', t) : localStorage.removeItem('tibian_token'); } catch {} }
const now = () => Date.now() + skew;

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const img = (src, attrs = {}) => h('img', { src: A + src, alt: '', ...attrs });

// ---------- API ----------
async function api(path, body) {
  const opt = { method: body ? 'POST' : 'GET', headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  let r;
  try { r = await fetch(path, opt); } catch { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { saveToken(''); S && (S.me = null); showLogin(); throw new Error(data.error || 'Faça login de novo.'); }
  if (!r.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}

function apply(state) {
  S = state;
  skew = state.now - Date.now();
  render();
}

async function refresh() {
  try { apply(await api('/api/state')); } catch (e) { /* silencioso no polling */ }
}

// ---------- helpers ----------
const W = () => S.catalog.weapons;
const LN = () => S.catalog.layerNames;
const eff = (n) => (1 - Math.pow(0.9, n)) / 0.1;
const pct = (v) => Math.round(v * 100) + '%';
function fmtClock(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return [hh, mm, ss].map((x) => String(x).padStart(2, '0')).join(':');
}
function ago(t) {
  const m = Math.floor((now() - t) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const hr = Math.floor(m / 60);
  return hr < 24 ? `há ${hr}h` : `há ${Math.floor(hr / 24)}d`;
}
function lotPos(lot) {
  const col = 1 + Math.floor(lot / 2), row = lot % 2;
  return { x: PAD + col * COL_W, y: row === 0 ? TOP_Y : BOT_Y, row, col };
}
const integrity = (p) => {
  let a = 0, b = 0;
  for (const l of S.catalog.layers) { a += p.hp[l] * p.max[l]; b += p.max[l]; }
  return b ? a / b : 1;
};
const me = () => S && S.me;
const playerById = (id) => S.players.find((p) => p.id === id);
const isNight = () => {
  const hr = new Date(now() - 3 * 3600000).getUTCHours();
  return hr >= 18 || hr < 6;
};

function toast(msg, bad) {
  const t = h('div', { class: 'toast panel' + (bad ? ' bad' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 4200 : 3000);
}

// ---------- render ----------
function render() {
  renderHud();
  renderWorld();
  renderPanel();
}

function renderHud() {
  const top = $('#hud-top'), bot = $('#hud-bottom');
  top.innerHTML = ''; bot.innerHTML = '';
  const m = me();
  if (!m) return;
  const wp = W()[m.weapon] || W().punhos;
  top.append(
    h('div', { class: 'me-card panel' },
      h('div', { class: 'portrait' }, img(`bust${m.color}.png`)),
      h('div', null, h('div', { class: 'me-name' }, m.nick), h('div', { class: 'me-sub' }, `Nv ${m.level} · ${S.catalog.tierNames[m.tier]}`))),
    h('div', { class: 'stat panel', title: `${m.income} moedas por dia` }, img('h_moeda.png'),
      h('div', null, h('span', { class: 'k' }, 'MOEDAS'), h('b', { class: 'gold' }, m.coins.toLocaleString('pt-BR')))),
    h('div', { class: 'stat atk' }, img('h_ataque.png'), h('div', null, h('span', { class: 'k' }, 'ATAQUE'), h('b', null, `${m.tok.atk} / ${S.catalog.maxBank}`))),
    h('div', { class: 'stat up' }, img('h_upgrade.png'), h('div', null, h('span', { class: 'k' }, 'UPGRADE'), h('b', null, `${m.tok.up} / ${S.catalog.maxBank}`))),
    h('div', { class: 'stat panel hide-sm' }, h('div', null, h('span', { class: 'k' }, 'NOVO DIA EM'), h('b', { id: 'clock' }, fmtClock(S.nextReset - now())))),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: () => open({ kind: 'rank' }) }, img('h_coroa.png'), h('span', { class: 'hide-sm' }, 'Ranking')),
    h('button', { class: 'btn ghost icon', 'aria-label': 'Como jogar', onclick: () => open({ kind: 'help' }) }, '?'),
  );
  const ev = S.events[0];
  bot.append(
    h('button', { class: 'weapon-card panel', onclick: () => { shopTab = 'mochila'; open({ kind: 'shop' }); } },
      h('div', { class: 'slot' }, wp.icon ? img(wp.icon + '.png') : h('span', { class: 'mono', style: 'font-size:10px' }, 'MÃOS')),
      h('div', null, h('div', { style: 'font-size:16px;font-weight:700' }, wp.name),
        h('div', { class: 'me-sub' }, `Dano ${wp.dano}` + (m.weapon !== 'punhos' ? ` · ${m.inv[m.weapon] || 0} usos` : '')))),
    h('div', { class: 'ticker panel' }, h('span', { class: 'dot' }), h('span', { class: 't' }, ev ? ev.text : 'A rua está calma.'), ev ? h('span', { class: 'muted', style: 'font-size:12px;flex:none' }, ago(ev.at)) : null),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn ghost', onclick: () => { scrollToLot(m.lot); open({ kind: 'base', id: m.id }); } }, 'Minha base'),
    h('button', { class: 'btn green', onclick: () => open({ kind: 'upgrade' }) }, img('h_upgrade.png'), 'Upgrade'),
    h('button', { class: 'btn', onclick: () => { shopTab = 'forja'; open({ kind: 'shop' }); } }, img('h_moeda.png'), 'Loja'),
  );
}

function renderWorld() {
  if (!S) return;
  const players = [...S.players].sort((a, b) => a.lot - b.lot);
  const n = players.length;
  const cols = 1 + Math.ceil((n + 1) / 2);
  const vw = viewport.clientWidth / scale();
  worldW = Math.max(PAD * 2 + cols * COL_W, Math.ceil(vw) + 20);
  world.innerHTML = '';
  world.style.width = worldW + 'px';
  world.append(h('div', { class: 'ground' }), h('div', { class: 'road' }));

  // decoração
  for (let x = -20, i = 0; x < worldW; x += COL_W, i++) {
    world.append(img(`tree${i % 3}.png`, { class: 'spr', style: `left:${x + 10}px;top:-34px;width:76px;height:88px` }));
    world.append(img(`tree${(i + 1) % 3}.png`, { class: 'spr', style: `left:${x + 150}px;top:-52px;width:76px;height:88px` }));
    world.append(img(`bush${i % 2}.png`, { class: 'spr', style: `left:${x + 60}px;top:764px;width:36px;height:32px` }));
  }
  const lamps = [];
  for (let c = 1; c <= cols; c++) {
    const gx = PAD + c * COL_W - 8;
    lamps.push([gx, ROAD_Y - 52], [gx, ROAD_Y + 44]);
    world.append(img('lamp.png', { class: 'spr', style: `left:${gx - 12}px;top:${ROAD_Y - 58}px;width:24px;height:64px` }));
    world.append(img('lamp.png', { class: 'spr', style: `left:${gx - 12}px;top:${ROAD_Y + 50}px;width:24px;height:64px` }));
  }

  // lojas parceiras
  const shops = [['forja', TOP_Y, 'Forja', S.partners.forja], ['arsenal', BOT_Y, 'Arsenal', S.partners.arsenal]];
  for (const [id, y, name, brand] of shops) {
    const el = h('div', { class: 'shop', style: `left:${PAD + 12}px;top:${y}px`, onclick: () => { shopTab = id; open({ kind: 'shop' }); } },
      img(id + '.png', { class: 'spr' }));
    world.append(el);
    world.append(h('button', { class: 'shop-sign', style: `left:${PAD + 70}px;top:${id === 'forja' ? y + 268 : y + 18}px`, onclick: () => { shopTab = id; open({ kind: 'shop' }); } },
      h('span', { class: 'k' }, 'LOJA PARCEIRA'), h('span', { class: 'n' }, name), h('span', { class: 'b' }, brand)));
  }
  world.append(img('ferreiro.png', { class: 'spr', style: `left:${PAD + 12 + 104}px;top:${TOP_Y + 88}px;width:60px;height:84px` }));

  // lotes
  const t = now();
  const topRank = [...players].sort((a, b) => b.trophies - a.trophies || b.level - a.level)[0];
  for (const p of players) {
    const { x, y, row } = lotPos(p.lot);
    const side = row === 0 ? 'S' : 'N';
    const mine = me() && p.id === me().id;
    const hurt = !p.fallen && (integrity(p) < 0.6 || (p.lastHitAt && t - p.lastHitAt < 6 * 3600000));
    const lot = h('div', { class: 'lot' + (mine ? ' mine' : ''), style: `left:${x}px;top:${y}px`, 'data-id': p.id, onclick: () => open({ kind: 'base', id: p.id }) },
      img(p.fallen ? `ruins${side}.png` : `lot${p.tier}${side}.png`, { class: 'spr base' }),
      hurt ? img(`dmg${side}.png`, { class: 'spr' }) : null,
      p.shieldUntil && !p.fallen ? h('div', { class: 'dome' }) : null);
    const plateY = row === 0 ? 256 : 40;
    const crown = topRank && topRank.trophies > 0 && topRank.id === p.id;
    lot.append(h('button', { class: 'plate' + (mine ? ' mine' : '') + (p.fallen ? ' fallen' : ''), style: `top:${plateY}px`, 'aria-label': `Base de ${p.nick}`,
      onclick: (e) => { e.stopPropagation(); open({ kind: 'base', id: p.id }); } },
      h('div', { class: 'row' }, crown ? img('h_coroa.png', { class: 'crown' }) : null, h('span', { class: 'n' }, p.nick)),
      h('div', { class: 'row' }, h('div', { class: 'bar' + (integrity(p) > 0.5 ? ' green' : ''), style: 'flex:1' }, h('i', { style: `width:${pct(integrity(p))}` })), h('span', { class: 'chip' }, 'NV ' + p.level))));
    if (p.shieldUntil) {
      lot.append(h('div', { class: 'tag', style: `left:12px;top:${row === 0 ? plateY - 22 : plateY + 58}px` },
        (p.fallen ? 'EM RUÍNAS · ' : 'ESCUDO · ') + fmtClock(p.shieldUntil - t).slice(0, 5)));
    }
    world.append(lot);
  }
  // próximo lote livre
  const free = lotPos(n);
  world.append(h('div', { class: 'free-lot', style: `left:${free.x + 8}px;top:${free.y + 40}px` }, h('span', null, 'Lote livre')));

  // personagens ativos (vistos nas últimas 24h)
  for (const p of players) {
    const mine = me() && p.id === me().id;
    if (!mine && !(p.seenAt && t - p.seenAt < 86400000)) continue;
    const { x, row } = lotPos(p.lot);
    const cy = row === 0 ? ROAD_Y - 16 : ROAD_Y + 22;
    const cx = row === 0 ? x + 196 : x + 30;
    world.append(h('div', { class: 'char' + (mine ? ' me' : ''), id: mine ? 'my-char' : null, style: `left:${cx}px;top:${cy}px` },
      h('span', { class: 'lbl' }, mine ? 'Você' : p.nick), img(`char${p.color}.png`)));
  }

  if (isNight()) {
    world.append(h('div', { class: 'night-shade' }));
    for (const [gx, gy] of lamps) world.append(h('div', { class: 'glow', style: `left:${gx}px;top:${gy}px` }));
    for (const p of players) {
      if (p.fallen || p.tier < 3) continue;
      const { x, y, row } = lotPos(p.lot);
      const gy = row === 0 ? y + 276 : y + 52;
      world.append(h('div', { class: 'glow', style: `left:${x + 112}px;top:${gy}px;width:120px;height:120px;margin:-60px 0 0 -60px` }));
      world.append(h('div', { class: 'glow', style: `left:${x + 176}px;top:${gy}px;width:120px;height:120px;margin:-60px 0 0 -60px` }));
    }
  }
  layout();
}

function scale() {
  const vh = viewport.clientHeight || 600;
  return Math.max(0.5, Math.min(1, vh / WORLD_H));
}
function layout() {
  const s = scale();
  world.style.transform = `scale(${s})`;
  sizer.style.width = Math.ceil(worldW * s) + 'px';
}
function scrollToLot(lot) {
  const { x } = lotPos(lot);
  const s = scale();
  viewport.scrollTo({ left: Math.max(0, (x + 144) * s - viewport.clientWidth / 2), behavior: 'smooth' });
}

// ---------- painéis ----------
function open(p) { panel = p; selLayer = null; renderPanel(); }
function close() { panel = null; renderPanel(); }

function renderPanel() {
  const root = $('#layer');
  root.innerHTML = '';
  if (!S || !me()) return;
  if (!panel) return;
  const view = {
    base: baseDrawer, upgrade: upgradeModal, shop: shopModal, rank: rankModal, help: helpModal,
  }[panel.kind];
  if (!view) return;
  const el = view();
  if (el) root.append(el);
}

function modal(content, narrow) {
  const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal panel' + (narrow ? ' narrow' : ''), role: 'dialog', 'aria-modal': 'true' }, content));
  return back;
}
const closeBtn = () => h('button', { class: 'btn ghost icon', 'aria-label': 'Fechar', onclick: close },
  h('span', { 'aria-hidden': 'true', style: 'display:flex', html: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 3 L13 13 M13 3 L3 13" fill="none" stroke="#f4ecd8" stroke-width="2.5" stroke-linecap="square"/></svg>' }));

function layerStatus(p, l) {
  const dead = (x) => p.hp[x] * p.max[x] < 1;
  if (dead(l)) return { open: false, txt: 'destruída' };
  if (l === 'cerca') return { open: true, txt: '' };
  if (!dead('cerca')) return { open: false, txt: 'abre quando a cerca cair' };
  if (l === 'nucleo' && !(dead('muro') || dead('portao'))) return { open: false, txt: 'abre quando muro ou portão cair' };
  return { open: true, txt: '' };
}

function baseDrawer() {
  const p = playerById(panel.id);
  if (!p) return null;
  const m = me();
  const mine = p.id === m.id;
  const t = now();
  const L = S.catalog.layers;
  const wp = W()[m.weapon] || W().punhos;
  const ups = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
    h('span', { class: 'chip', style: 'background:#4f79bf;color:#fff' }, `MURALHA ${p.up.def}`),
    h('span', { class: 'chip', style: 'background:#cd5a42;color:#fff' }, `FORJA ${p.up.atk}`),
    h('span', { class: 'chip' }, `MERCADO ${p.up.eco}`));
  const head = h('div', { class: 'head' },
    h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:4px' },
      h('span', { class: 'kicker' }, mine ? 'SUA BASE' : 'BASE DE'),
      h('h2', null, p.nick),
      h('span', { class: 'muted', style: 'font-size:14px' }, `Nv ${p.level} · ${S.catalog.tierNames[p.tier]} · ${p.trophies} troféu(s) · caiu ${p.falls}x`)),
    closeBtn());
  const kids = [head, ups];
  if (p.shieldUntil) kids.push(h('div', { class: 'inset', style: 'padding:10px 12px;font-size:14px;color:#d6ebff' },
    (p.fallen ? 'Base em ruínas, reconstruindo. ' : 'Protegida por escudo. ') + `Libera em ${fmtClock(p.shieldUntil - t).slice(0, 5)}.`));

  if (!selLayer || !layerStatus(p, selLayer).open) selLayer = L.find((l) => layerStatus(p, l).open) || null;
  const list = h('div', { class: 'layers' }, h('span', { class: 'kicker' }, mine ? 'CAMADAS' : 'ESCOLHA A CAMADA'));
  for (const l of L) {
    const st = layerStatus(p, l);
    const can = !mine && st.open && !p.shieldUntil;
    const btn = h('button', { class: 'layer' + (can && selLayer === l ? ' sel' : ''), disabled: !can, onclick: () => { selLayer = l; renderPanel(); } },
      h('div', { class: 'row' }, h('span', { class: 'nm' }, LN()[l]), h('span', { class: 'st' }, st.txt),
        h('span', { class: 'mono', style: 'font-size:11px' }, `${Math.round(p.hp[l] * p.max[l])}/${p.max[l]}`)),
      h('div', { class: 'bar' + (l === 'nucleo' ? ' gold' : '') }, h('i', { style: `width:${pct(p.hp[l])}` })));
    list.append(btn);
  }
  kids.push(list);

  if (mine) {
    kids.push(h('div', { class: 'inset', style: 'padding:12px;display:flex;flex-direction:column;gap:6px;font-size:15px' },
      h('div', null, `Vida das camadas: +${Math.round(15 * eff(p.up.def))}%`),
      h('div', null, `Dano dos seus ataques: +${Math.round(10 * eff(p.up.atk))}%`),
      h('div', null, `Moedas por dia: ${m.income}`)));
    kids.push(h('p', { class: 'note', style: 'margin:0' }, `As camadas recuperam ${Math.round(S.catalog.regen * 100)}% por dia. Quando o núcleo cai, quem atacou divide 25% das suas moedas e você ganha 24h de escudo.`));
    kids.push(h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' },
      h('button', { class: 'btn green', onclick: () => open({ kind: 'upgrade' }) }, img('h_upgrade.png'), 'Upgrade do dia'),
      h('button', { class: 'btn', onclick: () => { shopTab = 'forja'; open({ kind: 'shop' }); } }, 'Loja')));
  } else {
    kids.push(h('div', { class: 'inset', style: 'display:flex;align-items:center;gap:12px;padding:6px 12px 6px 6px' },
      h('div', { class: 'slot' }, wp.icon ? img(wp.icon + '.png') : h('span', { class: 'mono', style: 'font-size:10px' }, 'MÃOS')),
      h('div', { style: 'flex:1' }, h('div', { style: 'font-weight:700' }, wp.name), h('div', { class: 'me-sub' }, wp.effect)),
      h('button', { class: 'btn ghost', style: 'min-height:44px', onclick: () => { shopTab = 'mochila'; open({ kind: 'shop' }); } }, 'Trocar')));
    if (selLayer) {
      const base = wp.dano * m.dmgMult * (wp.bonus[selLayer] || 1);
      kids.push(h('div', { class: 'est' },
        h('div', null, h('div', { class: 'kicker', style: 'color:#ffb89a' }, 'DANO ESTIMADO'), h('b', null, `${Math.max(1, Math.round(base * 0.9))}–${Math.max(1, Math.round(base * 1.1))}`)),
        h('div', { style: 'text-align:right' }, h('div', { class: 'kicker' }, 'SE A BASE CAIR'), h('div', { class: 'gold', style: 'font-weight:600' }, '25% das moedas dele'))));
    }
    const can = m.tok.atk > 0 && !!selLayer && !p.shieldUntil;
    kids.push(h('div', { style: 'flex:1' }));
    kids.push(h('button', { class: 'btn red', style: 'width:100%;min-height:56px;font-size:21px', disabled: !can || busy, onclick: () => doAttack(p, selLayer) },
      img('h_ataque.png'), selLayer ? `Atacar ${LN()[selLayer].toLowerCase()}` : 'Nada para atacar'));
    kids.push(h('p', { class: 'note', style: 'margin:0' },
      m.tok.atk > 0 ? `Você tem ${m.tok.atk} ataque(s). Ataques não usados ficam guardados (até ${S.catalog.maxBank}).`
        : `Seu ataque de hoje já foi usado. Volta em ${fmtClock(S.nextReset - t).slice(0, 5)}.`));
  }
  return h('aside', { class: 'drawer panel', role: 'dialog', 'aria-label': `Base de ${p.nick}` }, kids);
}

function upgradeModal() {
  const m = me();
  const cards = [
    { id: 'def', band: '#2c4478', acc: '#76a0dc', img: 'v_defesa.png', label: 'DEFESA', name: 'Muralha',
      lines: (n) => [`Vida das camadas: +${Math.round(15 * eff(n))}%`, 'Sua base fica mais alta e robusta'] },
    { id: 'atk', band: '#8c3428', acc: '#e98262', img: 'v_ataque.png', label: 'ATAQUE', name: 'Forja',
      lines: (n) => [`Dano de qualquer arma: +${Math.round(10 * eff(n))}%`, 'Vale para todos os seus ataques'] },
    { id: 'eco', band: '#6b4a12', acc: '#f2cc55', img: 'v_economia.png', label: 'ECONOMIA', name: 'Mercado',
      lines: (n) => [`Moedas por dia: ${Math.round(40 + 20 * eff(n))}`, 'Mais moedas para a loja parceira'] },
  ];
  const grid = h('div', { class: 'grid3' });
  for (const c of cards) {
    const cur = m.up[c.id];
    grid.append(h('div', { class: 'card', style: `--acc:${c.acc}` },
      h('div', { class: 'band', style: `background:${c.band}` }, h('span', null, c.label), h('span', null, `NV ${cur} → ${cur + 1}`)),
      h('div', { class: 'pic' }, img(c.img, { alt: '' })),
      h('div', { class: 'body' },
        h('h3', null, c.name),
        ...c.lines(cur + 1).map((x) => h('div', { class: 'li' }, x)),
        h('div', { class: 'note' }, 'Hoje: ' + c.lines(cur)[0]),
        h('div', { style: 'flex:1' }),
        h('button', { class: 'btn green', disabled: m.tok.up < 1 || busy, onclick: () => doUpgrade(c.id) }, `Escolher ${c.name}`))));
  }
  return modal([
    h('div', { class: 'head' },
      h('div', { style: 'flex:1' }, h('h2', null, 'Upgrade do dia'),
        h('div', { class: 'muted', style: 'font-size:15px' }, `Escolha 1 caminho. Você tem ${m.tok.up} upgrade(s) guardado(s).`)),
      closeBtn()),
    grid,
    h('p', { class: 'note', style: 'margin:0' }, 'Cada nível no mesmo caminho rende um pouco menos que o anterior, então misturar compensa. Upgrades não usados ficam guardados por até 3 dias.' +
      (m.tok.up < 1 ? ` Próximo upgrade em ${fmtClock(S.nextReset - now()).slice(0, 5)}.` : '')),
  ]);
}

const RARITY = {
  comum: ['COMUM', '#52545f', '#fff'], raro: ['RARO', '#263d6e', '#fff'], epico: ['ÉPICO', '#48296a', '#fff'], lendario: ['LENDÁRIO', '#d9a52e', '#241816'],
};

function weaponCard(id, w, action) {
  const [rl, rb, rt] = RARITY[w.rarity];
  return h('div', { class: 'wcard', style: `box-shadow:0 0 0 3px #0a0d18, inset 0 0 0 2px ${rb}` },
    h('div', { class: 'band', style: `background:${rb};color:${rt}` }, h('span', null, rl), h('span', null, w.shop === 'cupom' ? 'EXCLUSIVA' : '')),
    h('div', { class: 'top' },
      h('div', { class: 'wslot' }, w.icon ? img(w.icon + '.png') : h('span', { class: 'mono' }, 'MÃOS')),
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:0' },
        h('b', { style: 'font-size:17px' }, w.name),
        h('span', { class: 'muted', style: 'font-size:13px' }, `Dano ${w.dano}` + (w.durab ? ` · ${w.durab} usos` : '')),
        h('span', { style: 'font-size:13px' }, w.effect))),
    h('div', { class: 'foot' }, ...action));
}

function shopModal() {
  const m = me();
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    ...[['forja', `Forja · ${S.partners.forja}`], ['arsenal', `Arsenal · ${S.partners.arsenal}`], ['mochila', 'Mochila']].map(([id, label]) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(shopTab === id), onclick: () => { shopTab = id; renderPanel(); } }, label)));
  const grid = h('div', { class: 'grid3' });
  const entries = Object.entries(W());
  if (shopTab === 'mochila') {
    const owned = [['punhos', W().punhos], ...entries.filter(([id]) => m.inv[id] > 0)];
    for (const [id, w] of owned) {
      const eq = m.weapon === id;
      grid.append(weaponCard(id, w, [
        h('span', { class: 'muted', style: 'font-size:14px' }, id === 'punhos' ? 'Sem limite' : `${m.inv[id]} usos restantes`),
        h('button', { class: 'btn ' + (eq ? 'ghost' : 'gold'), disabled: eq || busy, onclick: () => doEquip(id) }, eq ? 'Equipada' : 'Equipar')]));
    }
  } else {
    for (const [id, w] of entries.filter(([, w]) => w.shop === shopTab)) {
      const lockedLvl = w.minLevel && m.level < w.minLevel;
      const owned = m.inv[id] > 0;
      grid.append(weaponCard(id, w, [
        h('span', { class: 'price' }, img('h_moeda.png'), w.price),
        h('button', { class: 'btn green', disabled: lockedLvl || m.coins < w.price || busy, onclick: () => doBuy(id) },
          lockedLvl ? `Nível ${w.minLevel}` : owned ? 'Recarregar' : 'Comprar')]));
    }
    if (shopTab === 'forja') {
      const w = W().marreta;
      grid.append(weaponCard('marreta', w, [h('span', { class: 'muted', style: 'font-size:13px' }, `Código da ${S.partners.forja}`),
        h('span', { class: 'chip' }, 'CUPOM')]));
    }
  }
  const code = h('input', { class: 'f', id: 'cupom', placeholder: 'EX: CODIGO', autocomplete: 'off', style: 'text-transform:uppercase' });
  return modal([
    h('div', { class: 'head' },
      h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:4px' },
        h('span', { class: 'kicker', style: 'color:#f2cc55' }, 'LOJAS PARCEIRAS'),
        h('h2', null, shopTab === 'arsenal' ? 'Arsenal' : shopTab === 'mochila' ? 'Mochila' : 'Forja')),
      h('div', { class: 'stat panel', style: 'height:50px' }, img('h_moeda.png'), h('b', { class: 'gold' }, m.coins.toLocaleString('pt-BR'))),
      closeBtn()),
    tabs, grid,
    h('div', { style: 'display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap' },
      h('label', { class: 'f', for: 'cupom', style: 'flex:1;min-width:200px' }, 'CÓDIGO DO PARCEIRO', code),
      h('button', { class: 'btn gold', style: 'min-height:48px', onclick: () => doCoupon(code.value) }, 'Resgatar')),
    h('p', { class: 'note', style: 'margin:0' }, 'Cada ataque gasta 1 uso da arma. Quando acabam, ela quebra e você volta aos punhos. Comprar de novo recarrega.'),
  ]);
}

function rankModal() {
  const m = me();
  const rows = [...S.players].sort((a, b) => b.trophies - a.trophies || b.level - a.level || a.falls - b.falls);
  return modal([
    h('div', { class: 'head' }, h('div', { style: 'flex:1' }, h('h2', null, 'Ranking da rua')), closeBtn()),
    h('table', { class: 'rank' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'NICK'), h('th', null, 'NV'), h('th', null, 'TROFÉUS'), h('th', null, 'QUEDAS'))),
      h('tbody', null, rows.map((p, i) => h('tr', { class: p.id === m.id ? 'me' : '' },
        h('td', null, i + 1), h('td', null, p.nick), h('td', null, p.level), h('td', null, p.trophies), h('td', null, p.falls))))),
    h('span', { class: 'kicker' }, 'ÚLTIMOS ACONTECIMENTOS'),
    h('div', { class: 'feed' }, S.events.map((e) => h('div', null, h('time', null, ago(e.at)), h('span', null, e.text)))),
  ], true);
}

function helpModal() {
  const li = (t) => h('div', { class: 'li' }, t);
  return modal([
    h('div', { class: 'head' }, h('div', { style: 'flex:1' }, h('h2', null, 'Como jogar')), closeBtn()),
    li('Todo dia você ganha 1 ataque e 1 upgrade. Se não usar, eles ficam guardados (até 3).'),
    li('Upgrade: escolha entre Defesa (camadas mais fortes), Ataque (mais dano) ou Economia (mais moedas). Sua base cresce conforme o nível.'),
    li('Ataque: a cerca cai primeiro. Depois dá para bater no muro ou no portão. Quando um deles cai, o núcleo fica exposto.'),
    li('Derrubar o núcleo: quem atacou aquela base divide 25% das moedas dela, e o golpe final ganha um troféu.'),
    li('As camadas recuperam 10% por dia. Bases novas e bases derrubadas têm 24h de escudo.'),
    li('Lojas parceiras vendem armas melhores. Cada arma tem um bônus contra uma camada.'),
  ], true);
}

// ---------- ações ----------
async function act(fn) {
  if (busy) return;
  busy = true; renderPanel();
  try { await fn(); } catch (e) { toast(e.message, true); } finally { busy = false; renderPanel(); }
}

function doAttack(p, layer) {
  if (DEMO) {
    const wp = W()[me().weapon];
    return act(async () => { await animateHit(p, { dmg: Math.round(wp.dano * 1.1 * (wp.bonus[layer] || 1)), crit: false }); render(); demoOnly(); });
  }
  act(async () => {
    const r = await api('/api/attack', { target: p.id, layer });
    await animateHit(p, r.result);
    apply(r.state);
    const res = r.result;
    if (res.destroyed) toast(`Você derrubou a base de ${p.nick}! Saque total: ${res.loot} moedas.`);
    else toast(`${res.crit ? 'Crítico! ' : ''}${res.dmg} de dano no ${LN()[layer].toLowerCase()} de ${p.nick}.`);
    if (res.broke) toast('Sua arma quebrou. Passe na loja.', true);
  });
}
function doUpgrade(path) {
  if (DEMO) return demoOnly();
  act(async () => {
    const r = await api('/api/upgrade', { path });
    apply(r.state);
    toast(`${S.catalog.paths[path].name} subiu para o nível ${r.result.lvl}.`);
    close();
  });
}
function doBuy(id) { if (DEMO) return demoOnly(); act(async () => { const r = await api('/api/buy', { weapon: id }); apply(r.state); toast(`${W()[id].name} comprada e equipada.`); }); }
function doEquip(id) { if (DEMO) return demoOnly(); act(async () => { const r = await api('/api/equip', { weapon: id }); apply(r.state); }); }
function doCoupon(code) {
  if (DEMO) return demoOnly();
  if (!String(code).trim()) return toast('Digite o código.', true);
  act(async () => { const r = await api('/api/coupon', { code }); apply(r.state); toast(`Código aceito: ${W()[r.result.weapon].name}!`); });
}

function animateHit(p, res) {
  return new Promise((resolve) => {
    const ch = $('#my-char');
    const { x, y, row } = lotPos(p.lot);
    const gateX = x + 144, gateY = row === 0 ? y + 300 : y + 60;
    scrollToLot(p.lot);
    if (ch) {
      ch.style.left = (gateX - 30) + 'px';
      ch.style.top = (row === 0 ? ROAD_Y - 14 : ROAD_Y + 6) + 'px';
      ch.classList.toggle('flip', true);
    }
    setTimeout(() => {
      ch && ch.classList.add('hit');
      const sp = img('spark.png', { class: 'spark', style: `left:${gateX - 36}px;top:${gateY - 36}px` });
      const fl = h('div', { class: 'float' + (res.crit ? ' crit' : ''), style: `left:${gateX - 30}px;top:${gateY - 70}px` }, '-' + res.dmg);
      world.append(sp, fl);
      setTimeout(() => { sp.remove(); }, 600);
      setTimeout(() => { fl.remove(); resolve(); }, 1300);
    }, ch ? 600 : 50);
  });
}

// ---------- login ----------
function showLogin() {
  const root = $('#layer');
  root.innerHTML = '';
  let mode = 'login', color = Math.floor(Math.random() * 8);
  const err = h('div', { class: 'err', role: 'alert' });
  const nick = h('input', { class: 'f', id: 'nick', autocomplete: 'username', maxlength: 16, placeholder: 'Seu nick' });
  const pin = h('input', { class: 'f', id: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: 6, placeholder: '4 a 6 números' });
  const colors = h('div', { class: 'colors' });
  const drawColors = () => {
    colors.innerHTML = '';
    for (let i = 0; i < 8; i++) colors.append(h('button', { type: 'button', class: 'color', 'aria-pressed': String(i === color), 'aria-label': `Cor ${i + 1}`, onclick: () => { color = i; drawColors(); } }, img(`bust${i}.png`)));
  };
  drawColors();
  const colorBox = h('div', { style: 'display:none;flex-direction:column;gap:6px' }, h('span', { class: 'kicker' }, 'ESCOLHA SEU PERSONAGEM'), colors);
  const submit = h('button', { class: 'btn red', type: 'submit', style: 'min-height:54px;font-size:20px' }, 'Entrar na rua');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [id, label] of [['login', 'Entrar'], ['new', 'Criar minha base']]) {
      tabs.append(h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(mode === id), onclick: () => { mode = id; drawTabs(); } }, label));
    }
    colorBox.style.display = mode === 'new' ? 'flex' : 'none';
    submit.textContent = mode === 'new' ? 'Criar e entrar' : 'Entrar na rua';
    pin.setAttribute('autocomplete', mode === 'new' ? 'new-password' : 'current-password');
  };
  drawTabs();
  const form = h('form', { style: 'display:flex;flex-direction:column;gap:14px', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const body = { nick: nick.value.trim(), pin: pin.value.trim(), color };
      const r = await api(mode === 'new' ? '/api/register' : '/api/login', body);
      saveToken(r.token);
      root.innerHTML = '';
      apply(r.state);
      scrollToLot(r.state.me.lot);
      if (mode === 'new') { toast('Bem-vindo à rua! Sua base tem 24h de escudo.'); open({ kind: 'help' }); }
    } catch (e2) { err.textContent = e2.message; } finally { submit.disabled = false; }
  } },
    h('label', { class: 'f', for: 'nick' }, 'NICK', nick),
    h('label', { class: 'f', for: 'pin' }, 'PIN', pin),
    colorBox, err, submit);
  root.append(h('div', { class: 'backdrop' }, h('div', { class: 'modal panel narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Entrar' },
    h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, h('div', { class: 'logo' }, 'Tibian'), h('span', { class: 'muted' }, 'Rua das Bases · 1 ataque e 1 upgrade por dia')),
    tabs, form,
    h('p', { class: 'note', style: 'margin:0' }, 'Guarde seu PIN: ele é a sua senha. Não use um PIN que você usa em outro lugar.'))));
  setTimeout(() => nick.focus(), 50);
}

// ---------- arrastar a rua com o mouse ----------
let drag = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  drag = { x: e.clientX, left: viewport.scrollLeft, moved: false };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 5) { drag.moved = true; viewport.classList.add('drag'); }
  if (drag.moved) viewport.scrollLeft = drag.left - dx;
});
window.addEventListener('pointerup', () => { if (drag && drag.moved) setTimeout(() => {}, 0); viewport.classList.remove('drag'); setTimeout(() => (drag = null), 0); });
viewport.addEventListener('click', (e) => { if (drag && drag.moved) { e.stopPropagation(); e.preventDefault(); } }, true);
viewport.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { viewport.scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });

window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel) close(); });
window.addEventListener('resize', () => { if (S) renderWorld(); });
setInterval(() => {
  if (!S) return;
  const c = $('#clock');
  if (c) c.textContent = fmtClock(S.nextReset - now());
  if (!DEMO && S.nextReset - now() < 0) refresh();
}, 1000);
setInterval(() => { if (!DEMO && token && document.visibilityState === 'visible' && !busy) refresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!DEMO && document.visibilityState === 'visible' && token) refresh(); });


// ---------- modo demonstração (?demo): rua de exemplo, sem conta e sem gravar nada ----------
function demoState(st) {
  const t = st.now, H = 3600000;
  const base = { cerca: 30, muro: 80, portao: 60, nucleo: 100 };
  const tierOf = (l) => (l >= 15 ? 5 : l >= 10 ? 4 : l >= 6 ? 3 : l >= 3 ? 2 : 1);
  const mk = (id, nick, lot, color, [d, a, e], hp, extra = {}) => {
    const level = 1 + d + a + e, tier = tierOf(level);
    const max = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(v * (1 + 0.25 * (tier - 1)) * (1 + 0.15 * eff(d)))]));
    return { id, nick, lot, color, level, tier, up: { def: d, atk: a, eco: e }, hp: { cerca: 1, muro: 1, portao: 1, nucleo: 1, ...hp }, max,
      shieldUntil: null, fallen: false, trophies: 0, falls: 0, lastHitAt: null, seenAt: t - 2 * H, ...extra };
  };
  const players = [
    mk(1, 'Bigode', 0, 2, [6, 5, 4], {}, { trophies: 4 }),
    mk(2, 'Kaio_br', 1, 3, [2, 2, 2], { cerca: 0, portao: 0.62 }, { lastHitAt: t - H, falls: 1 }),
    mk(3, 'LadyMorg', 2, 6, [5, 3, 2], { cerca: 0.7 }, { trophies: 2 }),
    mk(4, 'Você', 3, 0, [1, 1, 1], {}, { seenAt: t }),
    mk(5, 'Nyx', 4, 1, [0, 0, 0], {}, { shieldUntil: t + 20 * H }),
    mk(6, 'Zé_Ferro', 5, 4, [3, 2, 2], {}, { fallen: true, shieldUntil: t + 18 * H, falls: 2, seenAt: t - 30 * H }),
    mk(7, 'Tiozão', 6, 5, [1, 0, 2], { cerca: 0.4 }, { seenAt: t - 40 * H }),
  ];
  const me = { ...players[3], coins: 1240, income: 60, tok: { atk: 1, up: 1 }, weapon: 'martelo', inv: { martelo: 7, machado: 3 }, dmgMult: 1.1, coupons: 0 };
  return { ...st, me, players, events: [
    { at: t - 2 * H, kind: 'derrubou', text: 'Bigode derrubou a base de Zé_Ferro e o saque foi de 120 moedas' },
    { at: t - 3 * H, kind: 'compra', text: `LadyMorg comprou Machado de Guerra na Forja ${st.partners.forja}` },
    { at: t - 5 * H, kind: 'upgrade', text: 'Kaio_br subiu Muralha para o nível 2' },
    { at: t - 9 * H, kind: 'chegou', text: 'Nyx chegou na rua' },
  ] };
}
function demoOnly() { toast('Modo demonstração: crie sua base para jogar de verdade.', true); }

// ---------- início ----------
(async () => {
  try {
    const st = await api('/api/state');
    if (DEMO) { apply(demoState(st)); scrollToLot(3); return; }
    apply(st);
    if (!st.me) showLogin();
    else scrollToLot(st.me.lot);
  } catch (e) {
    showLogin();
    toast(e.message, true);
  }
})();

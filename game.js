// Regras do jogo — funções puras sobre o documento do jogador.
export const DAY = 86400000;
export const TZ_OFFSET = -3 * 3600000; // America/Sao_Paulo (sem horário de verão)
export const MAX_BANK = 3;             // ações guardadas no máximo
export const REGEN_PER_DAY = 0.10;     // cada camada recupera 10% por dia
export const NEWBIE_SHIELD = DAY;      // proteção de quem acabou de chegar
export const FALL_SHIELD = DAY;        // proteção depois de cair
export const LOOT_SHARE = 0.25;        // fatia das moedas do alvo dividida entre quem atacou

export const LAYERS = ['cerca', 'muro', 'portao', 'nucleo'];
export const LAYER_NAMES = { cerca: 'Cerca', muro: 'Muro', portao: 'Portão', nucleo: 'Núcleo' };
const LAYER_BASE = { cerca: 30, muro: 80, portao: 60, nucleo: 100 };
export const TIER_NAMES = { 1: 'Tenda', 2: 'Cabana', 3: 'Casa com paliçada', 4: 'Casa de pedra', 5: 'Fortaleza' };

export const WEAPONS = {
  punhos: { name: 'Punhos', dano: 6, bonus: {}, durab: null, price: 0, rarity: 'comum', shop: null, icon: null, effect: 'Sempre com você' },
  martelo: { name: 'Martelo de Ferro', dano: 12, bonus: { cerca: 1.5, muro: 1.5 }, durab: 10, price: 120, rarity: 'comum', shop: 'forja', icon: 'w_martelo', effect: '+50% em cerca e muro' },
  tocha: { name: 'Tocha de Breu', dano: 10, bonus: { cerca: 2 }, durab: 5, price: 260, rarity: 'raro', shop: 'forja', icon: 'w_tocha', effect: 'Dano dobrado na cerca' },
  machado: { name: 'Machado de Guerra', dano: 18, bonus: { portao: 1.5 }, durab: 8, price: 380, rarity: 'raro', shop: 'forja', icon: 'w_machado', effect: '+50% em portões' },
  lanca: { name: 'Lança de Caça', dano: 22, bonus: { nucleo: 1.5 }, durab: 7, price: 900, rarity: 'epico', shop: 'arsenal', minLevel: 5, icon: 'w_lanca', effect: '+50% no núcleo' },
  marreta: { name: 'Marreta Rúnica', dano: 34, bonus: { cerca: 1.25, muro: 1.25, portao: 1.25, nucleo: 1.25 }, durab: 6, price: null, rarity: 'lendario', shop: 'cupom', icon: 'w_runica', effect: '+25% em tudo · só com código' },
};

export const PATHS = {
  def: { name: 'Muralha', label: 'Defesa' },
  atk: { name: 'Forja', label: 'Ataque' },
  eco: { name: 'Mercado', label: 'Economia' },
};

export const dayIdx = (t) => Math.floor((t + TZ_OFFSET) / DAY);
export const nextReset = (t) => (dayIdx(t) + 1) * DAY - TZ_OFFSET;
export const eff = (n) => (1 - Math.pow(0.9, n)) / 0.1; // retorno decrescente

export const level = (p) => 1 + p.up.def + p.up.atk + p.up.eco;
export function tier(p) {
  const l = level(p);
  return l >= 15 ? 5 : l >= 10 ? 4 : l >= 6 ? 3 : l >= 3 ? 2 : 1;
}
export const hpMax = (p, layer) => Math.round(LAYER_BASE[layer] * (1 + 0.25 * (tier(p) - 1)) * (1 + 0.15 * eff(p.up.def)));
export const dmgMult = (p) => 1 + 0.10 * eff(p.up.atk);
export const income = (p) => 40 + 20 * eff(p.up.eco);

export function newPlayer({ nick, pinHash, color, lot, now }) {
  return {
    nick, pinHash, color, lot,
    createdAt: now, seenAt: now,
    coins: 150, coinsAt: now,
    up: { def: 0, atk: 0, eco: 0 },
    tok: { atk: 1, up: 1 }, dayIdx: dayIdx(now),
    hp: { cerca: 1, muro: 1, portao: 1, nucleo: 1 }, hpAt: now,
    shieldUntil: now + NEWBIE_SHIELD, fellAt: null, lastHitAt: null,
    trophies: 0, falls: 0,
    weapon: 'punhos', inv: {}, coupons: [], dmgIn: {},
  };
}

/** Aplica o tempo que passou: ações do dia, moedas e regeneração. */
export function refresh(p, now) {
  const d = dayIdx(now);
  if (d > p.dayIdx) {
    const add = d - p.dayIdx;
    p.tok.atk = Math.min(MAX_BANK, p.tok.atk + add);
    p.tok.up = Math.min(MAX_BANK, p.tok.up + add);
    p.dayIdx = d;
  }
  const dt = Math.max(0, now - p.coinsAt) / DAY;
  p.coins += income(p) * dt;
  p.coinsAt = now;
  const dh = Math.max(0, now - p.hpAt) / DAY;
  for (const l of LAYERS) p.hp[l] = Math.min(1, p.hp[l] + REGEN_PER_DAY * dh);
  p.hpAt = now;
  if (p.weapon !== 'punhos' && !(p.inv[p.weapon] > 0)) p.weapon = 'punhos';
  return p;
}

// Uma camada conta como caída quando tem menos de 1 ponto de vida.
export const down = (t, l) => t.hp[l] * hpMax(t, l) < 1;

export function layerOpen(t, layer) {
  if (layer === 'cerca') return !down(t, 'cerca');
  if (!down(t, 'cerca')) return false;
  if (layer === 'muro' || layer === 'portao') return !down(t, layer);
  if (layer === 'nucleo') return (down(t, 'muro') || down(t, 'portao')) && !down(t, 'nucleo');
  return false;
}

export const isShielded = (p, now) => !!p.shieldUntil && p.shieldUntil > now;

export function estimate(att, tgt, layer) {
  const w = WEAPONS[att.weapon] || WEAPONS.punhos;
  const base = w.dano * dmgMult(att) * (w.bonus[layer] || 1);
  return [Math.max(1, Math.round(base * 0.9)), Math.max(1, Math.round(base * 1.1))];
}

export class GameError extends Error {}

/** Um ataque. Muda att e tgt; devolve o resultado e, se a base cair, as partes do saque. */
export function attack(att, tgt, layer, now, rng = Math.random) {
  if (att.id === tgt.id) throw new GameError('Você não pode atacar a própria base.');
  if (!LAYERS.includes(layer)) throw new GameError('Camada inválida.');
  if (att.tok.atk < 1) throw new GameError('Seu ataque de hoje já foi usado.');
  if (isShielded(tgt, now)) throw new GameError('Essa base está protegida por um escudo.');
  if (!layerOpen(tgt, layer)) throw new GameError('Essa camada ainda não pode ser atacada.');

  const wid = att.weapon in WEAPONS ? att.weapon : 'punhos';
  const w = WEAPONS[wid];
  const crit = rng() < 0.1;
  const roll = 0.9 + rng() * 0.2;
  const raw = w.dano * dmgMult(att) * (w.bonus[layer] || 1) * roll * (crit ? 1.5 : 1);
  const dmg = Math.max(1, Math.round(raw));
  const max = hpMax(tgt, layer);
  const before = tgt.hp[layer] * max;
  const after = Math.max(0, before - dmg);
  tgt.hp[layer] = after < 1 ? 0 : after / max;
  const dealt = before - (after < 1 ? 0 : after);

  att.tok.atk -= 1;
  let broke = false;
  if (wid !== 'punhos') {
    att.inv[wid] = (att.inv[wid] || 0) - 1;
    if (att.inv[wid] <= 0) { delete att.inv[wid]; att.weapon = 'punhos'; broke = true; }
  }
  tgt.dmgIn[att.id] = (tgt.dmgIn[att.id] || 0) + dealt;
  tgt.lastHitAt = now;

  const result = { dmg: Math.round(dealt), crit, layer, hp: tgt.hp[layer], max, broke, weapon: wid, destroyed: false, payouts: [] };

  if (layer === 'nucleo' && after < 1) {
    const loot = Math.floor(tgt.coins * LOOT_SHARE);
    tgt.coins -= loot;
    const total = Object.values(tgt.dmgIn).reduce((a, b) => a + b, 0) || 1;
    for (const [id, d] of Object.entries(tgt.dmgIn)) {
      const share = Math.floor(loot * d / total);
      if (share > 0) result.payouts.push({ id: Number(id), coins: share });
    }
    att.trophies += 1;
    tgt.falls += 1;
    tgt.fellAt = now;
    tgt.shieldUntil = now + FALL_SHIELD;
    for (const l of LAYERS) tgt.hp[l] = 1;
    tgt.dmgIn = {};
    result.destroyed = true;
    result.loot = loot;
  }
  return result;
}

export function upgrade(p, path) {
  if (!(path in PATHS)) throw new GameError('Caminho inválido.');
  if (p.tok.up < 1) throw new GameError('Seu upgrade de hoje já foi usado.');
  p.tok.up -= 1;
  p.up[path] += 1;
  return { path, lvl: p.up[path] };
}

export function buy(p, wid) {
  const w = WEAPONS[wid];
  if (!w || !w.shop || w.shop === 'cupom' || w.price == null) throw new GameError('Essa arma não está à venda.');
  if (w.minLevel && level(p) < w.minLevel) throw new GameError(`Disponível a partir do nível ${w.minLevel}.`);
  if (Math.floor(p.coins) < w.price) throw new GameError('Moedas insuficientes.');
  p.coins -= w.price;
  p.inv[wid] = w.durab;
  if (p.weapon === 'punhos' || WEAPONS[wid].dano > (WEAPONS[p.weapon]?.dano || 0)) p.weapon = wid;
  return { weapon: wid };
}

export function equip(p, wid) {
  if (wid !== 'punhos' && !(p.inv[wid] > 0)) throw new GameError('Você não tem essa arma.');
  p.weapon = wid;
  return { weapon: wid };
}

export function redeem(p, code, coupons) {
  const c = String(code || '').trim().toUpperCase();
  const wid = coupons[c];
  if (!wid) throw new GameError('Código inválido.');
  if (p.coupons.includes(c)) throw new GameError('Você já usou esse código.');
  p.coupons.push(c);
  p.inv[wid] = WEAPONS[wid].durab;
  p.weapon = wid;
  return { weapon: wid };
}

/** Visão pública de um jogador (o que os vizinhos veem). */
export function publicView(p, now) {
  const fallen = !!p.fellAt && isShielded(p, now) && now - p.fellAt < FALL_SHIELD;
  return {
    id: p.id, nick: p.nick, lot: p.lot, color: p.color,
    level: level(p), tier: tier(p),
    up: { ...p.up },
    hp: Object.fromEntries(LAYERS.map((l) => [l, down(p, l) ? 0 : Math.round(p.hp[l] * 1000) / 1000])),
    max: Object.fromEntries(LAYERS.map((l) => [l, hpMax(p, l)])),
    shieldUntil: isShielded(p, now) ? p.shieldUntil : null,
    fallen, trophies: p.trophies, falls: p.falls,
    lastHitAt: p.lastHitAt, seenAt: p.seenAt,
  };
}

export function privateView(p, now) {
  return {
    ...publicView(p, now),
    coins: Math.floor(p.coins), income: Math.round(income(p)),
    tok: { ...p.tok }, weapon: p.weapon, inv: { ...p.inv },
    dmgMult: Math.round(dmgMult(p) * 100) / 100,
    coupons: p.coupons.length,
  };
}

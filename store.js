// Armazenamento: tudo fica em memória (a rua é pequena) e, com DATABASE_URL,
// cada mudança é gravada no Postgres. Sem DATABASE_URL roda só em memória (teste local).

class BaseStore {
  constructor() {
    this.players = new Map();
    this.byNick = new Map();
    this.sessions = new Map();
    this.events = [];
  }
  index(doc) {
    this.players.set(doc.id, doc);
    this.byNick.set(doc.nick.toLowerCase(), doc);
  }
  get(id) { return this.players.get(Number(id)); }
  findNick(nick) { return this.byNick.get(String(nick).toLowerCase()); }
  all() { return [...this.players.values()]; }
  playerForToken(token) {
    const id = this.sessions.get(token);
    return id ? this.get(id) : undefined;
  }
  pushEvent(ev) {
    this.events.unshift(ev);
    if (this.events.length > 60) this.events.length = 60;
  }
}

class MemoryStore extends BaseStore {
  constructor() { super(); this.nextId = 1; this.kind = 'memória'; }
  async init() {}
  async createPlayer(doc) { doc.id = this.nextId++; this.index(doc); return doc; }
  async savePlayers() {}
  async addSession(token, id) { this.sessions.set(token, id); }
  async addEvent(ev) { this.pushEvent(ev); }
}

class PgStore extends BaseStore {
  constructor(url) { super(); this.url = url; this.kind = 'postgres'; }
  async init() {
    const { default: pg } = await import('pg');
    const external = /render\.com|amazonaws\.com|sslmode=require/.test(this.url);
    this.pool = new pg.Pool({ connectionString: this.url, max: 5, ssl: external ? { rejectUnauthorized: false } : undefined });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      nick_lower TEXT UNIQUE NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      player_id INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      at BIGINT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL)`);
    const ps = await this.pool.query('SELECT id, data FROM players ORDER BY id');
    for (const r of ps.rows) { const d = r.data; d.id = r.id; this.index(d); }
    const ss = await this.pool.query('SELECT token, player_id FROM sessions');
    for (const r of ss.rows) this.sessions.set(r.token, r.player_id);
    const es = await this.pool.query('SELECT at, kind, text FROM events ORDER BY id DESC LIMIT 60');
    this.events = es.rows.map((r) => ({ at: Number(r.at), kind: r.kind, text: r.text }));
  }
  async createPlayer(doc) {
    const r = await this.pool.query('INSERT INTO players (nick_lower, data) VALUES ($1, $2) RETURNING id', [doc.nick.toLowerCase(), doc]);
    doc.id = r.rows[0].id;
    await this.pool.query('UPDATE players SET data = $2 WHERE id = $1', [doc.id, doc]);
    this.index(doc);
    return doc;
  }
  async savePlayers(docs) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      for (const d of docs) await c.query('UPDATE players SET data = $2, updated_at = now() WHERE id = $1', [d.id, d]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async addSession(token, id) {
    await this.pool.query('INSERT INTO sessions (token, player_id) VALUES ($1, $2)', [token, id]);
    this.sessions.set(token, id);
  }
  async addEvent(ev) {
    await this.pool.query('INSERT INTO events (at, kind, text) VALUES ($1, $2, $3)', [ev.at, ev.kind, ev.text]);
    this.pushEvent(ev);
  }
}

export async function createStore() {
  const url = process.env.DATABASE_URL;
  const s = url ? new PgStore(url) : new MemoryStore();
  await s.init();
  return s;
}

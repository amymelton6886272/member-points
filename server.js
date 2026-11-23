const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data', 'points.db');
const PORT = process.env.PORT ? Number(process.env.PORT) : 5178;

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    card_no TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    total_spend REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    points INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_member ON transactions(member_id);
  CREATE INDEX IF NOT EXISTS idx_tx_time ON transactions(created_at DESC);
`);

/** 积分规则：消费 10 元 = 1 积分（不足 10 元的部分不计） */
const POINTS_PER_YUAN = 10;
const pointsFor = (amount) => Math.floor(Number(amount) / POINTS_PER_YUAN);

const nowISO = () => new Date().toISOString();

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const allMembers = () =>
  db.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
const allTx = () =>
  db.prepare('SELECT * FROM transactions ORDER BY created_at DESC, id DESC').all();

const memberView = (m) => ({
  id: m.id,
  name: m.name,
  phone: m.phone || '',
  cardNo: m.card_no || '',
  points: m.points,
  totalSpend: Number(m.total_spend || 0),
  createdAt: m.created_at,
});

function stats() {
  const members = allMembers();
  const tx = allTx();
  return {
    memberCount: members.length,
    totalPoints: members.reduce((s, m) => s + m.points, 0),
    totalAmount: Number(tx.reduce((s, t) => s + t.amount, 0).toFixed(2)),
    totalTx: tx.length,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404).end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  try {
    // ---- 统计 ----
    if (p === '/api/stats' && method === 'GET') {
      return json(res, 200, stats());
    }

    // ---- 会员列表 ----
    if (p === '/api/members' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const sort = url.searchParams.get('sort') || 'recent';
      let list = allMembers().map(memberView);
      if (q) {
        list = list.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.phone.toLowerCase().includes(q) ||
            m.cardNo.toLowerCase().includes(q)
        );
      }
      if (sort === 'points') list.sort((a, b) => b.points - a.points);
      else if (sort === 'spend') list.sort((a, b) => b.totalSpend - a.totalSpend);
      else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return json(res, 200, { members: list });
    }

    // ---- 新增会员 ----
    if (p === '/api/members' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error: '请填写会员姓名' });
      const phone = String(body.phone || '').trim();
      const cardNo = String(body.cardNo || '').trim();
      const info = db
        .prepare(
          'INSERT INTO members (name, phone, card_no, points, total_spend, created_at) VALUES (?,?,?,0,0,?)'
        )
        .run(name, phone, cardNo, nowISO());
      const m = db.prepare('SELECT * FROM members WHERE id = ?').get(info.lastInsertRowid);
      return json(res, 200, memberView(m));
    }

    // ---- 更新会员 ----
    if (/^\/api\/members\/\d+$/.test(p) && method === 'PATCH') {
      const id = Number(p.split('/')[3]);
      const body = await readBody(req);
      const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
      if (!m) return json(res, 404, { error: '会员不存在' });
      db.prepare('UPDATE members SET name = ?, phone = ?, card_no = ? WHERE id = ?').run(
        String(body.name ?? m.name).trim(),
        String(body.phone ?? m.phone ?? '').trim(),
        String(body.cardNo ?? m.card_no ?? '').trim(),
        id
      );
      const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
      return json(res, 200, memberView(updated));
    }

    // ---- 删除会员 ----
    if (/^\/api\/members\/\d+$/.test(p) && method === 'DELETE') {
      const id = Number(p.split('/')[3]);
      db.prepare('DELETE FROM transactions WHERE member_id = ?').run(id);
      db.prepare('DELETE FROM members WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }

    // ---- 记消费 ----
    if (/^\/api\/members\/\d+\/consume$/.test(p) && method === 'POST') {
      const id = Number(p.split('/')[3]);
      const body = await readBody(req);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return json(res, 400, { error: '请输入正确的消费金额' });
      }
      const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
      if (!m) return json(res, 404, { error: '会员不存在' });
      const gained = pointsFor(amount);
      const tx = db
        .prepare(
          'INSERT INTO transactions (member_id, amount, points, note, created_at) VALUES (?,?,?,?,?)'
        )
        .run(id, amount, gained, String(body.note || ''), nowISO());
      db.prepare(
        'UPDATE members SET points = points + ?, total_spend = ROUND(total_spend + ?, 2) WHERE id = ?'
      ).run(gained, amount, id);
      const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
      return json(res, 200, {
        member: memberView(updated),
        transactionId: Number(tx.lastInsertRowid),
        gained,
      });
    }

    // ---- 流水 ----
    if (p === '/api/transactions' && method === 'GET') {
      const members = new Map(allMembers().map((m) => [m.id, m]));
      const list = allTx().map((t) => ({
        id: t.id,
        memberId: t.member_id,
        memberName: members.get(t.member_id)?.name || '（已删除）',
        amount: Number(t.amount),
        points: t.points,
        note: t.note || '',
        createdAt: t.created_at,
      }));
      return json(res, 200, { transactions: list });
    }

    // ---- 备份 ----
    if (p === '/api/backup' && method === 'GET') {
      return json(res, 200, {
        version: 1,
        exportedAt: nowISO(),
        members: allMembers().map(memberView),
        transactions: allTx().map((t) => ({
          id: t.id,
          memberId: t.member_id,
          amount: Number(t.amount),
          points: t.points,
          note: t.note || '',
          createdAt: t.created_at,
        })),
      });
    }

    // ---- 还原 ----
    if (p === '/api/restore' && method === 'POST') {
      const body = await readBody(req);
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      if (!data || !Array.isArray(data.members)) {
        return json(res, 400, { error: '备份文件格式不正确' });
      }
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM transactions; DELETE FROM members;');
        const insM = db.prepare(
          'INSERT INTO members (id,name,phone,card_no,points,total_spend,created_at) VALUES (?,?,?,?,?,?,?)'
        );
        for (const m of data.members) {
          insM.run(
            m.id ?? null,
            String(m.name || '未命名'),
            String(m.phone || ''),
            String(m.cardNo || m.card_no || ''),
            Number(m.points || 0),
            Number(m.totalSpend ?? m.total_spend ?? 0),
            m.createdAt || m.created_at || nowISO()
          );
        }
        const insT = db.prepare(
          'INSERT INTO transactions (member_id,amount,points,note,created_at) VALUES (?,?,?,?,?)'
        );
        for (const t of data.transactions || []) {
          insT.run(
            t.memberId ?? t.member_id,
            Number(t.amount || 0),
            Number(t.points || 0),
            String(t.note || ''),
            t.createdAt || t.created_at || nowISO()
          );
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        return json(res, 400, { error: '还原失败：' + e.message });
      }
      return json(res, 200, { ok: true, stats: stats() });
    }

    // ---- 清空 ----
    if (p === '/api/all' && method === 'DELETE') {
      db.exec(
        'DELETE FROM transactions; DELETE FROM members; DELETE FROM sqlite_sequence;'
      );
      return json(res, 200, { ok: true });
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`会员积分服务已启动: http://localhost:${PORT}`);
  console.log(`数据库: ${DB_FILE}`);
});

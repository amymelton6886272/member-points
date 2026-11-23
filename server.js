const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  ptsFmt, amountToPoints, addPts, toUnits, fromUnits,
  tierLevel, tierOf, nextTierInfo, txnLabel, money, esc,
} = require('./public/core.js');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data', 'points.db');
const PORT = process.env.PORT ? Number(process.env.PORT) : 5178;

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');

/* ============================================================
   表结构
   points 用 REAL 存，支持小数积分（11 元 = 1.1 分）
   ============================================================ */
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    card_no TEXT,
    points REAL NOT NULL DEFAULT 0,
    total_spend REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'consume',
    amount REAL NOT NULL DEFAULT 0,
    points REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_member ON transactions(member_id);
  CREATE INDEX IF NOT EXISTS idx_tx_time ON transactions(created_at DESC);
`);

/* 旧库升级：补 note / type 列，points 由 INTEGER 迁成 REAL */
migrateSchema();

function migrateSchema() {
  const tableCols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name + ' ' + c.type);
  const colNames = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

  // 补列
  const addCol = (t, col, ddl) => {
    if (!colNames(t).includes(col)) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN ${ddl}`);
      console.log(`迁移: ${t} 新增列 ${col}`);
    }
  };
  addCol('members', 'note', "note TEXT DEFAULT ''");
  addCol('transactions', 'type', "type TEXT NOT NULL DEFAULT 'consume'");

  // points INTEGER -> REAL
  const mNeed = tableCols('members').some((c) => c.startsWith('points INTEGER'));
  const tNeed = tableCols('transactions').some((c) => c.startsWith('points INTEGER'));
  if (!mNeed && !tNeed) return;

  console.log('迁移: 积分字段 INTEGER -> REAL');
  db.exec('BEGIN');
  try {
    if (mNeed) {
      db.exec(`
        ALTER TABLE members RENAME TO members_old;
        CREATE TABLE members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL, phone TEXT, card_no TEXT,
          points REAL NOT NULL DEFAULT 0, total_spend REAL NOT NULL DEFAULT 0,
          note TEXT DEFAULT '', created_at TEXT NOT NULL
        );
        INSERT INTO members (id,name,phone,card_no,points,total_spend,note,created_at)
          SELECT id,name,phone,card_no,points,total_spend,COALESCE(note,''),created_at FROM members_old;
        DROP TABLE members_old;
      `);
    }
    if (tNeed) {
      db.exec(`
        ALTER TABLE transactions RENAME TO transactions_old;
        CREATE TABLE transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'consume',
          amount REAL NOT NULL DEFAULT 0, points REAL NOT NULL DEFAULT 0,
          note TEXT, created_at TEXT NOT NULL
        );
        INSERT INTO transactions (id,member_id,type,amount,points,note,created_at)
          SELECT id,member_id,COALESCE(type,'consume'),amount,points,note,created_at FROM transactions_old;
        DROP TABLE transactions_old;
      `);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('迁移失败：', e.message);
  }
}

/* ============================================================
   数据访问
   ============================================================ */
const allMembers = () => db.prepare('SELECT * FROM members ORDER BY id DESC').all();
const allTx = () => db.prepare('SELECT * FROM transactions ORDER BY created_at DESC, id DESC').all();
const getMember = (id) => db.prepare('SELECT * FROM members WHERE id = ?').get(id);

const nowISO = () => new Date().toISOString();

function memberView(m) {
  const spent = Number(m.total_spend || 0);
  return {
    id: m.id,
    name: m.name,
    phone: m.phone || '',
    cardNo: m.card_no || '',
    points: Number(Number(m.points || 0).toFixed(2)),
    totalSpend: spent,
    note: m.note || '',
    createdAt: m.created_at,
    tier: tierOf(spent),
    tierLevel: tierLevel(spent),
    nextTier: nextTierInfo(spent),
  };
}

function txView(t, nameMap) {
  return {
    id: t.id,
    memberId: t.member_id,
    memberName: nameMap.get(t.member_id) || '（已删除）',
    type: t.type || 'consume',
    typeLabel: txnLabel(t.type),
    amount: Number(t.amount || 0),
    points: Number(Number(t.points || 0).toFixed(2)),
    note: t.note || '',
    createdAt: t.created_at,
  };
}

function stats() {
  const members = allMembers();
  const tx = allTx();
  return {
    memberCount: members.length,
    totalPoints: Number(members.reduce((s, m) => s + Number(m.points || 0), 0).toFixed(2)),
    totalAmount: Number(tx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)),
    totalTx: tx.length,
  };
}

/* ============================================================
   HTTP
   ============================================================ */
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME['.html'],
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  try {
    /* ---------- 统计 ---------- */
    if (p === '/api/stats' && method === 'GET') return json(res, 200, stats());

    /* ---------- 会员列表 ---------- */
    if (p === '/api/members' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const sort = url.searchParams.get('sort') || 'recent';
      let list = allMembers().map(memberView);
      if (q) {
        list = list.filter((m) =>
          m.name.toLowerCase().includes(q) || m.phone.toLowerCase().includes(q) || m.cardNo.toLowerCase().includes(q));
      }
      if (sort === 'points') list.sort((a, b) => b.points - a.points);
      else if (sort === 'spend') list.sort((a, b) => b.totalSpend - a.totalSpend);
      else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      else if (sort === 'card') list.sort((a, b) => a.cardNo.localeCompare(b.cardNo, 'zh'));
      return json(res, 200, { members: list });
    }

    /* ---------- 新增会员 ---------- */
    if (p === '/api/members' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error: '请填写会员姓名' });
      const phone = String(body.phone || '').trim();
      const cardNo = String(body.cardNo || '').trim() || 'C' + String(Date.now()).slice(-8);
      const info = db.prepare(
        'INSERT INTO members (name, phone, card_no, points, total_spend, note, created_at) VALUES (?,?,?,0,0,?,?)'
      ).run(name, phone, cardNo, String(body.note || ''), nowISO());
      return json(res, 200, memberView(getMember(Number(info.lastInsertRowid))));
    }

    /* ---------- 修改会员 ---------- */
    if (/^\/api\/members\/\d+$/.test(p) && method === 'PATCH') {
      const id = Number(p.split('/')[3]);
      const body = await readBody(req);
      const m = getMember(id);
      if (!m) return json(res, 404, { error: '会员不存在' });
      db.prepare('UPDATE members SET name=?, phone=?, card_no=?, note=? WHERE id=?').run(
        String(body.name ?? m.name).trim(),
        String(body.phone ?? m.phone ?? '').trim(),
        String(body.cardNo ?? m.card_no ?? '').trim(),
        String(body.note ?? m.note ?? ''),
        id
      );
      return json(res, 200, memberView(getMember(id)));
    }

    /* ---------- 删除会员 ---------- */
    if (/^\/api\/members\/\d+$/.test(p) && method === 'DELETE') {
      const id = Number(p.split('/')[3]);
      db.prepare('DELETE FROM transactions WHERE member_id = ?').run(id);
      db.prepare('DELETE FROM members WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }

    /* ---------- 记消费（金额自动换算积分） ---------- */
    if (/^\/api\/members\/\d+\/consume$/.test(p) && method === 'POST') {
      const id = Number(p.split('/')[3]);
      const body = await readBody(req);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: '请输入正确的消费金额' });
      const m = getMember(id);
      if (!m) return json(res, 404, { error: '会员不存在' });

      const gained = amountToPoints(amount);
      db.prepare('INSERT INTO transactions (member_id,type,amount,points,note,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, 'consume', amount, gained, String(body.note || '消费'), nowISO());
      db.prepare('UPDATE members SET points = points + ?, total_spend = ROUND(total_spend + ?, 2) WHERE id = ?')
        .run(gained, amount, id);
      return json(res, 200, { member: memberView(getMember(id)), gained });
    }

    /* ---------- 积分调整（手动加/减，支持小数） ---------- */
    if (/^\/api\/members\/\d+\/points$/.test(p) && method === 'POST') {
      const id = Number(p.split('/')[3]);
      const body = await readBody(req);
      const pts = Number(body.points);
      const mode = body.mode === 'deduct' ? 'deduct' : 'add';
      if (!Number.isFinite(pts) || pts <= 0) return json(res, 400, { error: '请输入正确的积分数' });
      const m = getMember(id);
      if (!m) return json(res, 404, { error: '会员不存在' });

      if (mode === 'deduct') {
        if (toUnits(m.points) < toUnits(pts)) {
          return json(res, 400, { error: `积分不足（当前 ${ptsFmt(m.points)} 分）` });
        }
      }
      const delta = mode === 'deduct' ? -pts : pts;
      db.prepare('INSERT INTO transactions (member_id,type,amount,points,note,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, mode === 'deduct' ? 'pointUse' : 'pointAdd', 0, delta, String(body.note || ''), nowISO());
      db.prepare('UPDATE members SET points = ROUND(points + ?, 2) WHERE id = ?').run(delta, id);
      return json(res, 200, { member: memberView(getMember(id)), delta });
    }

    /* ---------- 流水 ---------- */
    if (p === '/api/transactions' && method === 'GET') {
      const nameMap = new Map(allMembers().map((m) => [m.id, m.name]));
      const filter = url.searchParams.get('type') || 'all';
      let list = allTx().map((t) => txView(t, nameMap));
      if (filter === 'consume') list = list.filter((t) => t.type === 'consume');
      if (filter === 'points') list = list.filter((t) => t.type === 'pointAdd' || t.type === 'pointUse');
      return json(res, 200, { transactions: list });
    }

    /* ---------- 备份 ---------- */
    if (p === '/api/backup' && method === 'GET') {
      const nameMap = new Map(allMembers().map((m) => [m.id, m.name]));
      return json(res, 200, {
        version: 2,
        exportedAt: nowISO(),
        members: allMembers().map(memberView),
        transactions: allTx().map((t) => txView(t, nameMap)),
      });
    }

    /* ---------- 还原 ---------- */
    if (p === '/api/restore' && method === 'POST') {
      const body = await readBody(req);
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      if (!data || !Array.isArray(data.members)) return json(res, 400, { error: '备份文件格式不正确' });
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM transactions; DELETE FROM members;');
        const insM = db.prepare(
          'INSERT INTO members (id,name,phone,card_no,points,total_spend,note,created_at) VALUES (?,?,?,?,?,?,?,?)');
        for (const m of data.members) {
          insM.run(
            m.id ?? null, String(m.name || '未命名'), String(m.phone || ''),
            String(m.cardNo || m.card_no || ''), Number(m.points || 0),
            Number(m.totalSpend ?? m.total_spend ?? 0), String(m.note || ''),
            m.createdAt || m.created_at || nowISO());
        }
        const insT = db.prepare(
          'INSERT INTO transactions (member_id,type,amount,points,note,created_at) VALUES (?,?,?,?,?,?)');
        for (const t of data.transactions || data.txns || []) {
          insT.run(
            t.memberId ?? t.member_id, String(t.type || 'consume'),
            Number(t.amount || 0), Number(t.points || 0), String(t.note || t.remark || ''),
            t.createdAt || t.created_at || nowISO());
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        return json(res, 400, { error: '还原失败：' + e.message });
      }
      return json(res, 200, { ok: true, stats: stats() });
    }

    /* ---------- 清空 ---------- */
    if (p === '/api/all' && method === 'DELETE') {
      db.exec('DELETE FROM transactions; DELETE FROM members; DELETE FROM sqlite_sequence;');
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

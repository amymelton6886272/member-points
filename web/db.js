/* ============================================================
   端侧数据层（sql.js / WASM）
   与 server.js 表结构、积分规则、等级规则完全一致
   ============================================================ */

import {
  ptsFmt, amountToPoints, addPts, toUnits, fromUnits,
  tierLevel, tierOf, nextTierInfo, txnLabel,
  normBackup, normTime, normPoints, normMember, normTxn, backupFormatLabel,
} from './core.js';

export {
  ptsFmt, amountToPoints, addPts, toUnits, fromUnits,
  tierLevel, tierOf, nextTierInfo, txnLabel,
  normBackup, normTime, normPoints, normMember, normTxn, backupFormatLabel,
};

const SCHEMA = `
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
`;

/** 旧库升级：补 note / type 列 */
function migrateSchema(db) {
  // 注意：sql.js 的 Statement 没有 .all()，需手动 step 遍历
  const cols = (t) => {
    const stmt = db.prepare(`PRAGMA table_info(${t})`);
    const names = [];
    while (stmt.step()) names.push(stmt.getAsObject().name);
    stmt.free();
    return names;
  };
  const addCol = (t, col, ddl) => {
    if (!cols(t).includes(col)) db.run(`ALTER TABLE ${t} ADD COLUMN ${ddl}`);
  };
  addCol('members', 'note', "note TEXT DEFAULT ''");
  addCol('transactions', 'type', "type TEXT NOT NULL DEFAULT 'consume'");
}

export class DB {
  constructor() {
    this.db = null;
    this.sql = null;
    this.dirty = false;
    this.saveTimer = null;
    this.persist = null;
  }

  async init({ persist } = {}) {
    if (persist) this.persist = persist;
    if (typeof initSqlJs !== 'function') throw new Error('sql.js 未加载');

    const wasmBinary = await fetchWasm();
    initSqlJs({
      locateFile: (file) => (file.endsWith('.wasm') ? './sql-wasm.wasm' : './' + file),
      wasmBinary,
    }).then((SQL) => { this.sql = SQL; });
    while (!this.sql) await new Promise((r) => setTimeout(r, 30));

    const saved = this.persist ? await this.persist.load() : null;
    if (saved && saved.byteLength) {
      try { this.db = new this.sql.Database(saved); } catch { this.db = new this.sql.Database(); }
    } else {
      this.db = new this.sql.Database();
    }
    this.db.run(SCHEMA);
    migrateSchema(this.db);
    return this;
  }

  exportBytes() { return this.db.export(); }

  touch() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  async save() {
    if (!this.dirty || !this.persist) return;
    this.dirty = false;
    try { await this.persist.save(this.db.export()); }
    catch (e) { console.error('保存失败', e); }
  }

  /* ---------------- 查询 ---------------- */
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  run(sql, params = []) { this.db.run(sql, params); this.touch(); }

  get(sql, params = []) { return this.all(sql, params)[0] || null; }

  /* ---------------- 业务 ---------------- */
  listMembers({ q = '', sort = 'recent' } = {}) {
    let rows = this.all('SELECT * FROM members ORDER BY id DESC');
    const key = String(q).trim().toLowerCase();
    if (key) {
      rows = rows.filter((m) =>
        String(m.name || '').toLowerCase().includes(key) ||
        String(m.phone || '').toLowerCase().includes(key) ||
        String(m.card_no || '').toLowerCase().includes(key));
    }
    const arr = rows.slice();
    if (sort === 'points') arr.sort((a, b) => toUnits(b.points) - toUnits(a.points));
    else if (sort === 'spend') arr.sort((a, b) => b.total_spend - a.total_spend);
    else if (sort === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    else if (sort === 'card') arr.sort((a, b) => String(a.card_no).localeCompare(String(b.card_no), 'zh'));
    return arr.map(memberView);
  }

  listTransactions(filter = 'all') {
    const nameMap = new Map(this.all('SELECT id, name FROM members').map((m) => [m.id, m.name]));
    let list = this.all('SELECT * FROM transactions ORDER BY created_at DESC, id DESC').map((t) => ({
      id: t.id,
      memberId: t.member_id,
      memberName: nameMap.get(t.member_id) || '（已删除）',
      type: t.type || 'consume',
      typeLabel: txnLabel(t.type),
      amount: Number(t.amount || 0),
      points: Number(Number(t.points || 0).toFixed(2)),
      note: t.note || '',
      createdAt: t.created_at,
    }));
    if (filter === 'consume') list = list.filter((t) => t.type === 'consume');
    if (filter === 'points') list = list.filter((t) => t.type === 'pointAdd' || t.type === 'pointUse');
    return list;
  }

  stats() {
    const members = this.all('SELECT points FROM members');
    const tx = this.all('SELECT amount FROM transactions');
    return {
      memberCount: members.length,
      totalPoints: Number(members.reduce((s, m) => s + Number(m.points || 0), 0).toFixed(2)),
      totalAmount: Number(tx.reduce((s, t) => s + Number(t.amount || 0), 0).toFixed(2)),
      totalTx: tx.length,
    };
  }

  addMember({ name, phone = '', cardNo = '', note = '' }) {
    const n = String(name || '').trim();
    if (!n) throw new Error('请填写会员姓名');
    const card = String(cardNo).trim() || 'C' + String(Date.now()).slice(-8);
    const createdAt = new Date().toISOString();
    this.run('INSERT INTO members (name, phone, card_no, points, total_spend, note, created_at) VALUES (?,?,?,0,0,?,?)',
      [n, String(phone).trim(), card, String(note || ''), createdAt]);
    const id = this.get('SELECT last_insert_rowid() AS id').id;
    return memberView(this.get('SELECT * FROM members WHERE id = ?', [id]));
  }

  updateMember(id, { name, phone, cardNo, note }) {
    const m = this.get('SELECT * FROM members WHERE id = ?', [id]);
    if (!m) throw new Error('会员不存在');
    this.run('UPDATE members SET name=?, phone=?, card_no=?, note=? WHERE id=?', [
      String(name ?? m.name).trim(),
      String(phone ?? m.phone ?? '').trim(),
      String(cardNo ?? m.card_no ?? '').trim(),
      String(note ?? m.note ?? ''),
      id]);
    return memberView(this.get('SELECT * FROM members WHERE id = ?', [id]));
  }

  deleteMember(id) {
    this.run('DELETE FROM transactions WHERE member_id = ?', [id]);
    this.run('DELETE FROM members WHERE id = ?', [id]);
  }

  consume(id, { amount, note = '' }) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('请输入正确的消费金额');
    const m = this.get('SELECT * FROM members WHERE id = ?', [id]);
    if (!m) throw new Error('会员不存在');
    const gained = amountToPoints(amt);
    this.run('INSERT INTO transactions (member_id,type,amount,points,note,created_at) VALUES (?,?,?,?,?,?)',
      [id, 'consume', amt, gained, String(note || '消费'), new Date().toISOString()]);
    this.run('UPDATE members SET points = ROUND(points + ?, 2), total_spend = ROUND(total_spend + ?, 2) WHERE id = ?',
      [gained, amt, id]);
    return { member: memberView(this.get('SELECT * FROM members WHERE id = ?', [id])), gained };
  }

  adjustPoints(id, { points, mode = 'add', note = '' }) {
    const pts = Number(points);
    if (!Number.isFinite(pts) || pts <= 0) throw new Error('请输入正确的积分数');
    const m = this.get('SELECT * FROM members WHERE id = ?', [id]);
    if (!m) throw new Error('会员不存在');
    if (mode === 'deduct' && toUnits(m.points) < toUnits(pts)) {
      throw new Error(`积分不足（当前 ${ptsFmt(m.points)} 分）`);
    }
    const delta = mode === 'deduct' ? -pts : pts;
    this.run('INSERT INTO transactions (member_id,type,amount,points,note,created_at) VALUES (?,?,?,?,?,?)',
      [id, mode === 'deduct' ? 'pointUse' : 'pointAdd', 0, delta, String(note || ''), new Date().toISOString()]);
    this.run('UPDATE members SET points = ROUND(points + ?, 2) WHERE id = ?', [delta, id]);
    return { member: memberView(this.get('SELECT * FROM members WHERE id = ?', [id])), delta };
  }

  backup() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      members: this.all('SELECT * FROM members').map(memberView),
      transactions: this.listTransactions(),
    };
  }

  restore(raw) {
    // 归一化：兼容 v1（旧 App 导出：txns/remark/spent/毫秒时间戳/负数金额）
    // 与 v2（当前格式）两种备份
    const data = normBackup(raw);
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM transactions; DELETE FROM members;');
      const mStmt = this.db.prepare(
        'INSERT INTO members (id,name,phone,card_no,points,total_spend,note,created_at) VALUES (?,?,?,?,?,?,?,?)');
      for (const m of data.members) {
        mStmt.run([m.id, m.name, m.phone, m.cardNo, m.points,
          m.totalSpend, m.note, m.createdAt]);
      }
      mStmt.free();
      const tStmt = this.db.prepare(
        'INSERT INTO transactions (member_id,type,amount,points,note,created_at) VALUES (?,?,?,?,?,?)');
      for (const t of data.transactions) {
        tStmt.run([t.memberId, t.type, t.amount, t.points, t.note, t.createdAt]);
      }
      tStmt.free();
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw new Error('还原失败：' + e.message);
    }
    this.touch();
    return this.stats();
  }

  clearAll() {
    this.db.run('DELETE FROM transactions; DELETE FROM members;');
    this.touch();
  }
}

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

async function fetchWasm() {
  const res = await fetch('./sql-wasm.wasm');
  if (!res.ok) throw new Error('wasm 加载失败: ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

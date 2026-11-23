/* ============================================================
   浏览器端 SQLite 数据层（sql.js / WASM）
   与 server.js 使用完全相同的表结构与积分规则
   ============================================================ */

export const POINTS_PER_YUAN = 10;
export const pointsFor = (amount) => Math.floor(Number(amount || 0) / POINTS_PER_YUAN);

const SCHEMA = `
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
`;

export class DB {
  constructor() {
    this.db = null;
    this.sql = null;
    this.dirty = false;
    this.saveTimer = null;
    this.persist = null; // 外部注入的持久化函数 (Uint8Array) => Promise<void>
  }

  async init({ persist } = {}) {
    if (persist) this.persist = persist;
    if (typeof initSqlJs !== 'function') throw new Error('sql.js 未加载');

    // 手动取 wasm 字节再注入，避免 iOS WKWebView 在 capacitor:// 自定义 scheme 下
    // 编译 wasm 时出现 MIME / 流式加载问题
    const wasmBinary = await fetchWasm();

    initSqlJs({
      locateFile: (file) => (file.endsWith('.wasm') ? './sql-wasm.wasm' : './' + file),
      wasmBinary,
    }).then((SQL) => {
      this.sql = SQL;
    });
    // 等待 sql.js 加载
    while (!this.sql) await new Promise((r) => setTimeout(r, 30));

    const saved = this.persist ? await this.persist.load() : null;
    if (saved && saved.byteLength) {
      try {
        this.db = new this.sql.Database(saved);
      } catch {
        this.db = new this.sql.Database();
      }
    } else {
      this.db = new this.sql.Database();
    }
    this.db.run(SCHEMA);
    return this;
  }

  /** 把内存库导出为字节数组（用于保存到磁盘） */
  exportBytes() {
    return this.db.export();
  }

  /** 标记脏数据并延迟保存 */
  touch() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  async save() {
    if (!this.dirty || !this.persist) return;
    this.dirty = false;
    const bytes = this.db.export();
    try {
      await this.persist.save(bytes);
    } catch (e) {
      console.error('保存失败', e);
    }
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

  run(sql, params = []) {
    this.db.run(sql, params);
    this.touch();
  }

  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows[0] || null;
  }

  /* ---------------- 业务方法 ---------------- */
  listMembers({ q = '', sort = 'recent' } = {}) {
    let rows = this.all('SELECT * FROM members ORDER BY created_at DESC');
    const key = String(q).trim().toLowerCase();
    if (key) {
      rows = rows.filter(
        (m) =>
          String(m.name || '').toLowerCase().includes(key) ||
          String(m.phone || '').toLowerCase().includes(key) ||
          String(m.card_no || '').toLowerCase().includes(key)
      );
    }
    if (sort === 'points') rows.sort((a, b) => b.points - a.points);
    else if (sort === 'spend') rows.sort((a, b) => b.total_spend - a.total_spend);
    else rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows.map(memberView);
  }

  listTransactions() {
    const members = new Map(this.all('SELECT id, name FROM members').map((m) => [m.id, m.name]));
    return this.all('SELECT * FROM transactions ORDER BY created_at DESC, id DESC').map((t) => ({
      id: t.id,
      memberId: t.member_id,
      memberName: members.get(t.member_id) || '（已删除）',
      amount: Number(t.amount),
      points: t.points,
      note: t.note || '',
      createdAt: t.created_at,
    }));
  }

  stats() {
    const members = this.all('SELECT points FROM members');
    const tx = this.all('SELECT amount FROM transactions');
    return {
      memberCount: members.length,
      totalPoints: members.reduce((s, m) => s + m.points, 0),
      totalAmount: Number(tx.reduce((s, t) => s + Number(t.amount), 0).toFixed(2)),
      totalTx: tx.length,
    };
  }

  addMember({ name, phone = '', cardNo = '' }) {
    const n = String(name || '').trim();
    if (!n) throw new Error('请填写会员姓名');
    const createdAt = new Date().toISOString();
    this.run('INSERT INTO members (name, phone, card_no, points, total_spend, created_at) VALUES (?,?,?,0,0,?)', [
      n, String(phone).trim(), String(cardNo).trim(), createdAt,
    ]);
    const id = this.get('SELECT last_insert_rowid() AS id').id;
    return memberView(this.get('SELECT * FROM members WHERE id = ?', [id]));
  }

  updateMember(id, { name, phone, cardNo }) {
    const m = this.get('SELECT * FROM members WHERE id = ?', [id]);
    if (!m) throw new Error('会员不存在');
    this.run('UPDATE members SET name = ?, phone = ?, card_no = ? WHERE id = ?', [
      String(name ?? m.name).trim(),
      String(phone ?? m.phone ?? '').trim(),
      String(cardNo ?? m.card_no ?? '').trim(),
      id,
    ]);
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
    const gained = pointsFor(amt);
    this.run('INSERT INTO transactions (member_id, amount, points, note, created_at) VALUES (?,?,?,?,?)', [
      id, amt, gained, String(note), new Date().toISOString(),
    ]);
    this.run('UPDATE members SET points = points + ?, total_spend = ROUND(total_spend + ?, 2) WHERE id = ?', [
      gained, amt, id,
    ]);
    return { member: memberView(this.get('SELECT * FROM members WHERE id = ?', [id])), gained };
  }

  backup() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      members: this.all('SELECT * FROM members').map(memberView),
      transactions: this.listTransactions(),
    };
  }

  restore(data) {
    if (!data || !Array.isArray(data.members)) throw new Error('备份文件格式不正确');
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM transactions; DELETE FROM members;');
      const mStmt = this.db.prepare(
        'INSERT INTO members (id,name,phone,card_no,points,total_spend,created_at) VALUES (?,?,?,?,?,?,?)'
      );
      for (const m of data.members) {
        mStmt.run([
          m.id ?? null, String(m.name || '未命名'), String(m.phone || ''), String(m.cardNo || m.card_no || ''),
          Number(m.points || 0), Number(m.totalSpend ?? m.total_spend ?? 0),
          m.createdAt || m.created_at || new Date().toISOString(),
        ]);
      }
      mStmt.free();
      const tStmt = this.db.prepare(
        'INSERT INTO transactions (member_id,amount,points,note,created_at) VALUES (?,?,?,?,?)'
      );
      for (const t of data.transactions || []) {
        tStmt.run([
          t.memberId ?? t.member_id, Number(t.amount || 0), Number(t.points || 0),
          String(t.note || ''), t.createdAt || t.created_at || new Date().toISOString(),
        ]);
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

/** 读取 sql-wasm.wasm 字节 */
async function fetchWasm() {
  const res = await fetch('./sql-wasm.wasm');
  if (!res.ok) throw new Error('wasm 加载失败: ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

function memberView(m) {  return {
    id: m.id,
    name: m.name,
    phone: m.phone || '',
    cardNo: m.card_no || '',
    points: m.points,
    totalSpend: Number(m.total_spend || 0),
    createdAt: m.created_at,
  };
}

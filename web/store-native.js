/* ============================================================
   端侧数据访问层：直接操作 sql.js（SQLite）
   接口与 public/store.js 完全一致，app.js 无需区分环境
   ============================================================ */

import { DB } from './db.js';
import { createPersistence, isNative } from './storage.js';

let db = null;

export const Store = {
  isNative: false,

  async init() {
    const persist = await createPersistence();
    db = await new DB().init({ persist });
    this.isNative = isNative();
    // 页面隐藏时强制落盘
    document.addEventListener('visibilitychange', () => { if (document.hidden) db.save(); });
    window.addEventListener('beforeunload', () => db.save());
    return this;
  },

  async stats() { return db.stats(); },

  async listMembers({ q = '', sort = 'recent' } = {}) {
    return db.listMembers({ q, sort });
  },

  async getMember(id) {
    return db.listMembers({}).find((m) => m.id === Number(id)) || null;
  },

  async addMember(data) { return db.addMember(data); },

  async updateMember(id, data) { return db.updateMember(id, data); },

  async deleteMember(id) { db.deleteMember(id); return { ok: true }; },

  async consume(id, payload) { return db.consume(id, payload); },

  async adjustPoints(id, payload) { return db.adjustPoints(id, payload); },

  async listTransactions(filter = 'all') { return db.listTransactions(filter); },

  async backup() { return db.backup(); },

  async restore(data) { db.restore(data); return { ok: true }; },

  async clearAll() { db.clearAll(); return { ok: true }; },
};

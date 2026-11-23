/* ============================================================
   数据访问层
   - 服务端版：走 REST API（/api/*）
   - 端侧版：由 web/store-native.js 覆盖为直接操作 sql.js
   两端暴露完全一致的接口，app.js 不需要区分
   ============================================================ */

(function () {
  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  };

  window.Store = {
    isNative: false,

    async init() { return this; },

    async stats() {
      return api('/api/stats');
    },

    async listMembers({ q = '', sort = 'recent' } = {}) {
      const d = await api(`/api/members?q=${encodeURIComponent(q)}&sort=${sort}`);
      return d.members;
    },

    async getMember(id) {
      const d = await api(`/api/members?q=`);
      return d.members.find((m) => m.id === Number(id)) || null;
    },

    async addMember(data) {
      return api('/api/members', { method: 'POST', body: data });
    },

    async updateMember(id, data) {
      return api(`/api/members/${id}`, { method: 'PATCH', body: data });
    },

    async deleteMember(id) {
      return api(`/api/members/${id}`, { method: 'DELETE' });
    },

    async consume(id, { amount, note }) {
      return api(`/api/members/${id}/consume`, { method: 'POST', body: { amount, note } });
    },

    async adjustPoints(id, { points, mode, note }) {
      return api(`/api/members/${id}/points`, { method: 'POST', body: { points, mode, note } });
    },

    async listTransactions(filter = 'all') {
      const d = await api(`/api/transactions?type=${filter}`);
      return d.transactions;
    },

    async backup() {
      return api('/api/backup');
    },

    async restore(data) {
      return api('/api/restore', { method: 'POST', body: data });
    },

    async clearAll() {
      return api('/api/all', { method: 'DELETE' });
    },
  };
})();

/* ================= 图标（内联 SVG） ================= */
const S = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

const ICON = {
  tag: S('<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  list: S('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  users: S('<path d="M16 20v-1.5A4 4 0 0 0 12 15H8a4 4 0 0 0-4 4v1.5"/><circle cx="10" cy="8" r="3"/><path d="M18 20v-1.5a4 4 0 0 0-3-3.85"/><path d="M16 4.2a3 3 0 0 1 0 5.6"/>'),
  receipt: S('<path d="M5 3h14v18l-2.3-1.6L14.4 21 12 19.4 9.6 21 7.3 19.4 5 21Z"/><path d="M9 8h6M9 12h6"/>'),
  coin: S('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M10 10.2h3.2a1.6 1.6 0 0 1 0 3.2H10"/>'),
  yen: S('<path d="M8 4l4 6 4-6M12 10v10M8 14h8M8 17h8"/>'),
  menu: S('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  wallet: S('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v1"/><path d="M3 8.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2.5"/><path d="M21 11h-4a2 2 0 0 0 0 4h4a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Z"/>'),
};

/* 填充 data-icon 占位符 */
document.querySelectorAll('[data-icon]').forEach((el) => {
  el.innerHTML = ICON[el.dataset.icon] || '';
});

/* ================= 工具 ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
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

const fmtMoney = (n) => '¥' + Number(n || 0).toFixed(2);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const sameDay = d.toDateString() === now.toDateString();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return '今天 ' + time;
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ================= 全局状态 ================= */
const state = {
  tab: 'members',
  members: [],
  transactions: [],
  stats: {},
  picked: null,
};

/* ================= 弹窗 ================= */
function openModal({ title, bodyHtml, okText = '确定', onOk }) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalOk').textContent = okText;
  $('#modalMask').classList.remove('hidden');
  const close = () => $('#modalMask').classList.add('hidden');
  $('#modalCancel').onclick = close;
  $('#modalMask').onclick = (e) => { if (e.target === $('#modalMask')) close(); };
  $('#modalOk').onclick = async () => {
    try {
      const keep = await onOk($('#modalBody'));
      if (keep !== false) close();
    } catch (e) {
      toast(e.message);
    }
  };
}
const closeModal = () => $('#modalMask').classList.add('hidden');

/* ================= 会员页 ================= */
function memberCard(m) {
  return `<div class="member-card" data-id="${m.id}">
    <div class="avatar">${esc(m.name.slice(0, 1))}</div>
    <div class="mc-info">
      <div class="mc-name">${esc(m.name)}${m.cardNo ? `<span class="chip">卡 ${esc(m.cardNo)}</span>` : ''}</div>
      <div class="mc-meta">${m.phone ? esc(m.phone) : '未填手机号'} · 消费 ${fmtMoney(m.totalSpend)}</div>
      <div class="mc-ops">
        <button class="mini-btn primary" data-op="consume">记消费</button>
        <button class="mini-btn" data-op="edit">编辑</button>
        <button class="mini-btn danger" data-op="del">删除</button>
      </div>
    </div>
    <div class="mc-right">
      <div class="mc-points">${m.points}<small>分</small></div>
      <div class="mc-spend">${fmtMoney(m.totalSpend)}</div>
    </div>
  </div>`;
}

function renderMembers() {
  const list = $('#memberList');
  const empty = $('#memberEmpty');
  if (!state.members.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = state.members.map(memberCard).join('');
  }
}

function renderStats() {
  $('#stMembers').textContent = state.stats.memberCount ?? 0;
  $('#stAmount').textContent = state.stats.totalAmount ? fmtMoney(state.stats.totalAmount) : '—';
  $('#stPoints').textContent = state.stats.totalPoints ?? 0;
}

/* ================= 流水页 ================= */
function txRow(t) {
  return `<div class="tx-row">
    <div class="tx-icon">${ICON.wallet}</div>
    <div class="tx-main">
      <div class="tx-title">${esc(t.memberName)}</div>
      <div class="tx-sub">${fmtDate(t.createdAt)}${t.note ? ' · ' + esc(t.note) : ''}</div>
    </div>
    <div class="tx-amt">
      <div class="tx-money">${fmtMoney(t.amount)}</div>
      <div class="tx-pts">+${t.points} 积分</div>
    </div>
  </div>`;
}

function renderFlow() {
  const list = $('#txList');
  const empty = $('#txEmpty');
  if (!state.transactions.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = state.transactions.map(txRow).join('');
  }
}

function renderRecentTx() {
  const box = $('#recentTx');
  const rows = state.transactions.slice(0, 5);
  box.innerHTML = rows.length
    ? rows.map((t) => `<div class="mini-row">
        <span class="mr-name">${esc(t.memberName)}</span>
        <span class="mr-amt">${fmtMoney(t.amount)}</span>
        <span class="mr-pts">+${t.points}</span>
      </div>`).join('')
    : '<div class="mini-row"><span class="mr-amt">暂无消费记录</span></div>';
}

/* ================= 数据加载 ================= */
async function load() {
  const [stats, members, txs] = await Promise.all([
    api('/api/stats'),
    api('/api/members?q=' + encodeURIComponent($('#memberSearch').value.trim()) + '&sort=' + $('#sortSelect').value),
    api('/api/transactions'),
  ]);
  state.stats = stats;
  state.members = members.members;
  state.transactions = txs.transactions;
  renderStats();
  renderMembers();
  renderFlow();
  renderRecentTx();
}

/* ================= 会员操作 ================= */
function addMemberDialog() {
  openModal({
    title: '新增会员',
    bodyHtml: `
      <label>姓名</label><input class="input" id="fName" placeholder="会员姓名" />
      <label>手机号（可选）</label><input class="input" id="fPhone" placeholder="13800000000" />
      <label>卡号（可选）</label><input class="input" id="fCard" placeholder="VIP0001" />
    `,
    okText: '创建',
    onOk: async () => {
      const name = $('#fName').value.trim();
      if (!name) { toast('请填写会员姓名'); return false; }
      await api('/api/members', { method: 'POST', body: { name, phone: $('#fPhone').value, cardNo: $('#fCard').value } });
      toast('已新增会员');
      await load();
    },
  });
  setTimeout(() => $('#fName').focus(), 50);
}

function editMemberDialog(m) {
  openModal({
    title: '编辑会员',
    bodyHtml: `
      <label>姓名</label><input class="input" id="fName" value="${esc(m.name)}" />
      <label>手机号</label><input class="input" id="fPhone" value="${esc(m.phone)}" />
      <label>卡号</label><input class="input" id="fCard" value="${esc(m.cardNo)}" />
    `,
    okText: '保存',
    onOk: async () => {
      const name = $('#fName').value.trim();
      if (!name) { toast('请填写姓名'); return false; }
      await api('/api/members/' + m.id, { method: 'PATCH', body: { name, phone: $('#fPhone').value, cardNo: $('#fCard').value } });
      toast('已保存');
      await load();
    },
  });
}

function deleteMember(m) {
  openModal({
    title: '删除会员',
    bodyHtml: `<div>确定删除 <b>${esc(m.name)}</b> 吗？其消费流水也会一并删除。</div>`,
    okText: '删除',
    onOk: async () => {
      await api('/api/members/' + m.id, { method: 'DELETE' });
      toast('已删除');
      await load();
    },
  });
}

/* ================= 记消费页 ================= */
function renderPicked() {
  const box = $('#consumePicked');
  if (!state.picked) {
    box.classList.add('hidden');
    box.innerHTML = '';
  } else {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="avatar">${esc(state.picked.name.slice(0, 1))}</div>
      <div><div class="pk-name">${esc(state.picked.name)}</div>
      <div class="pk-meta">当前 ${state.picked.points} 分 · 累计消费 ${fmtMoney(state.picked.totalSpend)}</div></div>
      <button class="pk-clear" id="pkClear">更换</button>`;
    $('#pkClear').onclick = () => { state.picked = null; renderPicked(); updatePreview(); };
  }
  updatePreview();
}

function updatePreview() {
  const amount = Number($('#consumeAmount').value || 0);
  const pts = Math.floor(amount / 10);
  $('#previewPoints').textContent = pts;
  $('#confirmConsume').disabled = !(amount > 0 && state.picked);
}

function searchConsume() {
  const q = $('#consumeSearch').value.trim().toLowerCase();
  const box = $('#consumeResults');
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const hits = state.members.filter(
    (m) => m.name.toLowerCase().includes(q) || m.phone.toLowerCase().includes(q) || m.cardNo.toLowerCase().includes(q)
  );
  if (!hits.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = hits
    .map((m) => `<div class="sg-item" data-id="${m.id}">
        <div class="avatar" style="width:34px;height:34px;font-size:14px">${esc(m.name.slice(0, 1))}</div>
        <div class="sg-name">${esc(m.name)}</div>
        <div class="sg-meta">${m.phone || '—'} · ${m.points} 分</div>
      </div>`)
    .join('');
}

function pickMember(id) {
  state.picked = state.members.find((m) => m.id === Number(id)) || null;
  $('#consumeResults').classList.add('hidden');
  $('#consumeSearch').value = state.picked ? state.picked.name : '';
  renderPicked();
}

async function confirmConsume() {
  const amount = Number($('#consumeAmount').value || 0);
  if (!(amount > 0)) { toast('请输入消费金额'); return; }
  if (!state.picked) { toast('请先选择会员'); return; }
  try {
    const r = await api(`/api/members/${state.picked.id}/consume`, { method: 'POST', body: { amount } });
    toast(`记消费成功，+${r.gained} 积分`);
    $('#consumeAmount').value = '';
    state.picked = null;
    renderPicked();
    await load();
  } catch (e) {
    toast(e.message);
  }
}

/* ================= 备份 / 还原 ================= */
async function backupToFile() {
  const data = await api('/api/backup');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `会员积分备份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('备份文件已生成');
}

function backupCodeDialog() {
  openModal({
    title: '备份码',
    bodyHtml: `<div style="margin-bottom:10px;color:#9aa3b2;font-size:12px">复制下面的文字保存到备忘录，需要时粘贴回来还原。</div>
      <textarea class="modal-code" id="backupCode" readonly></textarea>`,
    okText: '复制',
    onOk: async () => {
      const data = await api('/api/backup');
      $('#backupCode').value = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      try { await navigator.clipboard.writeText($('#backupCode').value); toast('已复制到剪贴板'); }
      catch { toast('请手动复制'); }
      return false;
    },
  });
  api('/api/backup').then((d) => { $('#backupCode').value = btoa(unescape(encodeURIComponent(JSON.stringify(d)))); });
}

function restoreFromFile() {
  $('#restoreInput').click();
}

function restoreCodeDialog() {
  openModal({
    title: '从备份码还原',
    bodyHtml: `<label>粘贴备份码</label><textarea class="modal-code" id="restoreCode" placeholder="在此粘贴备份码"></textarea>`,
    okText: '还原',
    onOk: async () => {
      const raw = $('#restoreCode').value.trim();
      if (!raw) { toast('请先粘贴备份码'); return false; }
      let data;
      try { data = JSON.parse(decodeURIComponent(escape(atob(raw)))); }
      catch { toast('备份码格式不正确'); return false; }
      await api('/api/restore', { method: 'POST', body: data });
      toast('还原成功');
      await load();
    },
  });
}

async function clearAll() {
  openModal({
    title: '清空所有数据',
    bodyHtml: '<div>此操作会删除全部会员和流水，且无法撤销。建议先做一次备份。</div>',
    okText: '确认清空',
    onOk: async () => {
      await api('/api/all', { method: 'DELETE' });
      toast('已清空');
      await load();
    },
  });
}

/* ================= 视图切换 ================= */
const TITLES = {
  members: { t: '会员积分', s: '' },
  consume: { t: '记消费', s: '' },
  flow: { t: '流水与设置', s: '' },
};

function switchTab(tab) {
  state.tab = tab;
  ['members', 'consume', 'flow'].forEach((t) => {
    $('#view-' + t).classList.toggle('hidden', t !== tab);
  });
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#pageTitle').textContent = TITLES[tab].t;
  $('#pageSub').textContent = TITLES[tab].s || greeting();
  $('#headerAction').classList.toggle('hidden', tab === 'flow');
  if (tab === 'flow') $('#headerAction').textContent = '＋ 新增';
  window.scrollTo({ top: 0 });
}

function greeting() {
  const h = new Date().getHours();
  const word = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  const d = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${word} · ${d.getMonth() + 1}月${d.getDate()}日 ${week}`;
}

/* ================= 事件绑定 ================= */
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('.tab');
  if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }

  const actBtn = e.target.closest('[data-act]');
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === 'add') addMemberDialog();
    else if (act === 'consume') switchTab('consume');
    else if (act === 'flow') switchTab('flow');
    return;
  }

  const headerBtn = e.target.closest('#headerAction');
  if (headerBtn) { addMemberDialog(); return; }

  const opBtn = e.target.closest('.mc-ops [data-op]');
  if (opBtn) {
    const id = Number(opBtn.closest('.member-card').dataset.id);
    const m = state.members.find((x) => x.id === id);
    if (!m) return;
    if (opBtn.dataset.op === 'consume') {
      state.picked = m;
      switchTab('consume');
      renderPicked();
    } else if (opBtn.dataset.op === 'edit') editMemberDialog(m);
    else if (opBtn.dataset.op === 'del') deleteMember(m);
    return;
  }

  const sg = e.target.closest('.sg-item');
  if (sg) { pickMember(sg.dataset.id); return; }

  if (e.target.closest('#btnBackupFile')) backupToFile();
  if (e.target.closest('#btnRestoreFile')) restoreFromFile();
  if (e.target.closest('#btnBackupCode')) backupCodeDialog();
  if (e.target.closest('#btnRestoreCode')) restoreCodeDialog();
  if (e.target.closest('#btnClear')) clearAll();
});

$('#memberSearch').addEventListener('input', debounce(load, 220));
$('#sortSelect').addEventListener('change', load);
$('#consumeSearch').addEventListener('input', searchConsume);
$('#consumeAmount').addEventListener('input', updatePreview);
$('#confirmConsume').addEventListener('click', confirmConsume);

$('#restoreInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    await api('/api/restore', { method: 'POST', body: data });
    toast('还原成功');
    await load();
  } catch (err) {
    toast('还原失败：' + err.message);
  }
  e.target.value = '';
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ================= 启动 ================= */
(async function init() {
  $('#pageSub').textContent = greeting();
  await load();
  switchTab('members');
})();

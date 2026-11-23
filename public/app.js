/* ============================================================
   会员积分 —— 应用逻辑（服务端版 / 端侧版共用）
   数据访问统一走 window.Store
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* core.js 把工具函数挂在 window.Core 命名空间下 */
const { ptsFmt, amountToPoints, tierOf, tierLevel, nextTierInfo, txnLabel, money, esc, backupFormatLabel, checkBackupConsistency } = window.Core;

/* ---------- 全局状态 ---------- */
const SORTS = [
  { key: 'recent', label: '最近加入' },
  { key: 'created', label: '开卡时间' },
  { key: 'points', label: '积分最多' },
  { key: 'spend', label: '消费最多' },
  { key: 'card', label: '卡号' },
  { key: 'name', label: '姓名' },
];
let sortKey = localStorage.getItem('mp-sort') || 'recent';
let curTab = 'member';
let curMemberId = null;
let spentVisible = false;
let homeSpentVisible = false;
let paySel = null;
let MEMBERS = [];

/* ---------- 提示 ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 1900);
}

/* ---------- 底部弹层 ---------- */
function openSheet(title, html, onOk, onMount) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#mask').classList.add('on');
  $('#sheet').classList.add('on');
  if (onOk) {
    const btn = $('#sheetBody').querySelector('[data-sheet-ok]');
    if (btn) btn.onclick = () => { if (onOk() !== false) closeSheet(); };
  }
  if (onMount) onMount($('#sheetBody'));
}
function closeSheet() {
  $('#mask').classList.remove('on');
  $('#sheet').classList.remove('on');
}
$('#mask').onclick = closeSheet;

/* ---------- 底部导航 ---------- */
function goTab(tab) {
  curTab = tab;
  $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const map = { member: 'pMember', pay: 'pPay', txn: 'pTxn' };
  $('#pDetail').classList.remove('on');
  $$('.page').forEach((p) => p.classList.remove('on'));
  $('#' + map[tab]).classList.add('on');
  $('#hTitle').textContent = { member: '会员积分', pay: '记消费', txn: '流水总览' }[tab];
  $('#btnBack').style.display = 'none';
  $('#hDate').textContent = dateText();
  $('#hAction').style.display = tab === 'member' ? '' : 'none';
  if (tab === 'member') renderMembers();
  if (tab === 'txn') renderAllTxns();
  if (tab === 'pay') renderPay();
  window.scrollTo(0, 0);
}
$$('nav button').forEach((b) => (b.onclick = () => goTab(b.dataset.tab)));

/* ---------- 日期问候 ---------- */
function dateText() {
  const d = new Date();
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const h = d.getHours();
  const greet = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  return `${greet} · ${d.getMonth() + 1}月${d.getDate()}日 周${wd}`;
}

/* ---------- 头像 / 等级 ---------- */
const AVATARS = ['', 'a2', 'a3', 'a4'];
const avatarClass = (id) => AVATARS[id % 4];

function tierBadge(spent) {
  const t = tierOf(spent);
  return `<span class="tier" style="color:${t.color};background:${t.bg}">${t.icon} ${t.name}</span>`;
}

/* ============================================================
   会员列表
   ============================================================ */
async function renderMembers() {
  const kw = $('#qMember').value.trim();
  try {
    MEMBERS = await Store.listMembers({ q: kw, sort: sortKey });
  } catch (e) {
    toast(e.message);
    return;
  }

  const stats = await Store.stats().catch(() => ({ memberCount: 0, totalPoints: 0, totalAmount: 0 }));
  $('#sCnt').textContent = stats.memberCount;

  if (homeSpentVisible) {
    $('#sBal').textContent = '¥' + money(stats.totalAmount);
    $('#sBalLabel').textContent = '累计消费';
  } else {
    $('#sBal').textContent = '—';
    $('#sBalLabel').textContent = '消费（点击查看）';
  }
  $('#sPts').textContent = ptsFmt(stats.totalPoints);

  const box = $('#memberList');
  if (!MEMBERS.length) {
    box.innerHTML = stats.memberCount
      ? `<div class="empty"><div class="empty-ico">🔍</div><div class="empty-t">没有匹配的会员</div><div class="empty-s">换个姓名或手机号试试</div></div>`
      : `<div class="empty"><div class="empty-ico">👥</div><div class="empty-t">还没有会员</div><div class="empty-s">添加第一位会员，开始记录消费与积分</div><button class="btn sm" id="emptyAdd">+ 新增会员</button></div>`;
    const ea = $('#emptyAdd');
    if (ea) ea.onclick = () => $('#hAction').click();
    return;
  }

  box.innerHTML = MEMBERS.map((m) => `
    <div class="mcard" data-id="${m.id}">
      <div class="avatar ${avatarClass(m.id)}">${esc((m.name || '?').slice(0, 1))}</div>
      <div class="minfo">
        <div class="nm">${esc(m.name)}</div>
        <div class="sub">${esc(m.phone || '未填手机号')}</div>
        <div class="sub2">${tierBadge(m.totalSpend)}<span class="cardno">${esc(m.cardNo)}</span></div>
      </div>
      <div class="mpts">
        <b>${ptsFmt(m.points)}</b>
        <span>积分</span>
      </div>
    </div>`).join('');

  box.querySelectorAll('.mcard').forEach((el) => {
    el.onclick = () => openDetail(Number(el.dataset.id));
  });
}

/* ---------- 排序 ---------- */
function updateSortLabel() {
  const item = SORTS.find((x) => x.key === sortKey) || SORTS[0];
  $('#sortLabel').textContent = item.label;
  $('#btnSort').classList.toggle('sorted', sortKey !== 'recent');
}
$('#btnSort').onclick = () => {
  openSheet('排序方式', SORTS.map((x) => `
    <div class="pickrow" data-key="${x.key}" style="cursor:pointer">
      <div class="minfo"><div class="nm">${x.label}${x.key === sortKey ? ' ✓' : ''}</div></div>
    </div>`).join(''), null, (sheet) => {
    sheet.querySelectorAll('.pickrow').forEach((el) => {
      el.onclick = () => {
        sortKey = el.dataset.key;
        localStorage.setItem('mp-sort', sortKey);
        updateSortLabel();
        closeSheet();
        renderMembers();
      };
    });
  });
};
updateSortLabel();

$('#qMember').oninput = debounce(renderMembers, 200);
$('#qkPay').onclick = () => goTab('pay');
$('#qkAdd').onclick = () => $('#hAction').click();
$('#qkTxn').onclick = () => goTab('txn');
$('#statSpent').onclick = () => {
  homeSpentVisible = !homeSpentVisible;
  renderMembers();
};

/* ============================================================
   会员详情
   ============================================================ */
async function openDetail(id) {
  curMemberId = id;
  const m = MEMBERS.find((x) => x.id === id);
  if (!m) { toast('会员不存在'); return; }

  spentVisible = false;
  $('#cardModal').classList.remove('on');
  $('#btnBack').style.display = '';
  $$('.page').forEach((p) => p.classList.remove('on'));
  $('#pDetail').classList.add('on');
  $('#hTitle').textContent = m.name;
  $('#hAction').style.display = 'none';
  window.scrollTo(0, 0);
  await renderDetail();
}

async function renderDetail() {
  const m = MEMBERS.find((x) => x.id === curMemberId);
  if (!m) { goTab('member'); return; }

  $('#dMeta').textContent =
    (m.phone ? `手机 ${m.phone}` : '未填手机号') + ` · 卡号 ${m.cardNo}` + (m.note ? ` · ${m.note}` : '');
  $('#dPts').textContent = ptsFmt(m.points);

  const t = tierOf(m.totalSpend);
  $('#dTier').textContent = t.icon + ' ' + t.name;

  const info = nextTierInfo(m.totalSpend);
  if (info) {
    $('#dProgressWrap').style.display = '';
    $('#dProgressBar').style.width = Math.min(100, info.progress * 100) + '%';
    $('#dNextTier').textContent = `再消费 ¥${money(info.need)} 升级 ${info.next.name}`;
  } else {
    $('#dProgressWrap').style.display = '';
    $('#dProgressBar').style.width = '100%';
    $('#dNextTier').textContent = '已是最高等级 · 感谢支持';
  }
  renderSpentLabel();

  const list = await Store.listTransactions('all');
  const mine = list.filter((x) => x.memberId === curMemberId);
  $('#dTxnCnt').textContent = mine.length ? mine.length + ' 条' : '';
  $('#dTxns').innerHTML = mine.length
    ? mine.map((x) => txnRow(x)).join('')
    : '<div class="empty" style="padding:22px 0">暂无流水</div>';
}

function renderSpentLabel() {
  const m = MEMBERS.find((x) => x.id === curMemberId);
  if (!m) return;
  $('#spentLabel').innerHTML = spentVisible
    ? `累计消费 <b>¥${money(m.totalSpend)}</b> · 点一下隐藏`
    : '累计消费 · 点一下查看';
}
$('#btnSpentToggle').onclick = () => {
  spentVisible = !spentVisible;
  renderSpentLabel();
};

/* ---------- 详情页：记消费 ---------- */
function updateDetailCalc() {
  const amt = parseFloat($('#dConsumeAmt').value) || 0;
  $('#dCalcPts').textContent = amt > 0 ? ptsFmt(amountToPoints(amt)) : '0';
}
$('#dConsumeAmt').oninput = updateDetailCalc;

$('#btnDConsume').onclick = async () => {
  const amt = parseFloat($('#dConsumeAmt').value);
  if (!(amt > 0)) return toast('请输入消费金额');
  try {
    const gained = amountToPoints(amt);
    await Store.consume(curMemberId, { amount: amt });
    $('#dConsumeAmt').value = '';
    updateDetailCalc();
    toast(`已记消费 ¥${money(amt)}，+${ptsFmt(gained)} 分`);
    await refreshMember();
  } catch (e) {
    toast(e.message);
  }
};

/* ---------- 积分调整 ---------- */
$('#adjSeg').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    $('#adjSeg').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const isAdd = b.dataset.mode === 'add';
    $('#boxAddPts').style.display = isAdd ? '' : 'none';
    $('#boxDeductPts').style.display = isAdd ? 'none' : '';
  };
});

async function adjustPoints(mode) {
  const amtId = mode === 'add' ? '#addPtsAmt' : '#dedPtsAmt';
  const noteId = mode === 'add' ? '#addPtsNote' : '#dedPtsNote';
  const pts = parseFloat($(amtId).value);
  if (!(pts > 0)) return toast('请输入要调整的积分');
  const note = $(noteId).value.trim();
  try {
    await Store.adjustPoints(curMemberId, { points: pts, mode, note });
    $(amtId).value = '';
    $(noteId).value = '';
    toast(`${mode === 'add' ? '积分 +' : '积分 -'}${ptsFmt(pts)}`);
    await refreshMember();
  } catch (e) {
    toast(e.message);
  }
}
$('#btnAddPts').onclick = () => adjustPoints('add');
$('#btnDedPts').onclick = () => adjustPoints('deduct');

/** 重新拉取会员数据并刷新列表 + 详情 */
async function refreshMember() {
  MEMBERS = await Store.listMembers({ q: '', sort: 'recent' });
  await renderMembers();
  if (curMemberId) await renderDetail();
}

/* ---------- 返回 ---------- */
function goBack() {
  if ($('#pDetail').classList.contains('on')) {
    goTab('member');
    return true;
  }
  return false;
}
$('#btnBack').onclick = goBack;
window.addEventListener('popstate', () => {
  if (goBack()) history.pushState({ inApp: true }, '');
  else history.back();
});
history.pushState({ inApp: true }, '');

/* ---------- 删除会员 ---------- */
$('#btnDelete').onclick = () => {
  const m = MEMBERS.find((x) => x.id === curMemberId);
  openSheet('删除会员', `
    <p style="text-align:center;color:var(--sub);font-size:14px;margin:4px 0 16px">
      确定删除「${esc(m.name)}」及其全部流水？<br>此操作不可恢复。</p>
    <button class="btn danger" id="delOk" data-sheet-ok style="margin-bottom:8px">确认删除</button>
    <button class="btn ghost" id="delCancel">取消</button>
  `, async () => {
    await Store.deleteMember(curMemberId);
    closeSheet();
    toast('已删除');
    curMemberId = null;
    goTab('member');
    await renderMembers();
  }, (sheet) => {
    sheet.querySelector('#delCancel').onclick = closeSheet;
  });
};

/* ---------- 客户积分卡 ---------- */
$('#btnCard').onclick = () => {
  const m = MEMBERS.find((x) => x.id === curMemberId);
  if (!m) return;
  const lvl = tierLevel(m.totalSpend);
  const ct = tierOf(m.totalSpend);
  $('#ccCard').dataset.tier = String(lvl);
  $('#ccTier').textContent = ct.icon + ' ' + ct.name;
  $('#ccLogo').textContent = ct.icon;
  $('#ccName').textContent = m.name;
  $('#ccNo').textContent = 'NO. ' + m.cardNo;
  $('#ccPoints').textContent = ptsFmt(m.points);

  const start = new Date(m.createdAt || Date.now());
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  $('#ccValid').textContent = 'VALID THRU ' + pad(end.getMonth() + 1) + '/' + String(end.getFullYear()).slice(2);

  $('#cardModal').classList.add('on');
};

/* ============================================================
   新增会员
   ============================================================ */
$('#hAction').onclick = () => {
  openSheet('新增会员', `
    <label class="fld"><span>姓名 *</span><input id="nName" placeholder="张女士"></label>
    <label class="fld"><span>手机号（选填）</span><input id="nPhone" inputmode="numeric" maxlength="11" placeholder="可不填"></label>
    <label class="fld"><span>卡号（留空自动生成）</span><input id="nCard" placeholder=""></label>
    <label class="fld"><span>备注</span><input id="nNote" placeholder=""></label>
    <button class="btn" id="nOk" data-sheet-ok>保存</button>
  `, async () => {
    const name = $('#nName').value.trim();
    if (!name) { toast('请填写姓名'); return false; }
    try {
      await Store.addMember({
        name,
        phone: $('#nPhone').value.trim(),
        cardNo: $('#nCard').value.trim(),
        note: $('#nNote').value.trim(),
      });
      closeSheet();
      toast('已新增会员');
      await renderMembers();
    } catch (e) {
      toast(e.message);
      return false;
    }
  }, () => setTimeout(() => $('#nPhone').focus(), 80));
};

/* ============================================================
   记消费页
   ============================================================ */
async function renderPay() {
  const kw = ($('#qPay').value || '').trim();
  paySel = null;
  $('#payFound').style.display = 'none';
  $('#btnPay').disabled = true;

  if (!kw) { closeSheet(); return; }
  const hits = await Store.listMembers({ q: kw });
  if (!hits.length) { openSheet('未找到会员', '<div class="empty">没有匹配的会员</div>'); return; }
  if (hits.length === 1) { pickPay(hits[0]); return; }

  openSheet('选择会员', hits.slice(0, 12).map((m) => `
    <div class="pickrow" data-id="${m.id}">
      <div class="avatar ${avatarClass(m.id)}" style="width:38px;height:38px;font-size:15px;border-radius:12px">${esc((m.name || '?').slice(0, 1))}</div>
      <div class="minfo">
        <div class="nm">${esc(m.name)}</div>
        <div class="sub">${esc(m.phone || '—')} · 积分 ${ptsFmt(m.points)}</div>
      </div>
    </div>`).join(''), null, (sheet) => {
    sheet.querySelectorAll('.pickrow').forEach((el) => {
      el.onclick = () => { pickPay(hits.find((m) => m.id === Number(el.dataset.id))); closeSheet(); };
    });
  });
}

function pickPay(m) {
  if (!m) return;
  paySel = m;
  $('#payFound').style.display = '';
  const av = $('#payAvatar');
  av.className = 'avatar ' + avatarClass(m.id);
  av.textContent = (m.name || '?').slice(0, 1);
  $('#payName').textContent = m.name;
  $('#payInfo').textContent = `${m.phone || '未填手机号'} · 积分 ${ptsFmt(m.points)}`;
  $('#btnPay').disabled = false;
}

$('#qPay').oninput = () => {
  if ($('#qPay').value.trim()) renderPay();
  else {
    closeSheet();
    paySel = null;
    $('#payFound').style.display = 'none';
    $('#btnPay').disabled = true;
  }
};

function updateCalc() {
  const amt = parseFloat($('#payAmt').value) || 0;
  $('#calcPts').textContent = amt > 0 ? ptsFmt(amountToPoints(amt)) : '0';
}
$('#payAmt').oninput = updateCalc;

$('#btnPay').onclick = async () => {
  if (!paySel) return toast('请先选择会员');
  const amt = parseFloat($('#payAmt').value);
  if (!(amt > 0)) return toast('请输入消费金额');
  try {
    const gained = amountToPoints(amt);
    await Store.consume(paySel.id, { amount: amt });
    toast(`已记消费 ¥${money(amt)}，+${ptsFmt(gained)} 分`);
    $('#payAmt').value = '';
    updateCalc();
    const fresh = await Store.listMembers({ q: '' });
    const m = fresh.find((x) => x.id === paySel.id);
    if (m) pickPay(m);
  } catch (e) {
    toast(e.message);
  }
};

/* ============================================================
   流水总览
   按日期分组 + 类型筛选 + 会员筛选 + 关键词搜索 + 分页加载
   ============================================================ */
const TXN_PAGE = 30;      // 每页条数
let txnType = 'all';
let txnLimit = TXN_PAGE;
let txnAll = [];

$('#txnSeg').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    $('#txnSeg').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    txnType = b.dataset.type;
    txnLimit = TXN_PAGE;
    renderAllTxns();
  };
});

$('#txnSearch').addEventListener('input', debounce(() => {
  txnLimit = TXN_PAGE;
  renderAllTxns();
}, 200));

$('#txnMember').addEventListener('change', () => {
  txnLimit = TXN_PAGE;
  renderAllTxns();
});

$('#txnMore').onclick = () => {
  txnLimit += TXN_PAGE;
  renderAllTxns();
};

/** 按日期分组 */
function groupByDate(list) {
  const map = new Map();
  for (const t of list) {
    const key = t.createdAt.slice(0, 10);   // YYYY-MM-DD
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}

function dateLabel(key) {
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  const y = new Date(Date.now() - 86400000);
  const yKey = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
  const [yy, mm, dd] = key.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  let title;
  if (key === todayKey) title = '今天';
  else if (key === yKey) title = '昨天';
  else if (today.getFullYear() === yy) title = `${mm}月${dd}日`;
  else title = `${yy}年${mm}月${dd}日`;
  return { title, week: wk };
}

async function renderAllTxns() {
  const raw = await Store.listTransactions('all');
  const kw = $('#txnSearch').value.trim().toLowerCase();
  const mid = $('#txnMember').value;

  let list = raw;
  if (txnType === 'consume') list = list.filter((t) => t.type === 'consume');
  if (txnType === 'points') list = list.filter((t) => t.type === 'pointAdd' || t.type === 'pointUse');
  if (mid) list = list.filter((t) => String(t.memberId) === mid);
  if (kw) {
    list = list.filter((t) =>
      String(t.memberName).toLowerCase().includes(kw) ||
      String(t.note || '').toLowerCase().includes(kw));
  }
  txnAll = list;

  /* ---- 汇总 ---- */
  const totalAmt = list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalPts = list.reduce((s, t) => s + (Number(t.points) || 0), 0);
  $('#tsCount').textContent = list.length;
  $('#tsAmount').textContent = '¥' + money(totalAmt);
  $('#tsPoints').textContent = (totalPts > 0 ? '+' : '') + ptsFmt(totalPts);

  /* ---- 会员下拉选项 ---- */
  const sel = $('#txnMember');
  const cur = sel.value;
  const names = new Map();
  for (const t of raw) if (!names.has(t.memberId)) names.set(t.memberId, t.memberName);
  sel.innerHTML = '<option value="">全部会员</option>' +
    Array.from(names.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
      .map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  sel.value = cur;

  /* ---- 空态 ---- */
  const groupsBox = $('#txnGroups');
  const box = $('#allTxns');
  const more = $('#txnMore');

  if (!list.length) {
    groupsBox.innerHTML = '';
    more.style.display = 'none';
    box.innerHTML = raw.length
      ? `<div class="txn-empty"><div class="te-ico">🔍</div>没有符合条件的流水<br>试试换个筛选条件</div>`
      : `<div class="txn-empty"><div class="te-ico">🧾</div>暂无流水<br>有消费和积分变动后会显示在这里</div>`;
    return;
  }

  /* ---- 分组渲染（只渲染前 N 条） ---- */
  const shown = list.slice(0, txnLimit);
  const groups = groupByDate(shown);
  const parts = [];
  for (const [key, items] of groups) {
    const { title, week } = dateLabel(key);
    const dayAmt = items.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const sumText = dayAmt > 0 ? `当日 ¥${money(dayAmt)}` : '';
    parts.push(`<div class="txn-group">
      <div class="tg-head">
        <span class="tg-date">${title}</span>
        <span class="tg-week">${week}</span>
        <span class="tg-sum">${sumText}</span>
        <span class="tg-count">${items.length} 笔</span>
      </div>
      ${items.map((t) => txnGroupRow(t)).join('')}
    </div>`);
  }
  groupsBox.innerHTML = parts.join('');
  box.innerHTML = '';

  /* ---- 加载更多 ---- */
  if (list.length > txnLimit) {
    more.style.display = '';
    more.textContent = `加载更多（还有 ${list.length - txnLimit} 条）`;
  } else {
    more.style.display = 'none';
  }
}

/** 分组内的流水行（带类型标签） */
function txnGroupRow(t) {
  const amt = t.amount !== 0
    ? `<div class="amt ${t.amount > 0 ? 'in' : 'out'}">${t.amount > 0 ? '+' : '-'}¥${money(Math.abs(t.amount))}</div>` : '';
  const pts = t.points !== 0
    ? `<div class="pts ${t.points > 0 ? 'pos' : 'neg'}">${t.points > 0 ? '+' : ''}${ptsFmt(t.points)} 分</div>` : '';
  const typeCls = t.type === 'consume' ? 'tt-consume'
    : t.type === 'pointAdd' ? 'tt-pointAdd' : 'tt-pointUse';
  return `<div class="txn">
    <div class="t1">
      <div class="a">
        <span class="txn-type ${typeCls}">${txnLabel(t.type)}</span>
        <span class="txn-who">${esc(t.memberName)}</span>
      </div>
      <div class="b">${fmtTime(t.createdAt).slice(11)}${t.note ? ' · ' + esc(t.note) : ''}</div>
    </div>
    <div>${amt}${pts}</div>
  </div>`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function txnIcon(t) {
  if (t.type === 'consume') return '↓';
  if (t.type === 'pointAdd') return '+';
  if (t.type === 'pointUse') return '−';
  return '↑';
}
function txnIconClass(t) {
  if (t.type === 'consume') return 'i-out';
  if (t.type === 'pointAdd' || t.type === 'pointUse') return 'i-pts';
  return 'i-in';
}
/** 详情页内的流水行（带图标） */
function txnRow(t) {
  const amt = t.amount !== 0
    ? `<div class="amt ${t.amount > 0 ? 'in' : 'out'}">${t.amount > 0 ? '+' : '-'}¥${money(Math.abs(t.amount))}</div>` : '';
  const pts = t.points !== 0
    ? `<div class="pts ${t.points > 0 ? 'pos' : 'neg'}">${t.points > 0 ? '+' : ''}${ptsFmt(t.points)} 分</div>` : '';
  return `<div class="txn">
    <div class="ico ${txnIconClass(t)}">${txnIcon(t)}</div>
    <div class="t1">
      <div class="a">${txnLabel(t.type)}</div>
      <div class="b">${fmtTime(t.createdAt)} · ${esc(t.note)}</div>
    </div>
    <div>${amt}${pts}</div>
  </div>`;
}

/* ============================================================
   备份与还原
   ============================================================ */
async function backupToFile() {
  try {
    const data = await Store.backup();
    const json = JSON.stringify(data, null, 1);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '_' +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `会员备份_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已备份 ${data.members.length} 位会员、${data.transactions.length} 条流水`);
  } catch (e) {
    toast('备份失败：' + e.message);
  }
}

function restoreFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { return toast('文件不是有效的备份：' + e.message); }
      if (!data || !Array.isArray(data.members)) return toast('文件格式不对，缺少 members');

      const fmt = backupFormatLabel(data);
      const txCount = (data.transactions || data.txns || []).length;
      const ok = confirm(
        `从备份还原？\n\n` +
        `备份时间：${data.exportedAt ? String(data.exportedAt).slice(0, 16).replace('T', ' ') : '未知'}\n` +
        `会员：${data.members.length} 位\n` +
        `流水：${txCount} 条\n` +
        (fmt ? `\n${fmt}\n` : '') +
        `\n⚠️ 当前数据将被覆盖，不可恢复。`);
      if (!ok) return;
      try {
        await Store.restore(data);
        const warns = checkBackupConsistency(data);
        await renderMembers();
        await renderAllTxns();
        if (warns.length) {
          // 数据有出入 —— 会员汇总与流水对不上，温和提示但不改数据
          openSheet('已还原，但数据有出入', `
            <p style="font-size:13px;color:var(--sub);margin:0 0 12px;line-height:1.6">
              以下项目的<b>会员汇总值</b>与<b>流水明细</b>不一致，数据已按备份原样导入，未做修改：</p>
            <div style="background:var(--input-bg);border-radius:12px;padding:12px;margin-bottom:14px">
              ${warns.map((w) => `<div style="font-size:12.5px;color:var(--txt);margin-bottom:6px;line-height:1.5">· ${esc(w)}</div>`).join('')}
            </div>
            <p style="font-size:12px;color:var(--sub);margin:0;line-height:1.6">
              会员列表显示的是<b>汇总值</b>，流水页显示的是<b>每笔明细</b>。<br>
              如果汇总值是对的，说明历史流水没记全，属正常。</p>
            <button class="btn" id="warnOk" data-sheet-ok style="margin-top:14px">知道了</button>
          `);
        } else {
          toast(`已还原：${data.members.length} 位会员${fmt}`);
        }
      } catch (e) {
        toast('还原失败：' + e.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

async function backupCodeDialog() {
  const data = await Store.backup();
  const json = JSON.stringify(data);
  openSheet('备份码', `
    <p style="font-size:12px;color:var(--sub);margin:0 0 10px;line-height:1.6">
      全选复制下面这段文字，存到备忘录或发给自己的微信。<br>
      以后在新设备上打开本页，粘贴即可还原。</p>
    <textarea id="bkCode" rows="10" readonly
      style="width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--line);
      background:var(--input-bg);color:var(--txt);font-size:11px;
      font-family:ui-monospace,monospace;resize:vertical">${esc(json)}</textarea>
    <button class="btn" id="bkCopy" style="margin-top:10px">复制全部</button>
    <button class="btn ghost" id="bkRestore" style="margin-top:8px">从备份码还原</button>
  `, null, (sheet) => {
    sheet.querySelector('#bkCopy').onclick = async () => {
      const ta = sheet.querySelector('#bkCode');
      ta.select();
      ta.setSelectionRange(0, 999999);
      try { await navigator.clipboard.writeText(ta.value); toast('已复制到剪贴板'); }
      catch (e) { document.execCommand('copy'); toast('已复制'); }
    };
    sheet.querySelector('#bkRestore').onclick = () => restoreCodeDialog();
  });
}

async function restoreCodeDialog() {
  openSheet('从备份码还原', `
    <label class="fld"><span>粘贴备份码</span>
      <textarea id="rsCode" rows="8" placeholder="粘贴之前复制的备份内容"
        style="width:100%;padding:12px;border-radius:12px;border:1.5px solid var(--line);
        background:var(--input-bg);color:var(--txt);font-size:11px;
        font-family:ui-monospace,monospace;resize:vertical"></textarea></label>
    <button class="btn" id="rsOk" data-sheet-ok>确认还原</button>
  `, async () => {
    const raw = sheetValue('#rsCode').trim();
    if (!raw) { toast('请先粘贴备份码'); return false; }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { toast('备份码格式错误'); return false; }
    try {
      await Store.restore(data);
      const warns = checkBackupConsistency(data);
      closeSheet();
      await renderMembers();
      await renderAllTxns();
      if (warns.length) {
        openSheet('已还原，但数据有出入', `
          <p style="font-size:13px;color:var(--sub);margin:0 0 12px;line-height:1.6">
            以下项目的<b>会员汇总值</b>与<b>流水明细</b>不一致，数据已按备份原样导入，未做修改：</p>
          <div style="background:var(--input-bg);border-radius:12px;padding:12px;margin-bottom:14px">
            ${warns.map((w) => `<div style="font-size:12.5px;color:var(--txt);margin-bottom:6px;line-height:1.5">· ${esc(w)}</div>`).join('')}
          </div>
          <p style="font-size:12px;color:var(--sub);margin:0;line-height:1.6">
            会员列表显示的是<b>汇总值</b>，流水页显示的是<b>每笔明细</b>。<br>
            如果汇总值是对的，说明历史流水没记全，属正常。</p>
          <button class="btn" id="warnOk" data-sheet-ok style="margin-top:14px">知道了</button>
        `);
      } else {
        toast(`已还原：${data.members.length} 位会员${backupFormatLabel(data)}`);
      }
    } catch (e) {
      toast('还原失败：' + e.message);
      return false;
    }
  });
}
const sheetValue = (sel) => (document.querySelector(sel) || {}).value || '';

$('#btnBackupFile').onclick = backupToFile;
$('#btnRestoreFile').onclick = restoreFromFile;
$('#btnBackupText').onclick = backupCodeDialog;

$('#btnClearAll').onclick = () => {
  openSheet('清空所有数据', `
    <p style="text-align:center;color:var(--sub);font-size:14px;margin:4px 0 16px">
      将删除全部会员和流水，<b>无法恢复</b>。<br>建议先做一次备份。</p>
    <button class="btn danger" id="clrOk" data-sheet-ok>确认清空</button>
    <button class="btn ghost" id="clrCancel">取消</button>
  `, async () => {
    await Store.clearAll();
    closeSheet();
    toast('已清空');
    await renderMembers();
    await renderAllTxns();
  }, (sheet) => {
    sheet.querySelector('#clrCancel').onclick = closeSheet;
  });
};

/* ---------- 工具 ---------- */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ============================================================
   启动
   ============================================================ */
(async function init() {
  $('#hDate').textContent = dateText();
  try {
    await Store.init();
    await renderMembers();
  } catch (e) {
    toast('初始化失败：' + e.message);
  }
  goTab('member');
})();

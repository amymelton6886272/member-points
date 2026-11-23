/* ============================================================
   共享核心逻辑 —— 服务端（CommonJS）与端侧（ESM）共用
   积分规则：消费 10 元 = 1 积分，支持小数（11 元 = 1.1 分）
   积分内部一律用「0.1 分」为单位的整数存储，杜绝浮点误差
   ============================================================ */

const POINTS_PER_YUAN = 10;

/* ---------- 积分：字符串/数字 <-> 整数单位（0.1 分为 1 单位） ---------- */
function toUnits(points) {
  const num = parseFloat(points);
  if (!isFinite(num)) return 0;
  return Math.round(num * 10);
}

function fromUnits(units) {
  const n = Math.round(Number(units) || 0);
  const neg = n < 0;
  const a = Math.abs(n);
  return (neg ? '-' : '') + Math.floor(a / 10) + '.' + (a % 10);
}

/** 展示用：12 -> "12"，12.5 -> "12.5"，0 -> "0" */
function ptsFmt(points) {
  const units = toUnits(points);
  const neg = units < 0;
  const a = Math.abs(units);
  const whole = Math.floor(a / 10);
  const frac = a % 10;
  return (neg ? '-' : '') + whole + (frac === 0 ? '' : '.' + frac);
}

/** 金额 -> 积分。11 元 = 1.1 分；128.5 元 = 12.85 分（保留 2 位） */
function amountToPoints(amount) {
  const cents = Math.round(Number(amount) * 100);
  // 分（0.1 积分）= 金额分 / 10
  return round2(cents / 100 / POINTS_PER_YUAN);
}

/** 积分数值加减（返回字符串形式） */
function addPts(current, delta) {
  return fromUnits(toUnits(current) + toUnits(delta));
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/* ---------- 会员等级：按累计消费分档 ---------- */
const TIERS = [
  { name: '普通会员', min: 0, color: '#7d8794', bg: '#f0f2f4', icon: '○' },
  { name: '银卡会员', min: 1000, color: '#c2557f', bg: '#fdeaf1', icon: '◐' },
  { name: '金卡会员', min: 2000, color: '#b8894a', bg: '#fdf3e2', icon: '●' },
  { name: '钻石会员', min: 3000, color: '#8f5fc4', bg: '#f3ecfd', icon: '◆' },
];

function tierLevel(spent) {
  const v = Number(spent) || 0;
  if (v >= 3000) return 3;
  if (v >= 2000) return 2;
  if (v >= 1000) return 1;
  return 0;
}

function tierOf(spent) {
  return TIERS[tierLevel(spent)];
}

/** 距离下一级还差多少；已封顶返回 null */
function nextTierInfo(spent) {
  const v = Number(spent) || 0;
  const lv = tierLevel(v);
  if (lv >= TIERS.length - 1) return null;
  const next = TIERS[lv + 1];
  return { next, need: round2(next.min - v), progress: v / next.min };
}

/* ---------- 流水类型 ---------- */
const TXN_TYPES = {
  consume: '消费',
  pointAdd: '积分增加',
  pointUse: '积分扣减',
};

function txnLabel(type) {
  return TXN_TYPES[type] || '其他';
}

/* ---------- 工具 ---------- */
const money = (n) => round2(Number(n) || 0).toFixed(2);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ============================================================
   备份数据归一化
   兼容两种历史格式：
     v1（旧版 App / localStorage 导出）
        members: { id, name, card, phone, points:"210.1"(字符串), spent, date }
        txns:    { id, memberId, type, amount(消费为负数), points, remark, createdAt(毫秒) }
     v2（当前版本）
        members: { id, name, phone, cardNo, points:数字, totalSpend, note, createdAt(ISO) }
        transactions: { id, memberId, type, amount, points, note, createdAt(ISO) }
   ============================================================ */

/** 时间归一：毫秒时间戳 / ISO 字符串 / "YYYY-MM-DD HH:mm" → ISO 字符串 */
function normTime(v) {
  if (v == null || v === '') return new Date().toISOString();
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {                      // 字符串形式的毫秒时间戳
    const d = new Date(Number(s));
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** 积分数归一：字符串 "210.1" / 数字 → 数字 */
function normPoints(v) {
  const n = parseFloat(v);
  return isFinite(n) ? round2(n) : 0;
}

/** 会员归一 */
function normMember(m) {
  const spent = m.totalSpend ?? m.total_spend ?? m.spent;
  return {
    id: m.id ?? null,
    name: String(m.name || '未命名'),
    phone: String(m.phone || ''),
    cardNo: String(m.cardNo || m.card_no || m.card || ''),
    points: normPoints(m.points),
    totalSpend: round2(Number(spent) || 0),
    note: String(m.note || m.remark || ''),
    createdAt: normTime(m.createdAt || m.created_at || m.date),
  };
}

/**
 * 流水归一
 * 旧版把消费金额存成负数，这里统一转成正数（金额字段语义 = 消费额）
 */
function normTxn(t) {
  let amount = Number(t.amount) || 0;
  if (amount < 0) amount = Math.abs(amount);

  let type = String(t.type || 'consume');
  if (!['consume', 'pointAdd', 'pointUse'].includes(type)) type = 'consume';

  // 旧版 pointAdd/pointUse 的 points 也可能带符号，保留方向
  let points = normPoints(t.points);
  if (type === 'pointUse') points = -Math.abs(points);
  else if (type === 'pointAdd') points = Math.abs(points);

  return {
    id: t.id ?? null,
    memberId: t.memberId ?? t.member_id ?? null,
    type,
    amount: round2(amount),
    points,
    note: String(t.note || t.remark || ''),
    createdAt: normTime(t.createdAt || t.created_at),
  };
}

/** 整份备份归一 */
function normBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('备份文件格式不正确');
  const members = Array.isArray(data.members) ? data.members.map(normMember) : null;
  if (!members) throw new Error('备份文件格式不正确（缺少 members）');
  const rawTx = data.transactions || data.txns || [];
  const transactions = Array.isArray(rawTx) ? rawTx.map(normTxn) : [];
  return { members, transactions };
}

/** 备份里出现了旧格式时，给用户的提示 */
function backupFormatLabel(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.version === 1 || Array.isArray(data.txns)) return '（旧版格式 v1，已自动转换）';
  return '';
}

/**
 * 校验备份内部一致性
 * 会员的 totalSpend / points 与其流水的汇总对不上时，给出提示。
 * 只提示、不改数据 —— 会员字段通常是权威值，流水可能不完整。
 */
function checkBackupConsistency(data) {
  const warnings = [];
  if (!data || !Array.isArray(data.members)) return warnings;

  const byMember = new Map();
  for (const t of data.transactions || []) {
    const id = t.memberId ?? t.member_id;
    if (!byMember.has(id)) byMember.set(id, { amount: 0, points: 0, n: 0 });
    const agg = byMember.get(id);
    agg.amount += Math.abs(Number(t.amount) || 0);
    agg.points += Number(t.points) || 0;
    agg.n++;
  }

  for (const m of data.members) {
    const agg = byMember.get(m.id);
    if (!agg) continue;
    const mSpend = Math.abs(Number(m.totalSpend ?? m.total_spend ?? m.spent) || 0);
    if (Math.abs(agg.amount - mSpend) > 0.01) {
      warnings.push(`「${m.name}」累计消费 ${mSpend.toFixed(2)} 元，但流水合计 ${agg.amount.toFixed(2)} 元`);
    }
    const mPts = Number(m.points) || 0;
    if (Math.abs(agg.points - mPts) > 0.01) {
      warnings.push(`「${m.name}」积分 ${ptsFmt(mPts)} 分，但流水积分合计 ${ptsFmt(agg.points)} 分`);
    }
  }
  return warnings;
}

export {
  POINTS_PER_YUAN, toUnits, fromUnits, ptsFmt, amountToPoints, addPts, round2,
  TIERS, tierLevel, tierOf, nextTierInfo, TXN_TYPES, txnLabel, money, esc,
  normTime, normPoints, normMember, normTxn, normBackup, backupFormatLabel,
  checkBackupConsistency,
};
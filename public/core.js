/* ============================================================
   共享核心逻辑 —— 服务端（CommonJS）与端侧（ESM）共用
   积分规则：消费 10 元 = 1 积分，支持小数（11 元 = 1.1 分）
   积分内部一律用「0.1 分」为单位的整数存储，杜绝浮点误差
   ============================================================ */

(function () {
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

/* CommonJS 与 ESM 双导出 */
const EXPORTS = {
  POINTS_PER_YUAN, toUnits, fromUnits, ptsFmt, amountToPoints, addPts, round2,
  TIERS, tierLevel, tierOf, nextTierInfo, TXN_TYPES, txnLabel, money, esc,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EXPORTS;
} else {
  // 浏览器端：挂到 window.Core 命名空间。
  // 必须用 IIFE 包住，否则里面的函数声明会成为全局变量，
  // 导致 app.js 里 const { ptsFmt } = window.Core 报「重复声明」。
  window.Core = EXPORTS;
}
})();

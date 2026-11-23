/* ============================================================
   同步脚本：把 public/ 的前端资源转成 web/（Capacitor）版本
   public/  = 服务端版（CommonJS 风格，全局 window.Store）
   web/     = App 版（ESM，import Store from store-native.js）

   用法： node sync-web.js
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const WEB = path.join(ROOT, 'web');

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');

/* ---------- 1. app.js：CommonJS 全局 -> ESM import ---------- */
let app = read(path.join(PUB, 'app.js'));
const GLOBAL_DESTRUCTURE =
  'const { ptsFmt, amountToPoints, tierOf, tierLevel, nextTierInfo, txnLabel, money, esc, backupFormatLabel, checkBackupConsistency } = window.Core;';
const ESM_IMPORT =
  "import { ptsFmt, amountToPoints, tierOf, tierLevel, nextTierInfo, txnLabel, money, esc, backupFormatLabel, checkBackupConsistency } from './core.js';\n" +
  "import { Store } from './store-native.js';";

if (!app.includes(GLOBAL_DESTRUCTURE)) {
  console.error('✗ public/app.js 的解构声明变了，同步脚本需要更新');
  process.exit(1);
}
app = app.replace(GLOBAL_DESTRUCTURE, ESM_IMPORT);
write(path.join(WEB, 'app.js'), app);
console.log('✓ web/app.js');

/* ---------- 2. core.js：IIFE + CommonJS -> ESM ---------- */
let core = read(path.join(PUB, 'core.js'));
// 去掉 IIFE 包裹（不依赖换行符，兼容 CRLF/LF）
core = core.replace(/\(function \(\) \{\s*const POINTS_PER_YUAN/, 'const POINTS_PER_YUAN');
// 替换尾部导出
core = core.replace(
  /\/\* CommonJS 与 ESM 双导出 \*\/[\s\S]*?\}\)\(\);\s*$/,
  `export {
  POINTS_PER_YUAN, toUnits, fromUnits, ptsFmt, amountToPoints, addPts, round2,
  TIERS, tierLevel, tierOf, nextTierInfo, TXN_TYPES, txnLabel, money, esc,
  normTime, normPoints, normMember, normTxn, normBackup, backupFormatLabel,
  checkBackupConsistency,
};`
);
if (!core.includes('export {')) {
  console.error('✗ public/core.js 的导出结构变了，同步脚本需要更新');
  process.exit(1);
}
if (core.includes('(function () {')) {
  console.error('✗ IIFE 包裹没去掉，export 会非法');
  process.exit(1);
}
write(path.join(WEB, 'core.js'), core);
console.log('✓ web/core.js');

/* ---------- 3. style.css：原样复制 ---------- */
fs.copyFileSync(path.join(PUB, 'style.css'), path.join(WEB, 'style.css'));
console.log('✓ web/style.css');

/* ---------- 4. index.html：改 script 引入方式 ---------- */
let html = read(path.join(PUB, 'index.html'));
html = html.replace(
  /<script src="core\.js\?v=\d+"><\/script>\s*<script src="store\.js\?v=\d+"><\/script>\s*<script src="app\.js\?v=\d+"><\/script>/,
  '<script src="sql-wasm.js"></script>\n<script type="module" src="app.js"></script>'
);
html = html.replace(/<link rel="stylesheet" href="style\.css\?v=\d+">/, '<link rel="stylesheet" href="style.css">');
write(path.join(WEB, 'index.html'), html);
console.log('✓ web/index.html');

/* ---------- 5. 校验 ---------- */
const checks = [
  ['app.js', (s) => s.includes("from './store-native.js'") && s.includes('checkBackupConsistency(data)')],
  ['core.js', (s) =>
    s.includes('export {') && s.includes('normBackup') &&
    !s.includes('(function () {') &&          // IIFE 必须已去掉
    !s.includes('module.exports')],            // 不能残留 CommonJS
  ['index.html', (s) => s.includes('sql-wasm.js') && s.includes('type="module"')],
];
let bad = 0;
for (const [f, fn] of checks) {
  const s = read(path.join(WEB, f));
  const ok = fn(s);
  if (!ok) { console.error(`✗ web/${f} 校验不通过`); bad++; }
  else console.log(`✓ web/${f} 校验通过`);
}
console.log(bad ? `\n${bad} 项未通过` : '\n全部同步完成');
process.exit(bad ? 1 : 0);

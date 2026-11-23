# 会员积分记录

参考设计图实现的移动端风格会员积分管理页面，数据使用 **SQLite** 本地存储。

同一套 UI / 业务逻辑，三种运行形态：

| 形态 | 命令 | 说明 |
|---|---|---|
| **服务端版** | `node server.js` | Node + `node:sqlite`，浏览器访问 http://localhost:5178 |
| **纯前端版** | `node serve-web.js` | 数据存浏览器 localStorage（sql.js），http://localhost:5179 |
| **iOS / Android App** | 见 [IOS-打包说明.md](./IOS-打包说明.md) | Capacitor 原生壳，数据存 App 内真实 `.sqlite` 文件 |

> **不需要 Mac 也能出包**：GitHub Actions 已配置 macOS runner 自动编译，
> 见 [CI-打包说明.md](./CI-打包说明.md)。Release 里的 `.ipa` 可直接下载。

## 快速开始

```bash
cd member-points
node server.js
```

浏览器打开 http://localhost:5178

> 需要 Node.js 22.5+（内置 `node:sqlite`）。数据库文件自动创建在 `data/points.db`。

## 积分规则

**消费 10 元 = 1 积分，支持小数积分**。
例：消费 11 元 → 1.1 积分；消费 128.5 元 → 12.85 积分。

积分内部以「0.1 分」为单位的整数存储（`toUnits`/`fromUnits`），杜绝浮点累积误差。
除消费自动换算外，还可在会员详情页**手动加/减积分**（支持小数），用于活动赠送、积分兑换等场景。

> 三种形态的表结构与积分规则完全一致，服务端与浏览器端各自算各自的积分，规则以 `server.js` 的 `POINTS_PER_YUAN` 与 `web/db.js` 的同名常量为准。

## 页面结构

| 页面 | 功能 |
|---|---|
| **会员** | 三个统计卡（会员数 / 消费总额 / 积分合计）、三个快捷入口、搜索（姓名/手机/卡号）、排序（最近加入 / 开卡时间 / 积分最多 / 消费最多 / 卡号 / 姓名）、等级徽章 |
| **会员详情** | Hero 大数字卡 + 等级 + 升级进度条、累计消费（默认隐藏可点开）、记消费、积分增减调整、交易流水、生成客户积分卡（4 档等级主题，可截图发客户）、删除会员 |
| **记消费** | 搜索并选择会员 → 输入消费金额 → 实时预览可得积分 → 确认后写入流水并累加会员积分 |
| **流水** | 按日期分组 + 汇总条（笔数/消费额/积分变动）、类型筛选（全部/消费/积分）、会员筛选、关键词搜索、分页加载；数据备份（导出 json / 生成备份码）、还原、清空 |

**会员等级**：按累计消费自动分档 —— 普通（0+）/ 银卡（1000+）/ 金卡（2000+）/ 钻石（3000+）。

## 目录结构

```
member-points/
├── server.js           # HTTP 服务 + SQLite 数据层 + REST API
├── serve-web.js        # 纯前端版本地预览服务
├── data/points.db      # SQLite 数据库（自动创建，WAL 模式）
├── public/             # 服务端版前端
│   ├── index.html
│   ├── style.css
│   └── app.js
├── web/                # App / 纯前端版（Capacitor 的 webDir）
│   ├── index.html
│   ├── style.css
│   ├── app.js          # 通用前端逻辑
│   ├── db.js           # 浏览器端 SQLite（sql.js WASM）
│   ├── storage.js      # 持久化：原生用 Filesystem 插件，浏览器用 localStorage
│   ├── sql-wasm.js     # sql.js 运行时
│   └── sql-wasm.wasm
├── ios/                # Capacitor iOS 原生工程（npx cap add ios）
│   └── App/App/Assets.xcassets/   # App 图标 + 启动图
├── ios-assets/         # 图标源文件
├── build-ios.sh        # macOS 一键构建 .ipa
├── capacitor.config.json
├── .github/workflows/build-ios.yml   # GitHub Actions 自动构建
├── IOS-打包说明.md
└── CI-打包说明.md
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats` | 统计：会员数 / 消费总额 / 积分合计 |
| GET | `/api/members?q=&sort=` | 会员列表（q 搜索，sort = recent\|points\|spend） |
| POST | `/api/members` | 新增会员 `{name, phone, cardNo}` |
| PATCH | `/api/members/:id` | 修改会员 |
| DELETE | `/api/members/:id` | 删除会员及其流水 |
| POST | `/api/members/:id/consume` | 记消费 `{amount}` → 自动换算积分 |
| GET | `/api/transactions` | 全部流水 |
| GET | `/api/backup` | 导出完整备份（json） |
| POST | `/api/restore` | 从备份还原（覆盖当前数据） |
| DELETE | `/api/all` | 清空所有数据 |

## 数据表

```sql
members(id, name, phone, card_no, points, total_spend, created_at)
transactions(id, member_id, amount, points, note, created_at)
```

积分在服务端计算并写库，前端只做预览，避免数据不一致。

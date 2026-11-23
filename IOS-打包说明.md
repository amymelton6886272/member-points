# 打包成 iOS App（.ipa）

## 结论先说

**能，但最终 `.ipa` 必须在 macOS 上用 Xcode 生成** —— Apple 的代码签名工具链（`codesign`、`xcodebuild`、 provisioning profile）只在 macOS 提供，Windows 上无论用什么工具都产不出可被 iPhone 安装的 ipa。

不过**本仓库已经准备好了 iOS 原生工程**，在 Mac 上只需要几条命令，不用写任何 Swift/Objective-C 代码。

## 已完成的准备工作（Windows 上就能做完）

| 内容 | 位置 |
|---|---|
| Capacitor iOS 原生工程 | `ios/` 目录（`npx cap add ios` 生成，含完整 Xcode 项目） |
| 应用内 SQLite 数据层 | `web/db.js`（sql.js WASM，表结构与后端版完全一致） |
| iOS 原生文件持久化 | `web/storage.js`（Documents 目录下真实 `.sqlite` 文件） |
| App 图标 1024×1024 | `ios/App/App/Assets.xcassets/AppIcon.appiconset/` |
| 启动画面 3 档尺寸 | `ios/App/App/Assets.xcassets/Splash.imageset/` |
| 打包脚本 | `build-ios.sh` |

`npx cap sync ios` 已执行过，`ios/App/App/public/` 里是最新前端代码。

## 为什么用 sql.js 而不是 node:sqlite

iOS 的 WKWebView 跑不了 Node 原生模块，所以 `server.js` 里那套 `node:sqlite` 不能直接搬过去。

改造思路：**把 SQLite 从「服务端」搬到「浏览器端」**——
- sql.js 是 SQLite 的 WebAssembly 版本，SQL 语法、文件格式与原生 SQLite 完全一致
- 数据表结构、积分规则（10 元 = 1 分）**一字未改**
- iOS 上通过 Capacitor Filesystem 插件把 `.sqlite` 文件真实写进 App 的 Documents 目录，可通过「文件」App 访问、可用 iTunes/Finder 备份
- 纯浏览器环境自动降级到 localStorage，两套环境代码同一份

## 在 Mac 上打包

### 0. 环境要求
- macOS（建议 14+）
- Xcode 15+（App Store 版即可）：`xcode-select --install`
- Apple ID（免费账号也能打，只是每 7 天需重签）

### 1. 把项目传到 Mac

```bash
# 在 Mac 上
cd ~/Downloads
unzip member-points.zip      # 或 git clone
cd member-points
```

### 2. 一键构建

```bash
chmod +x build-ios.sh
./build-ios.sh
```

产物在 `ios/App/build/ipa/`。

### 3. 手动构建（推荐，可视化配置签名）

```bash
npm install
npx cap sync ios
npx cap open ios      # 打开 Xcode
```

在 Xcode 里：
1. 左侧点 `App` 项目 → `Signing & Capabilities`
2. `Team` 选你的 Apple ID（`Team → Add an Account…` 登录）
3. `Bundle Identifier` 改成你自己的（默认 `com.workbuddy.memberpoints` 可能已被占用）
4. 选 iPhone 模拟器或真机，⌘R 直接跑
5. 设备用数据线连上 Mac，点 Xcode 顶部设备名 → `Product → Archive`
6. Archive 完成后弹窗里点 `Distribute App`
   - **自己手机上用** → `Development` + `Ad Hoc`（或 `Development` 直接连 Mac 调试）
   - **给别人装** → `Ad Hoc` → 选你的设备列表
   - **App Store 上架** → `App Store Connect`
7. 导出后得到 `.ipa`

### 4. 装到 iPhone

- **Ad Hoc / Development**：把 `.ipa` 传到 iPhone（AirDrop / 微信 / iCloud），用「文件」App 点开安装。首次需在 `设置 → 通用 → VPN与设备管理` 里信任你的开发者证书
- **App Store**：上传到 App Store Connect，走 TestFlight 或正式审核

## 常见问题

**Q：每次装都要重签？**
免费 Apple ID 签的 App 有效期 7 天，过期需重新连 Mac 跑一次 `npx cap open ios` → ⌘R。付费开发者账号（99$/年）签的 Ad Hoc 包有效期 1 年。

**Q：能用个人免费账号直接给自己装吗？**
可以，但要每 7 天重签一次。设备数量上限：免费 3 台/年，付费 100 台/年。

**Q：模拟器上能跑吗？**
能，`npx cap open ios` 后选 iPhone 模拟器即可。数据存在模拟器沙盒里，与真机不通。

**Q：WASM 在 iOS 上会不会出问题？**
已处理：不用 `locateFile` 让 sql.js 自己去 fetch wasm，而是先 `fetch` 拿字节再通过 `wasmBinary` 注入，绕开 WKWebView 在 `capacitor://` 自定义 scheme 下编译 wasm 的 MIME 限制。

**Q：Android 呢？**
`npx cap add android` 已经装好了依赖，Android 工程可直接生成，签名同理。

## 不想编译 App 的替代方案

如果只是自己手机上用、不需要原生 App，还有两条路：

1. **PWA**：把 `web/` 目录部署到任意静态服务器，手机 Safari 打开后「添加到主屏幕」，即可获得接近原生 App 的体验（含图标、全屏、数据存本地）
2. **局域网访问**：本机跑 `node serve-web.js`，手机连同一 WiFi 访问 `http://电脑IP:5179`

两条路都不需要 Mac，缺点是没有原生分享/文件系统集成（备份文件下载体验略差）。

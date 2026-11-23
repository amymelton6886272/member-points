# GitHub Actions 自动构建 iOS 包

不用本地 Mac，GitHub 的 macOS runner 可以直接把工程编译成 `.ipa`。

## 工作流位置

`.github/workflows/build-ios.yml`

**触发条件**
- `push` 到 `main` → 自动构建 unsigned 包
- `push` 打 `v*` tag → 构建并发布到 Release
- `pull_request` → 构建验证
- 手动触发（`workflow_dispatch`）→ 可选构建类型

## 三种构建类型

| 类型 | 说明 | 需要证书 |
|---|---|---|
| **unsigned** | 默认。编译产物未签名，**不能直接装到 iPhone**，用于验证工程可编译 | 否 |
| **adhoc** | Ad Hoc 签名包，**可装到指定设备** | 是 |
| **appstore** | App Store 上架包 | 是（+ App Store Connect 密钥） |

手动触发时选择方式：**Actions → 构建 iOS App → Run workflow → Build type**

## 产物位置

1. **Actions 运行页的 Artifacts**（保留 90 天）
   下载 `会员积分-ipa` artifact，解压后得到 `member-points-unsigned.ipa`
2. **Release 附件**（打 `v*` tag 时）
   https://github.com/amymelton6886272/member-points/releases

## 配置签名（装真机需要）

要生成能直接安装的包，需要配置以下 **Repository Secrets**
（仓库 → Settings → Secrets and variables → Actions → New repository secret）：

| Secret 名 | 内容 | 怎么获取 |
|---|---|---|
| `APPLE_CERT_P12` | `.p12` 证书文件的 **base64** | `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERT_PASSWORD` | 导出 p12 时设的密码 | 导出时自己设 |
| `APPLE_SIGNING_IDENTITY` | 如 `Apple Development: 你的名字 (XXXX)` | `security find-identity -v -p codesigning` |
| `PROVISIONING_PROFILE` | `.mobileprovision` 的 **base64** | `base64 -i profile.mobileprovision \| pbcopy` |
| `APPLE_TEAM_ID` | 10 位团队 ID | Developer 页面 |

### 生成 p12 证书

```bash
# 从钥匙串导出（先在 Xcode 里登录 Apple ID 并创建证书）
security find-identity -v -p codesigning
# 找到 "Apple Development: xxx (ABC123)" 的 SHA1

# 导出为 p12
security export -k "~/Library/Keychains/login.keychain-db" \
  -t certs -f p12 -o cert.p12 \
  -T /usr/bin/codesign -T /usr/bin/security
# 回车后输入钥匙串密码 → 再设一个 p12 密码

base64 -i cert.p12 | pbcopy   # 复制到剪贴板，粘贴进 APPLE_CERT_P12
```

### 生成描述文件

1. Apple Developer → Certificates, Identifiers & Profiles → Profiles → 新建
2. 选 **Ad Hoc**，选你的设备和 App ID（`com.workbuddy.memberpoints`）
3. 下载 `.mobileprovision`，base64 后存进 `PROVISIONING_PROFILE`

配好后手动触发 workflow 选 **adhoc**，产物即可安装。

### 上架 App Store 还需

额外配置 `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_PRIVATE_KEY`（App Store Connect → 用户和访问 → 密钥）。

## 安装到 iPhone

1. AirDrop / 微信 / iCloud 把 `.ipa` 传到手机
2. 「文件」App 点开安装
3. 首次需 `设置 → 通用 → VPN与设备管理` 里信任开发者证书

> **免费 Apple ID 签名有效期 7 天**，过期需重新构建。
> 付费开发者账号（99$/年）签的包有效期 1 年。

## CI 环境信息（实测）

- Runner：`macos-26-arm64`，Xcode 26.6.0
- 完整编译耗时约 90 秒（首次含 SPM 依赖解析会久一些）
- 产物大小约 2.5 MB

## 踩过的坑（已在 workflow 中修复）

1. **硬编码 Xcode 路径** → `macos-latest` 镜像版本会变，改用 `maxim-lobanov/setup-xcode`
2. **`cap sync --verbose`** → Capacitor 8 不支持该参数，直接报 `unknown option` 并失败
3. **打包时 `cd` 导致相对路径错乱** → `cd build/ipa` 后 `cd ..` 基准变了，`rm`/`ls` 找错目录，一律改用绝对路径
4. **无证书时 `-exportArchive` 会失败** → 改为直接从 `.xcarchive` 取 `.app` 按 `Payload/` 结构用 Python 打包
5. **Release 403** → 仓库默认 `GITHUB_TOKEN` 无 `contents: write`，需在 job 里显式声明
6. **中文文件名被吃掉** → Release 附件名用 ASCII（`member-points-unsigned.ipa`）

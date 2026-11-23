#!/usr/bin/env bash
# ============================================================
#  在 macOS 上构建 iOS .ipa
#  用法：  ./build-ios.sh
#  产物：  ios/build/会员积分.ipa
#
#  前置条件：
#   1. macOS + Xcode（App Store 或 Developer 版）+ 命令行工具
#   2. 已配置好签名（见下方「签名说明」）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "==> 1/5 安装依赖"
npm install

echo "==> 2/5 同步 Web 资源到 iOS 工程"
npx cap sync ios

echo "==> 3/5 打开 Xcode 工程"
echo "    如需手动操作：npx cap open ios"

SCHEME="App"
CONFIG="Release"
TEAM_ID="${TEAM_ID:-}"          # 你的 Apple Developer Team ID
WORKSPACE="ios/App/App.xcworkspace"
PROJECT="ios/App/App.xcodeproj"

if [ -z "$TEAM_ID" ]; then
  echo "    未设置 TEAM_ID，请在 Xcode 里手动选择签名团队并 Archive。"
fi

echo "==> 4/5 Archive"
cd ios/App
if [ -n "$TEAM_ID" ]; then
  xcodebuild \
    -workspace App.xcworkspace \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -archivePath "$PWD/build/会员积分.xcarchive" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    build archive
else
  xcodebuild \
    -workspace App.xcworkspace \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -archivePath "$PWD/build/会员积分.xcarchive" \
    build archive
fi

echo "==> 5/5 导出 .ipa"
# ExportOptions.plist 需要按自己的证书类型调整
# 个人证书(development) 用 method: development + signingStyle: manual
# 企业证书用 method: enterprise
# App Store 上架用 method: app-store
EXPORT_PLIST="$PWD/build/ExportOptions.plist"
cat > "$EXPORT_PLIST" <<'PLIST'
{
  "method": "development",
  "teamID": "TEAMIDHERE",
  "signingStyle": "manual",
  "debuggingSymbols": false
}
PLIST

xcodebuild \
  -exportArchive \
  -archivePath "$PWD/build/会员积分.xcarchive" \
  -exportPath "$PWD/build/ipa" \
  -exportOptionsPlist "$EXPORT_PLIST"

echo ""
echo "✅ 构建完成：ios/App/build/ipa/"
ls -la "$PWD/build/ipa"

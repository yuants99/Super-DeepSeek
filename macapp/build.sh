#!/bin/sh
# 构建一个自包含的 macOS App：内置静态网页 + WKWebView。
# 用法：./build.sh
set -eu
cd "$(dirname "$0")"

APP="build/Super DeepSeek.app"
WEB_SRC="../chat-demo/dist"

if [ ! -f "$WEB_SRC/index.html" ]; then
  echo "缺少网页构建物：$WEB_SRC" >&2
  echo "请先在 chat-demo 里执行 pnpm build" >&2
  exit 1
fi

rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp Info.plist "$APP/Contents/Info.plist"
cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

if [ ! -f AppIcon.icns ]; then
  echo "== 生成图标"
  rm -rf icon.iconset
  swift make_icon.swift icon.iconset >/dev/null
  iconutil -c icns icon.iconset -o AppIcon.icns
  rm -rf icon.iconset
fi

echo "== 编译"
swiftc -O -swift-version 5 -parse-as-library -target arm64-apple-macos12.0 App.swift NativeMenu.swift \
  -o "$APP/Contents/MacOS/DeepSeekChat" \
  -framework AppKit -framework WebKit

echo "== 嵌入网页"
cp -R "$WEB_SRC" "$APP/Contents/Resources/web"

echo "== 签名（ad-hoc）"
codesign --force --sign - "$APP"

echo "== 完成：$APP"
du -sh "$APP"

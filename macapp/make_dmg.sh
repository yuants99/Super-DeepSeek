#!/bin/sh
# 打包 DMG（需要先执行 ./build.sh 产出 App）
set -eu
cd "$(dirname "$0")"

APP="build/Super DeepSeek.app"
OUT="build/Super DeepSeek 4.8.dmg"

if [ ! -d "$APP" ]; then
  echo "缺少 App：$APP，请先运行 ./build.sh" >&2
  exit 1
fi

echo "== 生成安装窗口背景"
swift make_dmg_bg.swift dmg-background.png 1 >/dev/null
swift make_dmg_bg.swift dmg-background@2x.png 2 >/dev/null

echo "== 打包 DMG"
rm -f "$OUT"
python3 -m dmgbuild -s dmg-settings.py "Super DeepSeek" "$OUT"

echo "== 完成：$OUT"
du -h "$OUT"

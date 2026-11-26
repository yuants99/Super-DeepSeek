#!/bin/sh
# 全量审计 + 合并 + 独立复核。用法：./tools/run.sh [local.zip] [online.zip] [输出目录]
set -eu
cd "$(dirname "$0")/.."

LOCAL="${1:-$PWD/deepseek_data-2026-11-24.zip}"
ONLINE="${2:-$PWD/deepseekonline_data-2026-11-24.zip}"
OUT="${3:-$PWD/audit-out}"

if [ ! -f "$LOCAL" ] || [ ! -f "$ONLINE" ]; then
  echo "缺少原始导出包：$LOCAL / $ONLINE" >&2
  echo "当前只保留了 $PWD/deepseek_merged-2026-11-24.zip。" >&2
  echo "单包校验：python3 tools/verify_import.py deepseek_merged-2026-11-24.zip" >&2
  exit 1
fi

echo "== 编译 dsaudit"
swiftc -O -swift-version 5 \
  tools/Zip.swift tools/Schema.swift tools/Audit.swift tools/Diff.swift \
  tools/Merge.swift tools/Main.swift \
  -o tools/dsaudit

echo "== 审计"
./tools/dsaudit "${1:-$PWD/deepseek_data-2026-11-24.zip}" \
                "${2:-$PWD/deepseekonline_data-2026-11-24.zip}" \
                "${3:-$PWD/audit-out}"

echo
echo "== 产物"
ls -lh "$OUT"

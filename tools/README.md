# dsaudit —— DeepSeek 会话导出审计 / 合并工具

对 DeepSeek 历史会话导出包（chat-demo `export_format_version: 3`）做**全量**结构校验、跨包比对与合并。
核心实现为 Swift（自解析 ZIP32、原生 CRC32/SHA256、ImageIO 读图），另有 Python 独立复核脚本。

## 用法

```sh
./tools/run.sh                 # 默认读取工作区两个 zip，输出到 audit-out/
./tools/run.sh a.zip b.zip out # 指定 local / online / 输出目录
```

产物：

- `audit-out/审计报告.md`：结论、来源判定、完整性、差异、有损明细、合并结果、独立复核
- `audit-out/deepseek_merged-2026-11-24.zip`：合并包（可直接导入 chat-demo）
- `audit-out/summary.json`：机器可读摘要

## 检查内容

| 层 | 检查 |
| --- | --- |
| ZIP | EOCD / 中央目录、ZIP64/加密/分卷、条目重名、路径穿越、NFC、逐条目解压 + CRC32 |
| 容器 | manifest 必须首个条目、版本 = 3、条目位置（会话不得在 index 之后） |
| 索引 | index 与会话一一对应、id 唯一、`message_count` 与实际一致、标题/时间一致 |
| 会话 | 字段类型严格校验（与 `schema.ts` 等价）、时间按日历校验 |
| 消息树 | 父 id 更小、父存在、角色交替、根为 USER、`current_message_id` 可达、无重复 id |
| 片段 | 逐类型校验；按 `toLocal.ts` 规则标记“Demo 会保留 / 会丢弃 / 非法” |
| 附件 | `export_path` 归属目录、存在性、命名规则、声明大小/宽高与实际、孤儿图片 |
| 跨包 | 按树路径对齐（不看 id）、内容哈希、元数据差异、片段丢失、图片逐字节哈希 |

## 关键设计

- **不按消息 id 比对**：chat-demo 导出会把消息按父节点优先重编号为 1…n，两个包的 id 不可直接对应；
  因此用“从根出发的子节点索引路径”对齐。
- **内容哈希 = Demo 视角**：`coreHash` 只包含 Demo 导入后会保留、且跨包稳定的内容；
  排除 `CONTENT_RISK`/`TIP`/`PARTIAL_FILE_READ`/`TOOL_IMAGE_SEARCH`、无链接 `TOOL_OPEN`、空 `READ_LINK`、
  空 `REQUEST`、`stage_id`/`group_id`、`READ_LINK.signature`（服务端按次签发）、时间毫秒归一化。
- **合并策略**：以保真度更高的包为母本，按树路径挂接另一包独有的消息，新 id 从该会话最大值续号，
  其余条目逐字节复制；索引重建，图片取两包并集。
- 内存：逐条目解压、逐会话解析，不缓存正文；两个 ZIP 以字节数组常驻（约 270 MB）。

## 源文件

| 文件 | 职责 |
| --- | --- |
| `Zip.swift` | ZIP32 读取（STORE/DEFLATE）、CRC32、ZIP 写入 |
| `Schema.swift` | 字段校验、片段规范化、时间校验 |
| `Audit.swift` | 归档扫描、会话解析、消息树、附件核对 |
| `Diff.swift` | 跨包路径对齐与差异分类 |
| `Merge.swift` | 合并包生成 |
| `Main.swift` | 流程编排与报告生成 |
| `verify_import.py` | 独立实现：模拟 chat-demo 导入规则做交叉验证 |

## 当前状态（2026-11-24 清理后）

原始两份导出（`deepseek_data-*.zip`、`deepseekonline_data-*.zip`）与解压目录已在合并校验通过后删除，
工作区只保留一个包：`deepseek_merged-2026-11-24.zip`（817 会话 / 8,124 消息 / 277 图片）。

- 单包校验：`python3 tools/verify_import.py deepseek_merged-2026-11-24.zip`
- `./tools/run.sh` 需要 local / online 两份原始导出才能重跑“比对 + 合并”，缺包时会直接提示退出。

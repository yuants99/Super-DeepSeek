import type { Message } from './chat/types.js'

/**
 * 本地 Token 估算。DeepSeek 官方给出的换算：1 个中文字符 ≈ 0.6 token，1 个英文字符 ≈ 0.3 token；
 * 这里按字符类型累加，并以服务端 usage 为准做校准，仅用于上下文进度与压缩决策。
 */
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/

const IMAGE_TOKENS = 1024
const MESSAGE_OVERHEAD = 6

/** 结果缓存：同一段文本长度不变时直接复用，避免在渲染/滚动时反复扫描大段文本。 */
const textCache = new Map<string, number>()
const CACHE_LIMIT = 4000

export const estimateTextTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  const key = `${text.length}:${text.slice(0, 24)}:${text.slice(-24)}`
  const cached = textCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (CJK.test(char)) {
      cjk += 1
    } else {
      other += 1
    }
  }
  const tokens = Math.ceil(cjk * 0.6 + other * 0.3)
  if (textCache.size >= CACHE_LIMIT) {
    textCache.clear()
  }
  textCache.set(key, tokens)
  return tokens
}

export const estimateMessageTokens = (message: Message): number => {
  if (message.role === 'user') {
    const files = message.files.reduce(
      (total, file) => total + (file.isImage ? IMAGE_TOKENS : 256),
      0
    )
    return estimateTextTokens(message.content) + files + MESSAGE_OVERHEAD
  }
  const text = message.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
  return estimateTextTokens(text) + MESSAGE_OVERHEAD
}

export const estimatePathTokens = (messages: readonly Message[]): number =>
  messages.reduce((total, message) => total + estimateMessageTokens(message), 0)

/** 上下文窗口与预留：为压缩后的摘要与下一轮输出留出余量 */
export const CONTEXT_LIMIT = 1_000_000
export const CONTEXT_RESERVE = 80_000
export const CONTEXT_BUDGET = CONTEXT_LIMIT - CONTEXT_RESERVE

export type ContextLevel = 'normal' | 'warn' | 'high' | 'critical'

/** 70/85/95% 三档告警，按“总上限减去压缩预留”的可用预算计算 */
export const contextPercentOf = (tokens: number) =>
  Math.min(100, (tokens / CONTEXT_BUDGET) * 100)

export const contextLevelOf = (percent: number): ContextLevel =>
  percent >= 95 ? 'critical' : percent >= 85 ? 'high' : percent >= 70 ? 'warn' : 'normal'

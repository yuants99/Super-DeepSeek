import type { AssistantMessage } from './chat/types.js'
import { useSettings } from './settings.js'

/**
 * 计费中心的本地用量流水。
 *
 * 只记录本机通过 API 生成的回复（消息里带 usage）；导入的历史归档不含分项用量，
 * 无法还原输入/缓存/输出的 token 拆分，因此不在此列。
 */
export type UsageRecord = {
  /** 发起请求时选中的 API Key；旧流水可能没有该字段，不计入任何 Key */
  keyId?: string
  sessionId: string
  messageId: string
  /** 请求开始时间（毫秒），用于判断高峰/空闲与归属日期 */
  at: number
  model: 'deepseek-flash' | 'deepseek-v4-pro'
  /** 未命中缓存的输入 token */
  input: number
  cacheRead: number
  cacheCreation: number
  output: number
  webSearch: number
  webFetch: number
  toolSearch: number
}

/** 工具与语音：全按官方刊例价（不含限时五折） */
export const TOOL_REQUEST_RATE = 5 / 1000
export const ASR_RATE_PER_MS = 0.78 / 3_600_000
export const TTS_RATE_PER_CHAR = 3 / 10_000
export const DOC_PAGE_RATE = 1.5 / 1000

/** TTS 计费字符：汉字算 2，其他字符算 1 */
export const ttsBillingChars = (text: string): number => {
  let count = 0
  for (const char of text) {
    count += /[\u3400-\u9fff\uf900-\ufaff]/.test(char) ? 2 : 1
  }
  return count
}

export type SpeechRecord = {
  keyId?: string
  at: number
  kind: 'asr' | 'tts'
  /** ASR 毫秒，TTS 计费字符 */
  units: number
}

const SPEECH_KEY = 'chat-demo:speech-usage'
const MAX_SPEECH = 5000

const readSpeech = (): SpeechRecord[] => {
  try {
    const raw = localStorage.getItem(SPEECH_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is SpeechRecord => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const record = item as Record<string, unknown>
      return (
        (record.kind === 'asr' || record.kind === 'tts') &&
        typeof record.at === 'number' &&
        typeof record.units === 'number'
      )
    })
  } catch {
    return []
  }
}

export const recordSpeechUsage = (kind: SpeechRecord['kind'], units: number) => {
  if (units <= 0) {
    return
  }
  const records = readSpeech()
  records.push({
    at: Date.now(),
    kind,
    units,
    keyId: useSettings.getState().activeKeyId ?? undefined,
  })
  try {
    localStorage.setItem(SPEECH_KEY, JSON.stringify(records.slice(-MAX_SPEECH)))
  } catch {
    // 存储不可用时只影响计费展示
  }
}

export const getSpeechRecords = (): SpeechRecord[] => readSpeech()

export const clearSpeechRecords = (keyId?: string | null) => {
  try {
    if (!keyId) {
      localStorage.removeItem('chat-demo:speech-usage')
      return
    }
    const kept = readSpeech().filter((record) => record.keyId !== keyId)
    localStorage.setItem('chat-demo:speech-usage', JSON.stringify(kept))
  } catch {
    // 忽略存储异常
  }
}

export type SpeechSummary = {
  asrMs: number
  ttsChars: number
  asrCost: number
  ttsCost: number
  cost: number
}

export const summarizeSpeech = (records: SpeechRecord[]): SpeechSummary => {
  let asrMs = 0
  let ttsChars = 0
  for (const record of records) {
    if (record.kind === 'asr') {
      asrMs += record.units
    } else {
      ttsChars += record.units
    }
  }
  const asrCost = asrMs * ASR_RATE_PER_MS
  const ttsCost = ttsChars * TTS_RATE_PER_CHAR
  return { asrMs, ttsChars, asrCost, ttsCost, cost: asrCost + ttsCost }
}

/** 官方价格（人民币 / 百万 tokens），空闲价为高峰的一半。 */
export type ModelRate = { cacheHit: number; cacheMiss: number; output: number }

export const MODEL_RATES: Record<UsageRecord['model'], ModelRate> = {
  'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

const STORAGE_KEY = 'chat-demo:usage-log'
const MAX_RECORDS = 20000

const readLog = (): UsageRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is UsageRecord => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const record = item as Record<string, unknown>
      return (
        typeof record.sessionId === 'string' &&
        typeof record.messageId === 'string' &&
        typeof record.at === 'number' &&
        (record.model === 'deepseek-flash' || record.model === 'deepseek-v4-pro')
      )
    })
  } catch {
    return []
  }
}

const writeLog = (records: UsageRecord[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)))
  } catch {
    // 存储不可用时只影响计费展示
  }
}

/** 回复结束时写入/更新一条流水；续写会覆盖同一条消息的旧用量。 */
export const recordUsage = (sessionId: string, message: AssistantMessage) => {
  const usage = message.usage
  if (!usage) {
    return
  }
  const total =
    usage.input_tokens +
    usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens +
    usage.output_tokens
  if (total <= 0) {
    return
  }
  const record: UsageRecord = {
    keyId: useSettings.getState().activeKeyId ?? undefined,
    sessionId,
    messageId: message.id,
    at: message.createdAt,
    model: message.model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash',
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheCreation: usage.cache_creation_input_tokens,
    output: usage.output_tokens,
    webSearch: usage.server_tool_use?.web_search_requests ?? 0,
    webFetch:
      (usage.server_tool_use?.web_fetch_requests ?? 0) + (usage.server_tool_use?.tool_fetch ?? 0),
    toolSearch: usage.server_tool_use?.tool_search ?? 0,
  }
  const records = readLog()
  const index = records.findIndex(
    (item) => item.sessionId === sessionId && item.messageId === message.id
  )
  if (index >= 0) {
    records[index] = record
  } else {
    records.push(record)
  }
  writeLog(records)
}

export const getUsageRecords = (): UsageRecord[] => readLog()

export const clearUsageRecords = (keyId?: string | null) => {
  if (!keyId) {
    writeLog([])
    return
  }
  writeLog(readLog().filter((record) => record.keyId !== keyId))
}

const shanghaiDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const dayKeyOf = (at: number): string => shanghaiDay.format(new Date(at))

const shanghaiClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
})

/** 北京时间周一至周五 9:00–12:00、14:00–18:00 为高峰；其余（含周末）为空闲。 */
export const isPeak = (at: number): boolean => {
  const parts = shanghaiClock.formatToParts(new Date(at))
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const workday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)
  return workday && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
}

/** 单条流水的费用（元）；cache_creation 按缓存未命中计。 */
export const recordCost = (record: UsageRecord): number => {
  const rate = MODEL_RATES[record.model]
  const factor = isPeak(record.at) ? 2 : 1
  const miss = record.input + record.cacheCreation
  return ((record.cacheRead * rate.cacheHit + miss * rate.cacheMiss + record.output * rate.output) * factor) / 1_000_000
}

export type DailyUsage = {
  key: string
  label: string
  cacheHit: number
  cacheMiss: number
  output: number
  tokens: number
  cost: number
  peakCost: number
  offPeakCost: number
  requests: number
}

/** 最近 days 天（含今天）的逐日汇总，按时间升序。 */
export const aggregateByDay = (records: UsageRecord[], days: number): DailyUsage[] => {
  const now = Date.now()
  const buckets = new Map<string, DailyUsage>()
  const order: string[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const at = now - offset * 86_400_000
    const key = shanghaiDay.format(new Date(at))
    order.push(key)
    buckets.set(key, {
      key,
      label: key.slice(5),
      cacheHit: 0,
      cacheMiss: 0,
      output: 0,
      tokens: 0,
      cost: 0,
      peakCost: 0,
      offPeakCost: 0,
      requests: 0,
    })
  }
  for (const record of records) {
    const key = shanghaiDay.format(new Date(record.at))
    const bucket = buckets.get(key)
    if (!bucket) {
      continue
    }
    const cost = recordCost(record)
    bucket.cacheHit += record.cacheRead
    bucket.cacheMiss += record.input + record.cacheCreation
    bucket.output += record.output
    bucket.tokens += record.cacheRead + record.input + record.cacheCreation + record.output
    bucket.cost += cost
    if (isPeak(record.at)) {
      bucket.peakCost += cost
    } else {
      bucket.offPeakCost += cost
    }
    bucket.requests += 1
  }
  return order.flatMap((key) => {
    const bucket = buckets.get(key)
    return bucket ? [bucket] : []
  })
}

export type UsageSummary = {
  cost: number
  tokens: number
  cacheHit: number
  cacheMiss: number
  output: number
  requests: number
  peakCost: number
  offPeakCost: number
  flashCost: number
  proCost: number
  webSearch: number
  webFetch: number
  toolSearch: number
  toolCost: number
}

export const summarize = (records: UsageRecord[]): UsageSummary => {
  const summary: UsageSummary = {
    cost: 0,
    tokens: 0,
    cacheHit: 0,
    cacheMiss: 0,
    output: 0,
    requests: 0,
    peakCost: 0,
    offPeakCost: 0,
    flashCost: 0,
    proCost: 0,
    webSearch: 0,
    webFetch: 0,
    toolSearch: 0,
    toolCost: 0,
  }
  for (const record of records) {
    const cost = recordCost(record)
    summary.cost += cost
    summary.tokens += record.cacheRead + record.input + record.cacheCreation + record.output
    summary.cacheHit += record.cacheRead
    summary.cacheMiss += record.input + record.cacheCreation
    summary.output += record.output
    summary.requests += 1
    if (isPeak(record.at)) {
      summary.peakCost += cost
    } else {
      summary.offPeakCost += cost
    }
    if (record.model === 'deepseek-v4-pro') {
      summary.proCost += cost
    } else {
      summary.flashCost += cost
    }
    summary.webSearch += record.webSearch
    summary.webFetch += record.webFetch
    summary.toolSearch += record.toolSearch
    summary.toolCost +=
      (record.webSearch + record.webFetch + record.toolSearch) * TOOL_REQUEST_RATE
  }
  return summary
}

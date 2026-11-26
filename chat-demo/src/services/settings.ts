import { create } from 'zustand'
import type { ChatModel, ThinkingEffort } from './api/types.js'
import type { TtsVoice } from './api/speech.js'
import { getRegionName, normalizeLocation, provinces, type UserLocation } from './location.js'
import { createId } from '../utils/id.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 系统提示词上限，同时也是每个预设的上限 */
export const SYSTEM_PROMPT_LIMIT = 500
/** 预设数量上限 */
export const PRESET_LIMIT = 5
/** 预设名称上限 */
export const PRESET_NAME_LIMIT = 20
/** 自定义 API Key 数量上限 */
export const API_KEY_LIMIT = 20
/** API Key 标签上限 */
export const API_KEY_TAG_LIMIT = 24
/** 个人称呼上限 */
export const ME_NICKNAME_LIMIT = 30
/** 个人背景上限 */
export const ME_BACKGROUND_LIMIT = 100
/** 长期记忆上限 */
export const ME_MEMORY_LIMIT = 4000

export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

export type SafetyLevel = 'low' | 'high'
export type ReminderLanguage = 'zh' | 'en'

export type ModelPreset = { id: string; name: string; text: string }

export type ApiKeyEntry = { id: string; tag: string; key: string }

export type SamplingSettings = {
  /** 打开后才会把下面的采样参数发到接口 */
  enabled: boolean
  temperature: number
  topP: number
  topK: number
  maxTokens: number
}

export type CompressionLevel = 'light' | 'balanced' | 'aggressive'

/** 配置式快照：只包含设置，不含任何对话数据 */
export type PersonalizationStyle =
  | 'default'
  | 'professional'
  | 'friendly'
  | 'direct'
  | 'imaginative'
  | 'efficient'
  | 'witty'

export type PersonalizationLevel = 1 | 2 | 3

export type Personalization = {
  enabled: boolean
  style: PersonalizationStyle
  warmth: PersonalizationLevel
  enthusiasm: PersonalizationLevel
  structure: PersonalizationLevel
  emoji: PersonalizationLevel
  custom: string
  /** 隐私模式下是否仍注入个性化 */
  applyInPrivacy: boolean
}

export type MeSettings = {
  /** 全局开关：是否将“我的”信息（称呼、背景、位置、记忆）注入前置提示词 */
  enabled: boolean
  /** 隐私模式下是否仍注入“我的”信息 */
  applyInPrivacy: boolean
  /** 个人称呼，最多 30 字符 */
  nickname: string
  /** 个人背景（职业、身份等），最多 100 字符 */
  background: string
  /** 长期记忆：大段连贯文章式文本，不可直接手工编辑 */
  memory: string
}

export type ProfileConfig = {
  locale: Locale
  welcomeMessage: string | null
  themePreference: ThemePreference
  ttsVoice: TtsVoice
  location: UserLocation | null
  thinking: boolean
  thinkingEffort: ThinkingEffort
  search: boolean
  modelSettings: ModelSettings
  apiKeys: ApiKeyEntry[]
  activeKeyId: string | null
  me?: MeSettings
}

export type ModelSettings = {
  compression: CompressionLevel
  personalization: Personalization
  model: ChatModel
  systemPrompt: string
  presets: ModelPreset[]
  safety: { enabled: boolean; level: SafetyLevel }
  sampling: SamplingSettings
  reminder: {
    /** null 表示使用当天日期 */
    date: string | null
    /** null 表示使用当天星期 */
    weekday: string | null
  }
}

export const DEFAULT_SAMPLING: SamplingSettings = {
  enabled: false,
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxTokens: 8192,
}

const DEFAULT_PERSONALIZATION: Personalization = {
  enabled: false,
  style: 'default',
  warmth: 2,
  enthusiasm: 2,
  structure: 2,
  emoji: 1,
  custom: '',
  applyInPrivacy: false,
}

const DEFAULT_ME: MeSettings = {
  enabled: true,
  applyInPrivacy: false,
  nickname: '',
  background: '',
  memory: '',
}

const defaultModelSettings = (): ModelSettings => ({
  compression: 'balanced',
  personalization: { ...DEFAULT_PERSONALIZATION },
  model: 'deepseek-flash',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  presets: [],
  safety: { enabled: false, level: 'high' },
  sampling: { ...DEFAULT_SAMPLING },
  reminder: { date: null, weekday: null },
})

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、思考/联网开关、侧边栏、模型设置、“我的” */
type Settings = {
  /** 当前生效的 Key；由 apiKeys + activeKeyId 派生，保持旧代码可直接读取 */
  apiKey: string | null
  apiKeys: ApiKeyEntry[]
  activeKeyId: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  thinkingEffort: ThinkingEffort
  search: boolean
  siderCollapsed: boolean
  /** 自定义首页欢迎语；null 使用内置文案 */
  welcomeMessage: string | null
  /** 启动时默认进入隐私模式（全局，不随配置式变化） */
  privacyDefault: boolean
  modelSettings: ModelSettings
  me: MeSettings
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  apiKeys: 'chat-demo:api-keys',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  thinkingEffort: 'chat-demo:thinking-effort',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  welcomeMessage: 'chat-demo:welcome-message',
  privacyDefault: 'chat-demo:privacy-default',
  modelSettings: 'chat-demo:model-settings',
  me: 'chat-demo:me',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialThinkingEffort = (): ThinkingEffort => {
  const saved = read(KEYS.thinkingEffort)
  return saved === 'low' || saved === 'max' ? saved : 'high'
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, parsed))
}

const sanitizeApiKeys = (raw: unknown): { keys: ApiKeyEntry[]; activeId: string | null } => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { keys: [], activeId: null }
  }
  const source = raw as Record<string, unknown>
  const keys: ApiKeyEntry[] = Array.isArray(source.keys)
    ? source.keys
        .flatMap((item): ApiKeyEntry[] => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return []
          }
          const entry = item as Record<string, unknown>
          if (typeof entry.id !== 'string' || typeof entry.key !== 'string' || !entry.key) {
            return []
          }
          return [
            {
              id: entry.id,
              tag:
                typeof entry.tag === 'string' && entry.tag.trim()
                  ? entry.tag.slice(0, API_KEY_TAG_LIMIT)
                  : 'Key',
              key: entry.key,
            },
          ]
        })
        .slice(0, API_KEY_LIMIT)
    : []
  const activeId =
    typeof source.activeId === 'string' && keys.some((entry) => entry.id === source.activeId)
      ? source.activeId
      : (keys[0]?.id ?? null)
  return { keys, activeId }
}

/** 首次启动时把旧的单个 Key 迁移成一条带标签的记录。 */
const initialApiKeys = (): { keys: ApiKeyEntry[]; activeId: string | null } => {
  try {
    const raw = read(KEYS.apiKeys)
    if (raw) {
      const parsed = sanitizeApiKeys(JSON.parse(raw))
      if (parsed.keys.length > 0) {
        return parsed
      }
    }
  } catch {
    // 回退到旧字段
  }
  const legacy = read(KEYS.apiKey)
  if (legacy) {
    const entry: ApiKeyEntry = { id: createId(), tag: '默认', key: legacy }
    return { keys: [entry], activeId: entry.id }
  }
  return { keys: [], activeId: null }
}

/** 反序列化时逐字段校验：非法值回退默认，越界值夹取到范围内。 */
const sanitizeModelSettings = (raw: unknown): ModelSettings => {
  const base = defaultModelSettings()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base
  }
  const source = raw as Record<string, unknown>

  const compression: CompressionLevel =
    source.compression === 'light' || source.compression === 'aggressive'
      ? source.compression
      : 'balanced'
  const rawPersonalization =
    source.personalization && typeof source.personalization === 'object' && !Array.isArray(source.personalization)
      ? (source.personalization as Record<string, unknown>)
      : {}
  const level = (value: unknown, fallback: PersonalizationLevel): PersonalizationLevel =>
    value === 1 || value === 3 ? value : value === 2 ? 2 : fallback
  const personalization: Personalization = {
    enabled: rawPersonalization.enabled === true,
    style: (
      ['default', 'professional', 'friendly', 'direct', 'imaginative', 'efficient', 'witty'] as const
    ).includes(rawPersonalization.style as PersonalizationStyle)
      ? (rawPersonalization.style as PersonalizationStyle)
      : 'default',
    warmth: level(rawPersonalization.warmth, 2),
    enthusiasm: level(rawPersonalization.enthusiasm, 2),
    structure: level(rawPersonalization.structure, 2),
    emoji: level(rawPersonalization.emoji, 1),
    custom:
      typeof rawPersonalization.custom === 'string'
        ? rawPersonalization.custom.slice(0, 2000)
        : '',
    applyInPrivacy: rawPersonalization.applyInPrivacy === true,
  }
  const model: ChatModel = source.model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash'
  const systemPrompt =
    typeof source.systemPrompt === 'string'
      ? source.systemPrompt.slice(0, SYSTEM_PROMPT_LIMIT)
      : base.systemPrompt

  const presets: ModelPreset[] = Array.isArray(source.presets)
    ? source.presets
        .flatMap((item): ModelPreset[] => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return []
          }
          const preset = item as Record<string, unknown>
          if (
            typeof preset.id !== 'string' ||
            typeof preset.name !== 'string' ||
            typeof preset.text !== 'string'
          ) {
            return []
          }
          return [
            {
              id: preset.id,
              name: preset.name.slice(0, PRESET_NAME_LIMIT),
              text: preset.text.slice(0, SYSTEM_PROMPT_LIMIT),
            },
          ]
        })
        .slice(0, PRESET_LIMIT)
    : []

  const safetySource =
    source.safety && typeof source.safety === 'object' && !Array.isArray(source.safety)
      ? (source.safety as Record<string, unknown>)
      : {}
  const safety: ModelSettings['safety'] = {
    enabled: safetySource.enabled === true,
    level: safetySource.level === 'low' ? 'low' : 'high',
  }

  const samplingSource =
    source.sampling && typeof source.sampling === 'object' && !Array.isArray(source.sampling)
      ? (source.sampling as Record<string, unknown>)
      : {}
  const sampling: SamplingSettings = {
    enabled: samplingSource.enabled === true,
    temperature: clampNumber(samplingSource.temperature, 0, 2, base.sampling.temperature),
    topP: clampNumber(samplingSource.topP, 0, 1, base.sampling.topP),
    topK: Math.round(clampNumber(samplingSource.topK, 0, 100, base.sampling.topK)),
    maxTokens: Math.round(clampNumber(samplingSource.maxTokens, 1, 65536, base.sampling.maxTokens)),
  }

  const reminderSource =
    source.reminder && typeof source.reminder === 'object' && !Array.isArray(source.reminder)
      ? (source.reminder as Record<string, unknown>)
      : {}
  const reminder: ModelSettings['reminder'] = {
    date: typeof reminderSource.date === 'string' ? reminderSource.date.slice(0, 40) : null,
    weekday: typeof reminderSource.weekday === 'string' ? reminderSource.weekday.slice(0, 40) : null,
  }

  return { compression, personalization, model, systemPrompt, presets, safety, sampling, reminder }
}

const initialModelSettings = (): ModelSettings => {
  try {
    return sanitizeModelSettings(JSON.parse(read(KEYS.modelSettings) ?? 'null'))
  } catch {
    return defaultModelSettings()
  }
}

export const sanitizeMeSettings = (raw: unknown): MeSettings => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_ME }
  }
  const source = raw as Record<string, unknown>
  return {
    enabled: source.enabled !== false,
    applyInPrivacy: source.applyInPrivacy === true,
    nickname: typeof source.nickname === 'string' ? source.nickname.slice(0, ME_NICKNAME_LIMIT) : '',
    background:
      typeof source.background === 'string' ? source.background.slice(0, ME_BACKGROUND_LIMIT) : '',
    memory: typeof source.memory === 'string' ? source.memory.slice(0, ME_MEMORY_LIMIT) : '',
  }
}

const initialMeSettings = (): MeSettings => {
  try {
    return sanitizeMeSettings(JSON.parse(read(KEYS.me) ?? 'null'))
  } catch {
    return { ...DEFAULT_ME }
  }
}

const initialKeys = initialApiKeys()
const initialActiveKey = initialKeys.keys.find((entry) => entry.id === initialKeys.activeId) ?? null

export const useSettings = create<Settings>(() => ({
  apiKey: initialActiveKey?.key ?? null,
  apiKeys: initialKeys.keys,
  activeKeyId: initialActiveKey?.id ?? null,
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  thinkingEffort: initialThinkingEffort(),
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  welcomeMessage: read(KEYS.welcomeMessage)?.slice(0, 160) || null,
  privacyDefault: read(KEYS.privacyDefault) === 'true',
  modelSettings: initialModelSettings(),
  me: initialMeSettings(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setThinkingEffort = (thinkingEffort: ThinkingEffort) => {
  write(KEYS.thinkingEffort, thinkingEffort)
  useSettings.setState({ thinkingEffort })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setWelcomeMessage = (text: string | null) => {
  const value = text?.trim().slice(0, 160) || null
  write(KEYS.welcomeMessage, value)
  useSettings.setState({ welcomeMessage: value })
}

export const setPrivacyDefault = (privacyDefault: boolean) => {
  write(KEYS.privacyDefault, String(privacyDefault))
  useSettings.setState({ privacyDefault })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

// ---------- API Key ----------

const persistKeys = (keys: ApiKeyEntry[], activeId: string | null) => {
  const active = keys.find((entry) => entry.id === activeId) ?? null
  write(KEYS.apiKeys, JSON.stringify({ keys, activeId: active?.id ?? null }))
  // 兼容旧字段与其他读取方
  write(KEYS.apiKey, active?.key ?? null)
  useSettings.setState({ apiKeys: keys, activeKeyId: active?.id ?? null, apiKey: active?.key ?? null })
}

const currentKeys = () => useSettings.getState()

export const addApiKey = (tag: string, key: string): string | null => {
  const state = currentKeys()
  const trimmed = key.trim()
  if (!trimmed || state.apiKeys.length >= API_KEY_LIMIT) {
    return null
  }
  const entry: ApiKeyEntry = {
    id: createId(),
    tag: tag.trim().slice(0, API_KEY_TAG_LIMIT) || `Key ${state.apiKeys.length + 1}`,
    key: trimmed,
  }
  persistKeys([...state.apiKeys, entry], state.activeKeyId ?? entry.id)
  return entry.id
}

export const updateApiKey = (id: string, patch: { tag?: string; key?: string }) => {
  const state = currentKeys()
  const keys = state.apiKeys.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          tag:
            patch.tag === undefined
              ? entry.tag
              : patch.tag.trim().slice(0, API_KEY_TAG_LIMIT) || entry.tag,
          key: patch.key === undefined ? entry.key : patch.key.trim() || entry.key,
        }
      : entry
  )
  persistKeys(keys, state.activeKeyId)
}

export const removeApiKey = (id: string) => {
  const state = currentKeys()
  if (state.apiKeys.length <= 1) {
    return
  }
  const keys = state.apiKeys.filter((entry) => entry.id !== id)
  persistKeys(keys, state.activeKeyId === id ? (keys[0]?.id ?? null) : state.activeKeyId)
}

export const activateApiKey = (id: string) => {
  const state = currentKeys()
  if (state.apiKeys.some((entry) => entry.id === id)) {
    persistKeys(state.apiKeys, id)
  }
}

// ---------- 模型设置 ----------

const commitModelSettings = (next: ModelSettings) => {
  write(KEYS.modelSettings, JSON.stringify(next))
  useSettings.setState({ modelSettings: next })
}

const current = () => useSettings.getState().modelSettings

export const setCompression = (compression: CompressionLevel) => {
  commitModelSettings({ ...current(), compression })
}

export const setPersonalization = (patch: Partial<Personalization>) => {
  const settings = current()
  commitModelSettings({
    ...settings,
    personalization: { ...settings.personalization, ...patch },
  })
}

const STYLE_TEXT: Record<Exclude<PersonalizationStyle, 'default'>, [string, string]> = {
  professional: [
    '使用准确、克制的措辞，先给结论再给依据；避免口语化、夸张和未经证实的断言。',
    'Use precise, measured wording. Lead with the conclusion, then the reasoning; avoid slang, hype and unverified claims.',
  ],
  friendly: [
    '用自然、有温度的口语表达，像一位可靠的朋友；可以回应对方的情绪，但不要过度寒暄。',
    'Write in a warm, natural voice like a reliable friend. Acknowledge feelings without overdoing pleasantries.',
  ],
  direct: [
    '直接指出问题与结论，不绕弯子；不同意时明确说明理由，并给出可执行的替代方案。',
    'Be direct about problems and conclusions. State disagreement with reasons and offer an actionable alternative.',
  ],
  imaginative: [
    '允许使用比喻、联想和开放思路，但必须明确区分事实、推断与想象。',
    'Use metaphors, associations and open-ended exploration, while clearly separating facts, inferences and imagination.',
  ],
  efficient: [
    '优先给出可执行步骤和最短路径，删除铺垫、重复与无关信息。',
    'Prioritize actionable steps and the shortest path; remove filler, repetition and irrelevant detail.',
  ],
  witty: [
    '可以适度吐槽和玩梗，但保持有用、克制、不冒犯，不拿用户的处境开玩笑。',
    'A little dry humor and banter is welcome, but stay useful, restrained and never mock the user’s situation.',
  ],
}

const WARMTH_TEXT: [string, string][] = [
  ['保持礼貌但不过分亲近，除非用户主动拉近距离。', 'Stay polite without being overly familiar unless the user invites closeness.'],
  ['适度使用温和的称呼与共情表达，让对话更有人情味。', 'Use gentle phrasing and some empathy to make the exchange feel human.'],
  ['主动表达理解与关心，语气更亲近，但仍保持专业边界。', 'Actively show understanding and care with a closer tone, while keeping professional boundaries.'],
]

const ENTHUSIASM_TEXT: [string, string][] = [
  ['语气平稳克制，不用感叹号堆砌情绪。', 'Keep the tone calm and restrained; avoid piling on exclamation marks.'],
  ['保持适度积极，对值得肯定的地方给出真诚反馈。', 'Stay moderately positive and give sincere credit where it is due.'],
  ['语气更有热情和感染力，让用户感受到你愿意一起把事情做成。', 'Sound energetic and motivating so the user feels you are invested in getting it done.'],
]

const STRUCTURE_TEXT: [string, string][] = [
  ['以连贯段落为主，少用标题和列表。', 'Prefer flowing paragraphs; avoid headings and lists unless necessary.'],
  ['内容较长时用少量小标题或列表辅助阅读。', 'For longer answers, use a few headings or lists to aid reading.'],
  ['优先用小标题、列表和步骤组织答案，让结构一眼可见。', 'Organize answers with headings, lists and steps so the structure is immediately visible.'],
]

const EMOJI_TEXT: [string, string][] = [
  ['不要使用表情符号。', 'Do not use emoji.'],
  ['可以少量使用表情符号，每段最多一个。', 'Use emoji sparingly, at most one per paragraph.'],
  ['可以适度使用表情符号增强语气，但不要影响可读性。', 'Use emoji moderately to reinforce tone without hurting readability.'],
]

/** 把个性化选项拼成注入 system 的指令；关闭时返回空串。 */
export const composePersonalizationPrompt = (
  personalization: Personalization,
  locale: Locale,
  privacyMode = false
): string => {
  if (!personalization.enabled || (privacyMode && !personalization.applyInPrivacy)) {
    return ''
  }
  const zh = locale !== 'en-US'
  const lines: string[] = []
  if (personalization.style !== 'default') {
    lines.push(STYLE_TEXT[personalization.style][zh ? 0 : 1])
  }
  lines.push(WARMTH_TEXT[personalization.warmth - 1][zh ? 0 : 1])
  lines.push(ENTHUSIASM_TEXT[personalization.enthusiasm - 1][zh ? 0 : 1])
  lines.push(STRUCTURE_TEXT[personalization.structure - 1][zh ? 0 : 1])
  lines.push(EMOJI_TEXT[personalization.emoji - 1][zh ? 0 : 1])
  const custom = personalization.custom.trim()
  if (custom) {
    lines.push(zh ? `用户还特别希望你在回复时考虑：${custom}` : `The user also wants you to consider: ${custom}`)
  }
  if (lines.length === 0) {
    return ''
  }
  const head = zh ? '用户还希望你做到：' : 'The user also wants you to:'
  const tail = zh
    ? '请在不违背事实、任务要求与安全规则的前提下遵循以上偏好。'
    : 'Follow these preferences without violating facts, the task or safety rules.'
  return `${head}\n${lines.map((line) => `- ${line}`).join('\n')}\n${tail}`
}

export const setModel = (model: ChatModel) => {
  commitModelSettings({ ...current(), model })
}

export const setSystemPrompt = (text: string) => {
  commitModelSettings({ ...current(), systemPrompt: text.slice(0, SYSTEM_PROMPT_LIMIT) })
}

export const resetSystemPrompt = () => {
  setSystemPrompt(DEFAULT_SYSTEM_PROMPT)
}

export const savePreset = (name: string, text: string) => {
  const settings = current()
  if (settings.presets.length >= PRESET_LIMIT) {
    return
  }
  const trimmed = name.trim().slice(0, PRESET_NAME_LIMIT)
  if (!trimmed) {
    return
  }
  commitModelSettings({
    ...settings,
    presets: [
      ...settings.presets,
      { id: createId(), name: trimmed, text: text.slice(0, SYSTEM_PROMPT_LIMIT) },
    ],
  })
}

export const deletePreset = (id: string) => {
  const settings = current()
  commitModelSettings({ ...settings, presets: settings.presets.filter((item) => item.id !== id) })
}

export const setSafety = (patch: Partial<ModelSettings['safety']>) => {
  const settings = current()
  commitModelSettings({ ...settings, safety: { ...settings.safety, ...patch } })
}

export const setSampling = (patch: Partial<SamplingSettings>) => {
  const settings = current()
  commitModelSettings({ ...settings, sampling: { ...settings.sampling, ...patch } })
}

export const resetSampling = () => {
  const settings = current()
  commitModelSettings({ ...settings, sampling: { ...DEFAULT_SAMPLING } })
}

export const setReminder = (patch: Partial<ModelSettings['reminder']>) => {
  const settings = current()
  commitModelSettings({ ...settings, reminder: { ...settings.reminder, ...patch } })
}


export const setMe = (patch: Partial<MeSettings>) => {
  const prev = useSettings.getState().me
  const next: MeSettings = {
    ...prev,
    ...patch,
    nickname: (patch.nickname ?? prev.nickname).slice(0, ME_NICKNAME_LIMIT),
    background: (patch.background ?? prev.background).slice(0, ME_BACKGROUND_LIMIT),
    memory: (patch.memory ?? prev.memory).slice(0, ME_MEMORY_LIMIT),
  }
  write(KEYS.me, JSON.stringify(next))
  useSettings.setState({ me: next })
}

const formatMeLocation = (location: UserLocation | null, locale: Locale): string => {
  if (!location) {
    return ''
  }
  if (location.region === 'CN' && locale === 'zh-CN') {
    const province = provinces.find((item) => item.code === location.province)
    const city = province?.cities.find((item) => item.code === location.city)
    if (province && city) {
      return `${province.name} ${city.name}`
    }
    return province?.name ?? getRegionName('CN', locale)
  }
  return getRegionName(location.region, locale)
}

/** 把“我的”（称呼、背景、位置、记忆）拼成注入 system 的前置提示词；关闭或隐私模式下未启用时返回空串。 */
export const composeMePrompt = (
  me: MeSettings,
  location: UserLocation | null,
  locale: Locale,
  privacyMode = false,
  sessionEnabled = true
): string => {
  if (!me.enabled || !sessionEnabled || (privacyMode && !me.applyInPrivacy)) {
    return ''
  }
  const zh = locale !== 'en-US'
  const items: string[] = []
  const nickname = me.nickname.trim()
  const background = me.background.trim()
  const loc = formatMeLocation(location, locale).trim()
  const memory = me.memory.trim()
  if (nickname) {
    items.push(zh ? `- 称呼：${nickname}` : `- Preferred name: ${nickname}`)
  }
  if (background) {
    items.push(zh ? `- 背景：${background}` : `- Background: ${background}`)
  }
  if (loc) {
    items.push(zh ? `- 位置：${loc}` : `- Location: ${loc}`)
  }
  if (memory) {
    items.push(zh ? `- 长期记忆：\n${memory}` : `- Long-term memory:\n${memory}`)
  }
  if (items.length === 0) {
    return ''
  }
  const head = zh
    ? '以下是关于当前用户的个人信息与长期记忆，请在合适时自然地作为参考（无需刻意提及记忆的存在）：'
    : 'Here is personal information and long-term memory about the user. Use it naturally when helpful without awkwardly mentioning it:'
  return `${head}\n${items.join('\n')}`
}

// ---------- 配置式：捕获 / 应用 / 校验 ----------

export const captureProfileConfig = (): ProfileConfig => {
  const settings = useSettings.getState()
  return {
    locale: settings.locale,
    welcomeMessage: settings.welcomeMessage,
    themePreference: settings.themePreference,
    ttsVoice: settings.ttsVoice,
    location: settings.location,
    thinking: settings.thinking,
    thinkingEffort: settings.thinkingEffort,
    search: settings.search,
    modelSettings: JSON.parse(JSON.stringify(settings.modelSettings)) as ModelSettings,
    apiKeys: JSON.parse(JSON.stringify(settings.apiKeys)) as ApiKeyEntry[],
    activeKeyId: settings.activeKeyId,
    me: { ...settings.me },
  }
}

export const applyProfileConfig = (config: ProfileConfig) => {
  const activeKey =
    config.apiKeys.find((entry) => entry.id === config.activeKeyId) ?? config.apiKeys[0] ?? null
  const me = sanitizeMeSettings(config.me)
  write(KEYS.locale, config.locale)
  write(KEYS.welcomeMessage, config.welcomeMessage)
  write(KEYS.themePreference, config.themePreference)
  write(KEYS.ttsVoice, config.ttsVoice)
  write(KEYS.location, config.location ? JSON.stringify(config.location) : null)
  write(KEYS.thinking, String(config.thinking))
  write(KEYS.thinkingEffort, config.thinkingEffort)
  write(KEYS.search, String(config.search))
  write(KEYS.modelSettings, JSON.stringify(config.modelSettings))
  write(
    KEYS.apiKeys,
    JSON.stringify({ keys: config.apiKeys, activeId: config.activeKeyId })
  )
  write(KEYS.apiKey, activeKey?.key ?? null)
  write(KEYS.me, JSON.stringify(me))
  useSettings.setState({
    locale: config.locale,
    welcomeMessage: config.welcomeMessage,
    themePreference: config.themePreference,
    ttsVoice: config.ttsVoice,
    location: config.location,
    thinking: config.thinking,
    thinkingEffort: config.thinkingEffort,
    search: config.search,
    modelSettings: JSON.parse(JSON.stringify(config.modelSettings)) as ModelSettings,
    apiKeys: JSON.parse(JSON.stringify(config.apiKeys)) as ApiKeyEntry[],
    activeKeyId: config.activeKeyId,
    apiKey: activeKey?.key ?? null,
    me,
  })
}

/** 导入配置式时的防御性校验：所有字段都按本地设置的类型重新收敛 */
export const sanitizeProfileConfig = (raw: unknown): ProfileConfig | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const item = raw as Record<string, unknown>
  const locale: Locale = item.locale === 'en-US' ? 'en-US' : 'zh-CN'
  const themePreference: ThemePreference =
    item.themePreference === 'light' || item.themePreference === 'dark'
      ? item.themePreference
      : 'system'
  const ttsVoice: TtsVoice = item.ttsVoice === 'tide' ? 'tide' : 'stella'
  const location = normalizeLocation(item.location)
  const thinkingEffort: ThinkingEffort =
    item.thinkingEffort === 'low' ? 'low' : item.thinkingEffort === 'max' ? 'max' : 'high'
  const keys = sanitizeApiKeys({
    keys: item.apiKeys,
    activeId: item.activeKeyId,
  })
  const activeKeyId =
    keys.keys.find((entry) => entry.id === keys.activeId)?.id ?? keys.keys[0]?.id ?? null
  return {
    locale,
    welcomeMessage:
      typeof item.welcomeMessage === 'string' ? item.welcomeMessage.slice(0, 160) : null,
    themePreference,
    ttsVoice,
    location,
    thinking: item.thinking === true,
    thinkingEffort,
    search: item.search === true,
    modelSettings: sanitizeModelSettings(item.modelSettings),
    apiKeys: keys.keys,
    activeKeyId,
    me: sanitizeMeSettings(item.me),
  }
}

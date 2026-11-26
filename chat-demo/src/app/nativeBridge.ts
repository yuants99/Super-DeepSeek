import {
  DEFAULT_SYSTEM_PROMPT,
  setModel,
  setSafety,
  setSearch,
  setSystemPrompt,
  setThinking,
  setThinkingEffort,
  useSettings,
  type SafetyLevel,
} from '../services/settings.js'
import type { ThinkingEffort } from '../services/api/types.js'
import { compressSession, selectSession, useChatStore } from '../services/chat/store.js'
import { openNewChatSetup } from '../components/session/newChatSetupState.js'
import {
  openSettings,
  useSettingsDialog,
  type SettingsSection,
} from '../components/settings/settingsDialogState.js'
import { showToast } from '../components/base/toastState.js'
import { receiveStatusPayload, requestNativeStatus } from '../services/status.js'
import { switchProfile, useProfiles } from '../services/profiles.js'

/**
 * macOS 原生菜单桥接：仅在 WKWebView 注入了 nativeMenu 消息处理器时启用。
 * Web 仍是唯一状态源；原生通过 execute 发命令、通过 state 消息镜像勾选状态。
 */
type NativeState = {
  ready: boolean
  locale: string
  settingsOpen: boolean
  hasSession: boolean
  hasKey: boolean
  streaming: boolean
  thinking: boolean
  thinkingEffort: ThinkingEffort
  search: boolean
  model: string
  safety: { enabled: boolean; level: SafetyLevel }
  promptId: string
  presets: { id: string; name: string }[]
  profiles: { id: string; name: string }[]
  activeProfileId: string
}

const settingsSections: SettingsSection[] = [
  'profiles',
  'me',
  'general',
  'personalization',
  'model',
  'billing',
  'keys',
  'data',
  'about',
]

const snapshot = (): NativeState => {
  const settings = useSettings.getState()
  const chat = useChatStore.getState()
  const presets = settings.modelSettings.presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
  }))
  const prompt = settings.modelSettings.systemPrompt
  const promptId =
    prompt === DEFAULT_SYSTEM_PROMPT
      ? 'default'
      : (presets.find((preset) => settings.modelSettings.presets.find((item) => item.id === preset.id)?.text === prompt)?.id ?? 'custom')
  return {
    ready: true,
    locale: settings.locale,
    settingsOpen: useSettingsDialog.getState().open,
    hasSession: chat.activeId !== null,
    hasKey: Boolean(settings.apiKey),
    streaming: chat.activeId ? Boolean(chat.streaming[chat.activeId]) : false,
    thinking: settings.thinking,
    thinkingEffort: settings.thinkingEffort,
    search: settings.search,
    model: settings.modelSettings.model,
    safety: { ...settings.modelSettings.safety },
    promptId,
    presets,
    profiles: useProfiles.getState().profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    })),
    activeProfileId: useProfiles.getState().activeId,
  }
}

const isSection = (value: unknown): value is SettingsSection =>
  typeof value === 'string' && (settingsSections as string[]).includes(value)

const isEffort = (value: unknown): value is ThinkingEffort =>
  value === 'low' || value === 'high' || value === 'max'

const isSafetyLevel = (value: unknown): value is SafetyLevel =>
  value === 'low' || value === 'high'

const execute = (command: unknown) => {
  if (!command || typeof command !== 'object') {
    return
  }
  const payload = command as Record<string, unknown>
  switch (payload.type) {
    case 'openSettings':
      openSettings(isSection(payload.section) ? payload.section : 'general')
      break
    case 'setThinking': {
      const enabled = payload.enabled === true
      setThinking(enabled)
      if (enabled && isEffort(payload.effort)) {
        setThinkingEffort(payload.effort)
      }
      break
    }
    case 'setSearch':
      setSearch(payload.enabled === true)
      break
    case 'setModel':
      if (payload.model === 'deepseek-flash' || payload.model === 'deepseek-v4-pro') {
        setModel(payload.model)
      }
      break
    case 'setSafety': {
      const patch: { enabled: boolean; level?: SafetyLevel } = { enabled: payload.enabled === true }
      if (isSafetyLevel(payload.level)) {
        patch.level = payload.level
      }
      setSafety(patch)
      break
    }
    case 'setPrompt': {
      if (payload.presetId === 'default') {
        setSystemPrompt(DEFAULT_SYSTEM_PROMPT)
      } else if (typeof payload.presetId === 'string') {
        const preset = useSettings
          .getState()
          .modelSettings.presets.find((item) => item.id === payload.presetId)
        if (preset) {
          setSystemPrompt(preset.text)
        }
      }
      break
    }
    case 'switchProfile':
      if (typeof payload.id === 'string') {
        switchProfile(payload.id)
      }
      break
    case 'newChat':
      openNewChatSetup()
      break
    case 'selectSession':
      if (typeof payload.id === 'string') {
        selectSession(payload.id)
      }
      break
    case 'compress': {
      const chat = useChatStore.getState()
      if (!chat.activeId || chat.streaming[chat.activeId] || !useSettings.getState().apiKey) {
        break
      }
      void compressSession(chat.activeId)
        .then((result) => {
          if (result) {
            showToast({ key: 'statsCompressedToast', params: { rounds: result.droppedRounds } })
          }
        })
        .catch(() => {
          showToast({ key: 'statsCompressFailed', type: 'error' })
        })
      break
    }
    default:
      break
  }
  schedule()
}

let timer = 0
let lastSent = ''
const post = (payload: unknown) => {
  window.webkit?.messageHandlers?.nativeMenu?.postMessage(payload)
}

const clipboardResolvers = new Map<string, (text: string) => void>()

const readNativeClipboard = () =>
  new Promise<string>((resolve) => {
    if (!window.webkit?.messageHandlers?.nativeMenu) {
      resolve('')
      return
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    clipboardResolvers.set(id, resolve)
    post({ type: 'clipboardRead', id })
    window.setTimeout(() => {
      if (clipboardResolvers.delete(id)) {
        resolve('')
      }
    }, 3000)
  })

const writeNativeClipboard = (text: string) => {
  post({ type: 'clipboardWrite', text })
}

const settleNativeClipboard = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return
  }
  const data = payload as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id : ''
  const resolve = clipboardResolvers.get(id)
  if (!resolve) {
    return
  }
  clipboardResolvers.delete(id)
  resolve(typeof data.text === 'string' ? data.text : '')
}
const schedule = () => {
  if (timer) {
    return
  }
  timer = window.setTimeout(() => {
    timer = 0
    const state = snapshot()
    const serialized = JSON.stringify(state)
    if (serialized !== lastSent) {
      lastSent = serialized
      post({ type: 'state', state })
    }
  }, 120)
}

export const installNativeBridge = () => {
  if (!window.webkit?.messageHandlers?.nativeMenu) {
    return
  }
  window.__nativeBridge = {
    getState: snapshot,
    execute,
    fetchStatus: requestNativeStatus,
    receiveStatus: receiveStatusPayload,
    readClipboard: readNativeClipboard,
    writeClipboard: writeNativeClipboard,
    wipeAllData: () => {
      window.webkit?.messageHandlers?.nativeMenu?.postMessage({ type: 'wipeAllData' })
    },
  }
  window.__nativeClipboard = settleNativeClipboard
  useSettings.subscribe(schedule)
  useSettingsDialog.subscribe(schedule)
  useChatStore.subscribe(schedule)
  useProfiles.subscribe(schedule)
  post({ type: 'ready' })
  lastSent = JSON.stringify(snapshot())
  post({ type: 'state', state: snapshot() })
}

declare global {
  interface Window {
    __nativeBridge?: {
      getState: () => NativeState
      execute: (command: unknown) => void
      fetchStatus: () => Promise<string>
      receiveStatus: (payload: { xml?: string; error?: string }) => void
      readClipboard: () => Promise<string>
      writeClipboard: (text: string) => void
      wipeAllData: () => void
    }
    __nativeClipboard?: (payload: unknown) => void
    webkit?: {
      messageHandlers?: {
        nativeMenu?: {
          postMessage: (payload: unknown) => void
        }
      }
    }
  }
}

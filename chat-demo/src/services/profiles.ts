import { create } from 'zustand'
import { exitPrivacyMode, isApplyingChatSettings, useChatStore } from './chat/store.js'
import {
  applyProfileConfig,
  captureProfileConfig,
  sanitizeProfileConfig,
  useSettings,
  type ProfileConfig,
} from './settings.js'

/** 配置式：独立设置空间，只包含设置与 Key，不含任何对话数据 */
export type Profile = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  config: ProfileConfig
}

type ProfilesState = {
  profiles: Profile[]
  activeId: string
}

const STORAGE_KEY = 'chat-demo:profiles'
const DEFAULT_ID = 'default'
const NAME_LIMIT = 40

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const persist = (profiles: Profile[], activeId: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles, activeId }))
  } catch {
    // 存储不可用时只在内存中生效
  }
}

const readStored = (): { profiles: Profile[]; activeId: string } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const value = parsed as Record<string, unknown>
    if (!Array.isArray(value.profiles)) {
      return null
    }
    const profiles: Profile[] = []
    for (const entry of value.profiles) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue
      }
      const item = entry as Record<string, unknown>
      if (typeof item.id !== 'string' || typeof item.name !== 'string') {
        continue
      }
      const config = sanitizeProfileConfig(item.config)
      if (!config) {
        continue
      }
      profiles.push({
        id: item.id,
        name: item.name.slice(0, NAME_LIMIT),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        config,
      })
    }
    return {
      profiles,
      activeId: typeof value.activeId === 'string' ? value.activeId : DEFAULT_ID,
    }
  } catch {
    return null
  }
}

const initial = (): { profiles: Profile[]; activeId: string } => {
  const stored = readStored()
  if (stored && stored.profiles.length > 0) {
    const activeId = stored.profiles.some((profile) => profile.id === stored.activeId)
      ? stored.activeId
      : stored.profiles[0].id
    return { profiles: stored.profiles, activeId }
  }
  const now = Date.now()
  return {
    profiles: [
      {
        id: DEFAULT_ID,
        name: '默认',
        createdAt: now,
        updatedAt: now,
        config: captureProfileConfig(),
      },
    ],
    activeId: DEFAULT_ID,
  }
}

export const useProfiles = create<ProfilesState>(() => initial())

let applying = false
let saveTimer = 0

const saveActive = () => {
  const { profiles, activeId } = useProfiles.getState()
  const index = profiles.findIndex((profile) => profile.id === activeId)
  if (index < 0) {
    return
  }
  const next = [...profiles]
  next[index] = {
    ...next[index],
    config: captureProfileConfig(),
    updatedAt: Date.now(),
  }
  useProfiles.setState({ profiles: next })
  persist(next, activeId)
}

// 当前配置式是“活”的：设置一改就回写快照，切换回来仍保留。
useSettings.subscribe(() => {
  if (
    applying ||
    useChatStore.getState().privacyMode ||
    useChatStore.getState().activeId !== null ||
    isApplyingChatSettings()
  ) {
    return
  }
  if (saveTimer) {
    return
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = 0
    saveActive()
  }, 400)
})

export const switchProfile = (id: string) => {
  if (useChatStore.getState().privacyMode) {
    exitPrivacyMode()
  }
  const { profiles, activeId } = useProfiles.getState()
  if (id === activeId) {
    return
  }
  const target = profiles.find((profile) => profile.id === id)
  if (!target) {
    return
  }
  saveActive()
  const latest = useProfiles.getState().profiles
  const nextTarget = latest.find((profile) => profile.id === id)
  if (!nextTarget) {
    return
  }
  applying = true
  applyProfileConfig(nextTarget.config)
  applying = false
  useProfiles.setState({ activeId: id, profiles: latest })
  persist(latest, id)
}

export const createProfile = (name: string): Profile => {
  saveActive()
  const current = useProfiles.getState()
  const trimmed = name.trim().slice(0, NAME_LIMIT) || `配置式 ${current.profiles.length + 1}`
  const now = Date.now()
  const profile: Profile = {
    id: uid(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    config: captureProfileConfig(),
  }
  const profiles = [...current.profiles, profile]
  useProfiles.setState({ profiles, activeId: profile.id })
  persist(profiles, profile.id)
  return profile
}

export const renameProfile = (id: string, name: string) => {
  const trimmed = name.trim().slice(0, NAME_LIMIT)
  if (!trimmed) {
    return
  }
  const { profiles, activeId } = useProfiles.getState()
  const next = profiles.map((profile) =>
    profile.id === id ? { ...profile, name: trimmed, updatedAt: Date.now() } : profile
  )
  useProfiles.setState({ profiles: next })
  persist(next, activeId)
}

export const deleteProfile = (id: string) => {
  if (id === DEFAULT_ID) {
    return
  }
  saveActive()
  const { activeId } = useProfiles.getState()
  if (id === activeId) {
    switchProfile(DEFAULT_ID)
  }
  const latest = useProfiles.getState()
  const next = latest.profiles.filter((profile) => profile.id !== id)
  useProfiles.setState({ profiles: next })
  persist(next, latest.activeId)
}

export const isDefaultProfile = (id: string) => id === DEFAULT_ID

// ---------- 加密导出 / 导入 ----------

const ITERATIONS = 210_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const fromBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const source = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource

const deriveKey = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey(
    'raw',
    source(encoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: source(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export type EncryptedProfileFile = {
  format: 'deepseek-profile'
  version: 1
  cipher: 'AES-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  data: string
}

export const exportProfile = async (
  id: string,
  options: { includeKeys: boolean; password: string }
): Promise<{ name: string; blob: Blob }> => {
  if (options.password.length < 6) {
    throw new Error('passwordTooShort')
  }
  const profile = useProfiles.getState().profiles.find((item) => item.id === id)
  if (!profile) {
    throw new Error('profileMissing')
  }
  const config = JSON.parse(JSON.stringify(profile.config)) as ProfileConfig
  if (!options.includeKeys) {
    config.apiKeys = []
    config.activeKeyId = null
  }
  const payload = JSON.stringify({
    format: 'deepseek-profile',
    version: 1,
    name: profile.name,
    config,
  })
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(options.password, salt)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: source(iv) },
    key,
    source(encoder.encode(payload))
  )
  const file: EncryptedProfileFile = {
    format: 'deepseek-profile',
    version: 1,
    cipher: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encrypted)),
  }
  const safeName = profile.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'profile'
  return {
    name: `${safeName}.dsprofile`,
    blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
  }
}

export const importProfile = async (file: File, password: string): Promise<Profile> => {
  if (password.length < 6) {
    throw new Error('passwordTooShort')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('invalidFile')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalidFile')
  }
  const fileData = parsed as Record<string, unknown>
  if (
    fileData.format !== 'deepseek-profile' ||
    fileData.version !== 1 ||
    fileData.cipher !== 'AES-GCM' ||
    fileData.kdf !== 'PBKDF2-SHA256' ||
    typeof fileData.salt !== 'string' ||
    typeof fileData.iv !== 'string' ||
    typeof fileData.data !== 'string'
  ) {
    throw new Error('invalidFile')
  }
  let payload: unknown
  try {
    const salt = fromBase64(fileData.salt)
    const iv = fromBase64(fileData.iv)
    const key = await deriveKey(password, salt)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: source(iv) },
      key,
      source(fromBase64(fileData.data))
    )
    payload = JSON.parse(decoder.decode(decrypted))
  } catch {
    throw new Error('wrongPassword')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalidFile')
  }
  const content = payload as Record<string, unknown>
  const config = sanitizeProfileConfig(content.config)
  if (!config) {
    throw new Error('invalidFile')
  }
  const baseName =
    typeof content.name === 'string' && content.name.trim()
      ? content.name.trim().slice(0, NAME_LIMIT)
      : '导入的配置式'
  const current = useProfiles.getState()
  let name = baseName
  let index = 2
  while (current.profiles.some((profile) => profile.name === name)) {
    name = `${baseName} (${index})`
    index += 1
  }
  const now = Date.now()
  const profile: Profile = {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    config,
  }
  const profiles = [...current.profiles, profile]
  useProfiles.setState({ profiles })
  persist(profiles, current.activeId)
  return profile
}

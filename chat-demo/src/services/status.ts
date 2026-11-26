export type IncidentState = 'resolved' | 'investigating' | 'identified' | 'monitoring' | 'unknown'

export type StatusIncident = {
  title: string
  link: string
  date: number
  state: IncidentState
  description: string
  components: string[]
}

export type ServiceKey = 'chat' | 'tools' | 'speech' | 'files'

export type ServiceHealth = {
  key: ServiceKey
  state: 'operational' | 'degraded'
}

export type ServiceStatus = {
  state: 'operational' | 'degraded' | 'unknown'
  services: ServiceHealth[]
  event: StatusIncident | null
  eventActive: boolean
  fetchedAt: number
}

const STATUS_URL = 'https://status.deepseek.com/feed.rss'

const decodeHtml = (value: string): string => {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

const plainText = (value: string): string =>
  decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const parseIncidentState = (description: string): IncidentState => {
  const match = /Status:\s*(resolved|investigating|identified|monitoring)/i.exec(description)
  const value = match?.[1]?.toLowerCase()
  return value === 'resolved' || value === 'investigating' || value === 'identified' || value === 'monitoring'
    ? value
    : 'unknown'
}

export const parseStatusFeed = (xml: string): ServiceStatus => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('invalid feed')
  }
  const items = [...doc.querySelectorAll('channel > item')]
  const incidents: StatusIncident[] = items.map((item) => {
    const rawDescription = item.querySelector('description')?.textContent ?? ''
    const description = plainText(rawDescription)
    const affected = /Affected components:\s*(.+)$/i.exec(description)?.[1] ?? ''
    const components = affected
      .split(/[,，、]/)
      .map((part) => part.trim())
      .filter(Boolean)
    return {
      title: plainText(item.querySelector('title')?.textContent ?? ''),
      link: item.querySelector('link')?.textContent?.trim() ?? '',
      date: Date.parse(item.querySelector('pubDate')?.textContent ?? '') || 0,
      state: parseIncidentState(description),
      description: description
        .replace(/^(Status:\s*\w+\s*)/i, '')
        .replace(/Affected components:.*$/i, '')
        .trim()
        .slice(0, 200),
      components,
    }
  })
  incidents.sort((a, b) => b.date - a.date)
  const active = incidents.find(
    (incident) =>
      incident.state === 'investigating' ||
      incident.state === 'identified' ||
      incident.state === 'monitoring'
  )
  const affectedKeys = new Set<ServiceKey>()
  if (active) {
    for (const component of active.components) {
      if (/chat|对话|api/i.test(component)) {
        affectedKeys.add('chat')
      }
      if (/search|fetch|搜索|抓取/i.test(component)) {
        affectedKeys.add('tools')
      }
      if (/tts|asr|voice|speech|语音/i.test(component)) {
        affectedKeys.add('speech')
      }
      if (/file|upload|document|上传|文档/i.test(component)) {
        affectedKeys.add('files')
      }
    }
    if (affectedKeys.size === 0) {
      affectedKeys.add('chat')
    }
  }
  const services: ServiceHealth[] = (['chat', 'tools', 'speech', 'files'] as const).map((key) => ({
    key,
    state: affectedKeys.has(key) ? 'degraded' : 'operational',
  }))
  return {
    state: active ? 'degraded' : 'operational',
    services,
    event: active ?? incidents[0] ?? null,
    eventActive: Boolean(active),
    fetchedAt: Date.now(),
  }
}

let pendingNative: {
  resolve: (xml: string) => void
  reject: (error: Error) => void
  timer: number
} | null = null

export const receiveStatusPayload = (payload: { xml?: string; error?: string }) => {
  const pending = pendingNative
  if (!pending) {
    return
  }
  pendingNative = null
  window.clearTimeout(pending.timer)
  if (payload.error || !payload.xml) {
    pending.reject(new Error(payload.error ?? 'empty status'))
  } else {
    pending.resolve(payload.xml)
  }
}

/** 优先让 macOS 原生代取（无 CORS 限制），浏览器里退回直连。 */
export const fetchServiceStatus = async (): Promise<ServiceStatus> => {
  const bridge = window.__nativeBridge
  if (bridge?.fetchStatus) {
    const xml = await bridge.fetchStatus()
    return parseStatusFeed(xml)
  }
  const response = await fetch(STATUS_URL, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`status ${response.status}`)
  }
  return parseStatusFeed(await response.text())
}

export const requestNativeStatus = () =>
  new Promise<string>((resolve, reject) => {
    if (pendingNative) {
      pendingNative.reject(new Error('superseded'))
      window.clearTimeout(pendingNative.timer)
    }
    const timer = window.setTimeout(() => {
      pendingNative = null
      reject(new Error('timeout'))
    }, 15_000)
    pendingNative = { resolve, reject, timer }
    window.webkit?.messageHandlers?.nativeMenu?.postMessage({ type: 'fetchStatus' })
  })

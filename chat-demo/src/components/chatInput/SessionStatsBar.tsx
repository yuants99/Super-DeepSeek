import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore, compressSession, clearCompaction } from '../../services/chat/store.js'
import { MODEL_RATES, isPeak } from '../../services/usage.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { Session } from '../../services/chat/types.js'
import { IconClockOutline14, IconDatabaseOutline14 } from '../base/icons.js'
import {
  CONTEXT_BUDGET,
  CONTEXT_RESERVE,
  contextLevelOf,
  contextPercentOf,
  estimatePathTokens,
  type ContextLevel,
} from '../../services/tokenEstimate.js'
import styles from './SessionStats.module.css'

const formatDuration = (ms: number) => {
  if (ms <= 0) {
    return '—'
  }
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`
}

type Stats = {
  rounds: number
  steps: number
  totalTokens: number
  estimatedTokens: number
  sessionCost: number
  input: number
  cacheRead: number
  cacheCreation: number
  output: number
  cacheRate: number | null
  lastTps: number | null
  avgTps: number | null
  avgTtft: number | null
  totalGenMs: number
  contextTokens: number
  contextPercent: number
  contextEstimated: boolean
  compactedRounds: number
}

const computeStats = (session: Session): Stats => {
  const path = getVisibleMessages(session)
  let rounds = 0
  let steps = 0
  let input = 0
  let cacheRead = 0
  let cacheCreation = 0
  let output = 0
  let estimatedTokens = 0
  let totalTokens = 0
  let sessionCost = 0
  let totalGenMs = 0
  let ttftSum = 0
  let ttftCount = 0
  let tpsOutput = 0
  let tpsMs = 0
  let lastTps: number | null = null
  let lastAssistantUsage = 0
  let pathTokens = 0
  let hasUsage = false

  for (const message of path) {
    if (message.role === 'user') {
      rounds += 1
      continue
    }
    for (const block of message.blocks) {
      if (block.type === 'thinking' || block.type === 'server_tool_use') {
        steps += 1
      }
    }
    if (message.usage) {
      hasUsage = true
      const total =
        message.usage.input_tokens +
        message.usage.cache_read_input_tokens +
        message.usage.cache_creation_input_tokens +
        message.usage.output_tokens
      input += message.usage.input_tokens
      cacheRead += message.usage.cache_read_input_tokens
      cacheCreation += message.usage.cache_creation_input_tokens
      output += message.usage.output_tokens
      totalTokens += total
      lastAssistantUsage = total
      const rate = MODEL_RATES[message.model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash']
      const factor = isPeak(message.createdAt) ? 2 : 1
      sessionCost +=
        ((message.usage.cache_read_input_tokens * rate.cacheHit +
          (message.usage.input_tokens + message.usage.cache_creation_input_tokens) * rate.cacheMiss +
          message.usage.output_tokens * rate.output) *
          factor) /
        1_000_000
    }
    if (message.firstTokenAt && message.completedAt) {
      const ttft = Math.max(0, message.firstTokenAt - message.createdAt)
      const gen = Math.max(0, message.completedAt - message.firstTokenAt)
      totalGenMs += Math.max(0, message.completedAt - message.createdAt)
      if (ttft > 0) {
        ttftSum += ttft
        ttftCount += 1
      }
      if (gen > 0 && message.usage && message.usage.output_tokens > 0) {
        tpsOutput += message.usage.output_tokens
        tpsMs += gen
        lastTps = message.usage.output_tokens / (gen / 1000)
      }
    }
  }

  const compaction = session.compaction
  pathTokens = estimatePathTokens(path)
  let contextTokens = lastAssistantUsage || pathTokens
  let compactedRounds = 0
  if (compaction) {
    const cut = path.findIndex((message) => message.id === compaction.upToMessageId)
    if (cut >= 0) {
      compactedRounds = compaction.droppedRounds
      const remaining = path.slice(cut + 1)
      contextTokens = estimatePathTokens(remaining) + Math.ceil(compaction.digest.length / 2)
    }
  }

  return {
    rounds,
    steps,
    input,
    cacheRead,
    cacheCreation,
    output,
    totalTokens: totalTokens + estimatedTokens,
    estimatedTokens,
    sessionCost,
    cacheRate: input + cacheRead + cacheCreation > 0
      ? (cacheRead / (input + cacheRead + cacheCreation)) * 100
      : null,
    lastTps,
    avgTps: tpsMs > 0 ? tpsOutput / (tpsMs / 1000) : null,
    avgTtft: ttftCount > 0 ? ttftSum / ttftCount : null,
    totalGenMs,
    contextTokens,
    contextPercent: contextPercentOf(contextTokens),
    contextEstimated: !hasUsage || Boolean(compaction),
    compactedRounds,
  }
}

const Popover = ({
  label,
  align = 'start',
  content,
  children,
}: {
  label: string
  align?: 'start' | 'end'
  content: ReactNode
  children: ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { side: 'top', align, offset: 8, maxHeight: 320 })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        className={clsx(styles.item, open && styles.itemOpen)}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div ref={floatingRef} className={styles.popover} style={position ?? undefined}>
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.row}>
    <span>{label}</span>
    <span className={styles.rowValue}>{value}</span>
  </div>
)

/** 输入框下方的会话统计条：轮数/步数/速度、累计 Token、上下文占用与压缩。 */
export const SessionStatsBar = ({ sessionId }: { sessionId: string }) => {
  const t = useTranslate()
  const session = useChatStore((state) => state.sessionCache[sessionId])
  const streaming = useChatStore((state) => Boolean(state.streaming[sessionId]))
  const [compacting, setCompacting] = useState(false)
  const [dismissed, setDismissed] = useState<ContextLevel | null>(null)
  const [stats, setStats] = useState<Stats | null>(() => (session ? computeStats(session) : null))

  // 流式期间不重算，结束后再统计，避免长文本反复扫描。
  useEffect(() => {
    if (!session) {
      setStats(null)
      return
    }
    if (streaming) {
      return
    }
    const timer = window.setTimeout(() => setStats(computeStats(session)), 200)
    return () => window.clearTimeout(timer)
  }, [session, streaming])

  if (!session || !stats || stats.rounds === 0) {
    return null
  }

  const speed = stats.lastTps ?? stats.avgTps
  const level = contextLevelOf(stats.contextPercent)
  const alertKey =
    level === 'critical'
      ? 'statsAlertCritical'
      : level === 'high'
        ? 'statsAlertHigh'
        : 'statsAlertWarn'
  const compress = async () => {
    if (compacting || !ensureApiKey()) {
      return
    }
    setCompacting(true)
    try {
      const result = await compressSession(sessionId)
      if (result) {
        showToast({ key: 'statsCompressedToast', params: { rounds: result.droppedRounds } })
      }
    } catch {
      showToast({ key: 'statsCompressFailed', type: 'error' })
    } finally {
      setCompacting(false)
    }
  }

  return (
    <>
      {level !== 'normal' && dismissed !== level ? (
        <div
          className={clsx(
            styles.alert,
            level === 'warn' && styles.alertWarn,
            level === 'high' && styles.alertHigh,
            level === 'critical' && styles.alertCritical
          )}
        >
          <span className={styles.alertText}>
            {t(alertKey, { percent: stats.contextPercent.toFixed(0) })}
          </span>
          <button
            type="button"
            className={styles.alertCompress}
            disabled={compacting || stats.rounds < 4}
            onClick={() => void compress()}
          >
            {compacting ? t('statsCompressing') : t('statsCompress')}
          </button>
          <button
            type="button"
            className={styles.alertClose}
            aria-label={t('statsAlertDismiss')}
            onClick={() => setDismissed(level)}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className={styles.bar}>
      <Popover
        label={t('statsGenerationTitle')}
        content={
          <>
            <div className={styles.popoverTitle}>{t('statsGenerationTitle')}</div>
            <Row label={t('statsRounds')} value={String(stats.rounds)} />
            <Row label={t('statsStepsLabel')} value={String(stats.steps)} />
            <Row label={t('statsTotalTime')} value={formatDuration(stats.totalGenMs)} />
            <Row
              label={t('statsTtft')}
              value={stats.avgTtft === null ? '—' : `${(stats.avgTtft / 1000).toFixed(2)}s`}
            />
            <Row
              label={t('statsAvgTps')}
              value={stats.avgTps === null ? '—' : stats.avgTps.toFixed(0)}
            />
          </>
        }
      >
        <IconClockOutline14 />
        <span>
          {t('statsRoundsShort', { count: stats.rounds })} {t('statsStepsShort', { count: stats.steps })}
          {speed ? ` · ${speed.toFixed(0)} tok/s` : ''}
        </span>
      </Popover>

      <Popover
        label={t('statsTokenTitle')}
        content={
          <>
            <div className={styles.popoverTitle}>{t('statsTokenTitle')}</div>
            <Row
              label={t('statsTotalTokens')}
              value={stats.totalTokens > 0 ? `${stats.totalTokens} tok` : t('statsNoData')}
            />
            <Row label={t('statsSessionCost')} value={`¥${stats.sessionCost.toFixed(2)}`} />
            <Row
              label={t('statsCacheRate')}
              value={stats.cacheRate === null ? '—' : `${stats.cacheRate.toFixed(0)}%`}
            />
            {stats.cacheRead + stats.input + stats.cacheCreation > 0 ? (
              <>
                <Row label={t('statsUncached')} value={`${stats.input + stats.cacheCreation} tok`} />
                <Row label={t('statsCacheRead')} value={`${stats.cacheRead} tok`} />
                <Row label={t('statsOutput')} value={`${stats.output} tok`} />
              </>
            ) : (
              <div className={styles.popoverHint}>{t('statsNoBreakdown')}</div>
            )}
          </>
        }
      >
        <IconDatabaseOutline14 />
        <span>
          {stats.totalTokens > 0 ? `${stats.totalTokens} tok` : t('statsNoData')}
          {` · ¥${stats.sessionCost.toFixed(2)}`}
          {stats.cacheRate !== null
            ? ` · ${t('statsCacheHitShort', { value: stats.cacheRate.toFixed(0) })}`
            : ''}
        </span>
      </Popover>

      <Popover
        label={t('statsContextTitle')}
        align="end"
        content={
          <>
            <div className={styles.popoverTitle}>{t('statsContextTitle')}</div>
            <div className={styles.contextBar}>
              <div
                className={clsx(
                styles.contextFill,
                level === 'warn' && styles.contextWarn,
                level === 'high' && styles.contextHigh,
                level === 'critical' && styles.contextDanger
              )}
                style={{ width: `${stats.contextPercent}%` }}
              />
            </div>
            <div className={styles.contextMeta}>
              <span>{stats.contextPercent.toFixed(0)}%</span>
              <span>
                {stats.contextTokens} / {CONTEXT_BUDGET}
              </span>
            </div>
            {stats.compactedRounds > 0 ? (
              <div className={styles.popoverHint}>
                {t('statsCompressed', { rounds: stats.compactedRounds })}
              </div>
            ) : (
              <div className={styles.popoverHint}>{t('statsContextHint')}</div>
            )}
            <div className={styles.popoverHint}>
              {t('statsContextBudget', {
                budget: String(CONTEXT_BUDGET),
                reserve: String(CONTEXT_RESERVE),
              })}
            </div>
            <div className={styles.contextActions}>
              <button
                type="button"
                className={styles.compressButton}
                disabled={compacting || stats.rounds < 4}
                onClick={() => void compress()}
              >
                {compacting ? t('statsCompressing') : t('statsCompress')}
              </button>
              {stats.compactedRounds > 0 ? (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    clearCompaction(sessionId)
                    showToast({ key: 'statsUncompressedToast' })
                  }}
                >
                  {t('statsUncompact')}
                </button>
              ) : null}
            </div>
          </>
        }
      >
        <span className={styles.ring}>
          <svg viewBox="0 0 20 20" width={16} height={16} aria-hidden>
            <circle cx="10" cy="10" r="8" className={styles.ringTrack} />
            <circle
              cx="10"
              cy="10"
              r="8"
              className={clsx(
                styles.ringValue,
                level === 'warn' && styles.ringWarn,
                level === 'high' && styles.ringHigh,
                level === 'critical' && styles.ringDanger
              )}
              strokeDasharray={`${(stats.contextPercent / 100) * 50.27} 50.27`}
            />
          </svg>
          {compacting ? <span className={styles.spinner} /> : null}
        </span>
        <span>{stats.contextPercent.toFixed(0)}%</span>
        {stats.contextEstimated ? (
          <span className={styles.estimateBadge} title={t('statsEstimatedHint')}>
            {t('statsEstimated')}
          </span>
        ) : null}
      </Popover>
      </div>
    </>
  )
}

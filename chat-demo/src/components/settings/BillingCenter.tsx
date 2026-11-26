import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { fetchBalance } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { useSettings } from '../../services/settings.js'
import type { BalanceResponse } from '../../services/api/types.js'
import {
  MODEL_RATES,
  aggregateByDay,
  dayKeyOf,
  clearSpeechRecords,
  clearUsageRecords,
  getSpeechRecords,
  getUsageRecords,
  isPeak,
  summarize,
  summarizeSpeech,
  type UsageRecord,
  type DailyUsage,
} from '../../services/usage.js'
import styles from './Settings.module.css'

const RANGES = [7, 14, 30] as const
type Range = (typeof RANGES)[number]

const formatTokens = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return String(value)
}

const formatCost = (value: number): string => `¥${value.toFixed(4)}`

const ChartFrame = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 560 156" className={styles.chart} role="img">
    {children}
  </svg>
)

const TokensChart = ({ data }: { data: DailyUsage[] }) => {
  const W = 560
  const H = 156
  const PL = 8
  const PR = 8
  const PT = 10
  const PB = 20
  const innerW = W - PL - PR
  const innerH = H - PT - PB
  const max = Math.max(1, ...data.map((day) => day.tokens))
  const slot = innerW / data.length
  const barW = Math.max(3, Math.min(26, slot * 0.58))
  const labelEvery = data.length <= 14 ? 1 : Math.ceil(data.length / 10)
  return (
    <ChartFrame>
      {[0, 0.5, 1].map((ratio) => (
        <line
          key={ratio}
          x1={PL}
          x2={W - PR}
          y1={PT + innerH * (1 - ratio)}
          y2={PT + innerH * (1 - ratio)}
          className={styles.chartGrid}
        />
      ))}
      {data.map((day, index) => {
        const x = PL + slot * index + (slot - barW) / 2
        let cursor = PT + innerH
        const segments = [
          { value: day.cacheHit, className: styles.barHit },
          { value: day.cacheMiss, className: styles.barMiss },
          { value: day.output, className: styles.barOut },
        ]
        return (
          <g key={day.key}>
            <title>
              {`${day.key}  缓存命中 ${formatTokens(day.cacheHit)} · 未命中 ${formatTokens(
                day.cacheMiss
              )} · 输出 ${formatTokens(day.output)} · ${formatCost(day.cost)}`}
            </title>
            {segments.map((segment) => {
              const height = (segment.value / max) * innerH
              cursor -= height
              return segment.value > 0 ? (
                <rect
                  key={segment.className}
                  x={x}
                  y={cursor}
                  width={barW}
                  height={height}
                  className={segment.className}
                  rx={2}
                />
              ) : null
            })}
            {index % labelEvery === 0 ? (
              <text x={x + barW / 2} y={H - 5} textAnchor="middle" className={styles.chartLabel}>
                {day.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </ChartFrame>
  )
}

const CostChart = ({ data }: { data: DailyUsage[] }) => {
  const W = 560
  const H = 156
  const PL = 8
  const PR = 8
  const PT = 10
  const PB = 20
  const innerW = W - PL - PR
  const innerH = H - PT - PB
  const max = Math.max(0.0001, ...data.map((day) => day.cost))
  const slot = innerW / data.length
  const barW = Math.max(3, Math.min(26, slot * 0.58))
  const labelEvery = data.length <= 14 ? 1 : Math.ceil(data.length / 10)
  return (
    <ChartFrame>
      <line x1={PL} x2={W - PR} y1={PT + innerH} y2={PT + innerH} className={styles.chartGrid} />
      {data.map((day, index) => {
        const x = PL + slot * index + (slot - barW) / 2
        const height = (day.cost / max) * innerH
        return (
          <g key={day.key}>
            <title>{`${day.key}  ${formatCost(day.cost)}`}</title>
            <rect
              x={x}
              y={PT + innerH - height}
              width={barW}
              height={Math.max(height, day.cost > 0 ? 1.5 : 0)}
              className={styles.barCost}
              rx={2}
            />
            {index % labelEvery === 0 ? (
              <text x={x + barW / 2} y={H - 5} textAnchor="middle" className={styles.chartLabel}>
                {day.label}
              </text>
            ) : null}
          </g>
        )
      })}
    </ChartFrame>
  )
}

const Legend = () => {
  const t = useTranslate()
  return (
    <div className={styles.legend}>
      <span>
        <i className={clsx(styles.dot, styles.dotHit)} />
        {t('billingCacheHit')}
      </span>
      <span>
        <i className={clsx(styles.dot, styles.dotMiss)} />
        {t('billingCacheMiss')}
      </span>
      <span>
        <i className={clsx(styles.dot, styles.dotOut)} />
        {t('billingOutput')}
      </span>
    </div>
  )
}

const formatMoney = (value: number, currency: string) =>
  currency === 'USD' ? `$${value.toFixed(2)}` : `¥${value.toFixed(2)}`

type BalanceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: BalanceResponse }
  | { status: 'error'; message: string }

/** 账户余额：跟随当前选中的 API Key，进入计费中心自动查询。 */
const BalanceCard = () => {
  const t = useTranslate()
  const keys = useSettings((state) => state.apiKeys)
  const activeId = useSettings((state) => state.activeKeyId)
  const [state, setState] = useState<BalanceState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (id: string | null) => {
      const entry = keys.find((item) => item.id === id)
      if (!entry) {
        setState({ status: 'idle' })
        return
      }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setState({ status: 'loading' })
      try {
        const data = await fetchBalance(entry.key, controller.signal)
        if (!controller.signal.aborted) {
          setState({ status: 'done', data })
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setState({
          status: 'error',
          message:
            classifyApiError(error) === 'unauthorized'
              ? t('apiKeyInvalid')
              : error instanceof Error
                ? error.message
                : String(error),
        })
      }
    },
    [keys, t]
  )

  // 跟随当前选中的 API Key：切换 Key 后重新查询，离开时取消未完成的请求。
  useEffect(() => {
    void load(activeId)
    return () => controllerRef.current?.abort()
  }, [load, activeId])

  return (
    <div className={styles.balanceCard}>
      <div className={styles.balanceTop}>
        <span className={styles.balanceLabel}>{t('billingBalance')}</span>
        <div className={styles.balanceTools}>
          <button
            type="button"
            className={styles.linkButton}
            disabled={!activeId || state.status === 'loading'}
            onClick={() => void load(activeId)}
          >
            {t('billingRefresh')}
          </button>
        </div>
      </div>
      {keys.length === 0 ? (
        <div className={styles.balanceHint}>{t('billingBalanceNoKey')}</div>
      ) : state.status === 'loading' ? (
        <div className={styles.balanceHint}>{t('billingBalanceLoading')}</div>
      ) : state.status === 'error' ? (
        <div className={styles.balanceError}>
          {state.message}
          <button type="button" className={styles.linkButton} onClick={() => void load(activeId)}>
            {t('billingBalanceRetry')}
          </button>
        </div>
      ) : state.status === 'done' ? (
        <>
          <div
            className={clsx(styles.balanceValue, !state.data.is_available && styles.balanceLow)}
          >
            {state.data.balance_infos
              .map((info) => formatMoney(Number(info.total_balance), info.currency))
              .join(' / ') || '—'}
          </div>
          <div className={styles.balanceMeta}>
            {state.data.balance_infos
              .map(
                (info) =>
                  `${info.currency} ${t('billingBalanceGranted')} ${formatMoney(
                    Number(info.granted_balance),
                    info.currency
                  )} · ${t('billingBalanceToppedUp')} ${formatMoney(
                    Number(info.topped_up_balance),
                    info.currency
                  )}`
              )
              .join('　')}
            {state.data.is_available ? '' : ` · ${t('billingBalanceUnavailable')}`}
          </div>
        </>
      ) : null}
    </div>
  )
}

export const BillingCenter = () => {
  const t = useTranslate()
  const [range, setRange] = useState<Range>(14)
  const [records, setRecords] = useState<UsageRecord[]>(() => getUsageRecords())
  const [resetOpen, setResetOpen] = useState(false)
  const activeKeyId = useSettings((state) => state.activeKeyId)
  const keyRecords = useMemo(
    () => records.filter((record) => record.keyId === activeKeyId),
    [records, activeKeyId]
  )
  const daily = useMemo(() => aggregateByDay(keyRecords, range), [keyRecords, range])
  const scoped = useMemo(() => {
    const keys = new Set(daily.map((day) => day.key))
    return keyRecords.filter((record) => keys.has(dayKeyOf(record.at)))
  }, [keyRecords, daily])
  const summary = useMemo(() => summarize(scoped), [scoped])
  const speech = useMemo(() => {
    const keys = new Set(daily.map((day) => day.key))
    return summarizeSpeech(
      getSpeechRecords().filter(
        (record) => record.keyId === activeKeyId && keys.has(dayKeyOf(record.at))
      )
    )
  }, [daily, activeKeyId])
  const totalCost = summary.cost + summary.toolCost + speech.cost
  const breakdown = useMemo(() => {
    let hitTokens = 0
    let missTokens = 0
    let outTokens = 0
    let hitCost = 0
    let missCost = 0
    let outCost = 0
    for (const record of scoped) {
      const rate = MODEL_RATES[record.model]
      const factor = isPeak(record.at) ? 2 : 1
      const miss = record.input + record.cacheCreation
      hitTokens += record.cacheRead
      missTokens += miss
      outTokens += record.output
      hitCost += (record.cacheRead * rate.cacheHit * factor) / 1_000_000
      missCost += (miss * rate.cacheMiss * factor) / 1_000_000
      outCost += (record.output * rate.output * factor) / 1_000_000
    }
    return { hitTokens, missTokens, outTokens, hitCost, missCost, outCost }
  }, [scoped])

  const cacheTotal = summary.cacheHit + summary.cacheMiss
  const cacheRate = cacheTotal > 0 ? (summary.cacheHit / cacheTotal) * 100 : 0

  return (
    <div className={styles.billing}>
      <div className={styles.billingHead}>
        <div>
          <div className={styles.label}>{t('billingTitle')}</div>
          <div className={styles.description}>{t('billingSubtitle')}</div>
        </div>
        <div role="tablist" className={styles.segmented}>
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={range === value}
              className={clsx(styles.segment, range === value && styles.segmentActive)}
              onClick={() => setRange(value)}
            >
              {t('billingRange', { days: value })}
            </button>
          ))}
        </div>
      </div>

      <BalanceCard />

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('billingTotalCost')}</div>
          <div className={styles.statValue}>{formatCost(totalCost)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('billingTotalTokens')}</div>
          <div className={styles.statValue}>{formatTokens(summary.tokens)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('billingRequests')}</div>
          <div className={styles.statValue}>{summary.requests}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('billingCacheRate')}</div>
          <div className={styles.statValue}>{cacheRate.toFixed(1)}%</div>
        </div>
      </div>

      {summary.requests === 0 ? (
        <div className={styles.note}>{t('billingEmpty')}</div>
      ) : (
        <>
          <div className={styles.chartCard}>
            <div className={styles.chartHead}>
              <span>{t('billingTokensChart')}</span>
              <Legend />
            </div>
            <TokensChart data={daily} />
          </div>
          <div className={styles.chartCard}>
            <div className={styles.chartHead}>
              <span>{t('billingCostChart')}</span>
              <span className={styles.chartTotal}>{formatCost(summary.cost)}</span>
            </div>
            <CostChart data={daily} />
          </div>

          <div className={styles.breakdown}>
            <div className={clsx(styles.breakdownRow, styles.breakdownHeadRow)}>
              <span>{t('billingType')}</span>
              <span>{t('billingTokens')}</span>
              <span>{t('billingCostColumn')}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingCacheHit')}</span>
              <span>{formatTokens(breakdown.hitTokens)}</span>
              <span>{formatCost(breakdown.hitCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingCacheMiss')}</span>
              <span>{formatTokens(breakdown.missTokens)}</span>
              <span>{formatCost(breakdown.missCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingOutput')}</span>
              <span>{formatTokens(breakdown.outTokens)}</span>
              <span>{formatCost(breakdown.outCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingPeak')}</span>
              <span>—</span>
              <span>{formatCost(summary.peakCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingOffPeak')}</span>
              <span>—</span>
              <span>{formatCost(summary.offPeakCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingByModel')}</span>
              <span>flash / pro</span>
              <span>
                {formatCost(summary.flashCost)} / {formatCost(summary.proCost)}
              </span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingToolCalls')}</span>
              <span>
                {summary.webSearch + summary.webFetch} 次
              </span>
              <span>{formatCost(summary.toolCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingAsr')}</span>
              <span>{(speech.asrMs / 1000).toFixed(1)} s</span>
              <span>{formatCost(speech.asrCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingTts')}</span>
              <span>{speech.ttsChars} 字符</span>
              <span>{formatCost(speech.ttsCost)}</span>
            </div>
            <div className={styles.breakdownRow}>
              <span>{t('billingDocParsing')}</span>
              <span>1.5 元 / 千页</span>
              <span>—</span>
            </div>
            <div className={styles.billingHint}>{t('billingToolsHint')}</div>
          </div>
        </>
      )}

      <div className={styles.dailyCard}>
        <div className={styles.dailyTitle}>{t('billingDailyTitle')}</div>
        <div className={styles.dailyList}>
          {daily.map((day) => (
            <div key={day.key} className={styles.dailyRow}>
              <span className={styles.dailyDate}>{day.key}</span>
              <span className={styles.dailyTokens}>{formatTokens(day.tokens)} tok</span>
              <span className={styles.dailyCost}>{formatCost(day.cost)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.billingFooter}>
        <div className={styles.billingLinks}>
          <a href="https://platform.deepseek.com/top_up" target="_blank" rel="noreferrer">
            {t('billingTopUp')}
          </a>
          <a href="https://platform.deepseek.com/usage" target="_blank" rel="noreferrer">
            {t('billingPlatform')}
          </a>
        </div>
        <Button variant="outlined" size="s" onClick={() => setResetOpen(true)}>
          {t('billingReset')}
        </Button>
      </div>

      {resetOpen ? (
        <Modal
          title={t('billingResetTitle')}
          onClose={() => setResetOpen(false)}
          footer={
            <div className={styles.billingResetActions}>
              <Button variant="outlined" onClick={() => setResetOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  clearUsageRecords(activeKeyId)
                  clearSpeechRecords(activeKeyId)
                  setRecords(getUsageRecords())
                  setResetOpen(false)
                }}
              >
                {t('billingResetConfirm')}
              </Button>
            </div>
          }
        >
          <div className={styles.description}>{t('billingResetDescription')}</div>
        </Modal>
      ) : null}
    </div>
  )
}

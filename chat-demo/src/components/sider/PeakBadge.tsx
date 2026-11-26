import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { MODEL_RATES, isPeak } from '../../services/usage.js'
import { useSettings } from '../../services/settings.js'
import styles from './PeakBadge.module.css'

/** 北京时间平峰/高峰小标签；悬浮显示当前时段刊例价（元/百万 tokens）。 */
export const PeakBadge = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.modelSettings.model)
  const rates = MODEL_RATES[model]
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const peak = isPeak(now)
  const factor = peak ? 2 : 1
  return (
    <div className={clsx(styles.badge, peak ? styles.peak : styles.off)}>
      <span>{peak ? t('peakTime') : t('offPeakTime')}</span>
      <div className={styles.popover} role="tooltip">
        <div className={styles.popoverTitle}>{t('peakPriceTitle')}</div>
        <div className={styles.priceRow}>
          <span>{t('peakPriceCacheHit')}</span>
          <span>¥{(rates.cacheHit * factor).toFixed(2)}</span>
        </div>
        <div className={styles.priceRow}>
          <span>{t('peakPriceMiss')}</span>
          <span>¥{(rates.cacheMiss * factor).toFixed(2)}</span>
        </div>
        <div className={styles.priceRow}>
          <span>{t('peakPriceOutput')}</span>
          <span>¥{(rates.output * factor).toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

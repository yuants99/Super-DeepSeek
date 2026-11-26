import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { extractMemoryFromSession, type MemoryExtractionResult } from '../../services/memory.js'
import { setMe, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/** 会话三点菜单触发的「记忆总结」弹窗：在不写入原会话的前提下提炼记忆并供用户确认覆盖。 */
export const MemorySummaryModal = ({
  sessionId,
  sessionTitle,
  onClose,
}: {
  sessionId: string
  sessionTitle: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const previousMemory = useSettings((state) => state.me.memory)
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState<'memorySummaryNoContext' | 'memorySummaryFailed' | null>(
    null
  )
  const [result, setResult] = useState<MemoryExtractionResult | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setErrorKey(null)
    setResult(null)
    void extractMemoryFromSession(sessionId, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) {
          setResult(res)
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        const message = error instanceof Error ? error.message : ''
        setErrorKey(message === 'NoContext' ? 'memorySummaryNoContext' : 'memorySummaryFailed')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })
    return () => {
      controller.abort()
    }
  }, [sessionId])

  const cancelAndClose = () => {
    controllerRef.current?.abort()
    onClose()
  }

  const confirmOverwrite = () => {
    if (result?.status !== 'updated') {
      return
    }
    setMe({ memory: result.memory })
    showToast({ key: 'meMemoryAppliedToast' })
    onClose()
  }

  return (
    <Modal
      title={`${t('memorySummaryTitle')} · ${sessionTitle}`}
      className={styles.memorySummaryModal}
      onClose={cancelAndClose}
      footer={
        <div className={styles.deleteActions}>
          <Button variant="outlined" onClick={cancelAndClose}>
            {result?.status === 'updated' ? t('memorySummaryCancel') : t('close')}
          </Button>
          {result?.status === 'updated' ? (
            <Button onClick={confirmOverwrite}>{t('memorySummaryConfirm')}</Button>
          ) : null}
        </div>
      }
    >
      {loading ? (
        <div className={styles.memorySummaryStatus}>{t('memorySummaryAnalyzing')}</div>
      ) : errorKey ? (
        <div className={styles.memorySummaryError}>{t(errorKey)}</div>
      ) : result ? (
        <div className={styles.memorySummaryBody}>
          {result.highlights ? (
            <div className={styles.memorySummaryBlock}>
              <div className={styles.personalizationSectionTitle}>
                {t('memorySummaryHighlightsTitle')}
              </div>
              <div className={styles.memorySummaryHighlights}>{result.highlights}</div>
            </div>
          ) : null}
          {result.status === 'updated' ? (
            <div className={styles.memorySummaryBlock}>
              <div className={styles.memoryPreviewHead}>
                <span className={styles.personalizationSectionTitle}>
                  {showOriginal ? t('meMemorySavedBadge') : t('memorySummaryPreviewTitle')}
                </span>
                {previousMemory.trim() ? (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setShowOriginal((value) => !value)}
                  >
                    {showOriginal ? t('meMemoryCompareNew') : t('meMemoryCompareOld')}
                  </button>
                ) : null}
              </div>
              <div className={clsx(styles.meMemoryBox, styles.memorySummaryPreview)}>
                {showOriginal ? previousMemory : result.memory}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { backfillSummaryCounts, loadSessionSummaries } from '../../services/chat/db.js'
import { exportHistory } from '../../services/chat/backup.js'
import { encryptArchive } from '../../services/archiveCrypto.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

type Basis = 'updated' | 'created' | 'rounds'

const dayStart = (value: number) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const roundsOf = (summary: SessionSummary) => Math.max(1, Math.ceil((summary.messageCount ?? 0) / 2))

const timeLabel = (ms: number) => {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const dayBucket = (ms: number, now: number) => {
  const today = dayStart(now)
  if (ms >= today) {
    return 'today'
  }
  if (ms >= today - 6 * 86_400_000) {
    return 'week'
  }
  if (ms >= today - 29 * 86_400_000) {
    return 'month'
  }
  return 'earlier'
}

const roundBucket = (rounds: number) =>
  rounds <= 2 ? 'short' : rounds <= 10 ? 'medium' : rounds <= 30 ? 'long' : 'huge'

/** 导出向导：按活跃/创建时间/轮数分组，支持搜索、多选与是否包含图片。 */
export const ExportDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [basis, setBasis] = useState<Basis>('updated')
  const [query, setQuery] = useState('')
  const [includeImages, setIncludeImages] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [summaries, setSummaries] = useState<SessionSummary[]>(() =>
    useChatStore.getState().sessions
  )
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await backfillSummaryCounts((done, total) => {
        if (!cancelled) {
          setProgress(done < total ? { done, total } : null)
        }
      })
      const list = await loadSessionSummaries()
      if (!cancelled) {
        setSummaries(list)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return summaries.filter((summary) =>
      keyword ? (summary.title ?? '').toLowerCase().includes(keyword) : true
    )
  }, [summaries, query])

  const groups = useMemo(() => {
    const now = Date.now()
    const buckets = new Map<string, SessionSummary[]>()
    for (const summary of filtered) {
      const key =
        basis === 'rounds'
          ? roundBucket(roundsOf(summary))
          : dayBucket(
              basis === 'updated' ? summary.updatedAt : summary.createdAt,
              now
            )
      const list = buckets.get(key)
      if (list) {
        list.push(summary)
      } else {
        buckets.set(key, [summary])
      }
    }
    const definitions =
      basis === 'rounds'
        ? [
            ['short', t('exportRoundsShort')],
            ['medium', t('exportRoundsMedium')],
            ['long', t('exportRoundsLong')],
            ['huge', t('exportRoundsHuge')],
          ]
        : [
            ['today', t('exportGroupToday')],
            ['week', t('exportGroup7')],
            ['month', t('exportGroup30')],
            ['earlier', t('exportGroupEarlier')],
          ]
    const sortValue = (summary: SessionSummary) =>
      basis === 'rounds'
        ? roundsOf(summary)
        : basis === 'updated'
          ? summary.updatedAt
          : summary.createdAt
    return definitions
      .map(([key, label]) => ({
        key: key as string,
        label: label as string,
        items: (buckets.get(key as string) ?? []).sort((a, b) => sortValue(b) - sortValue(a)),
      }))
      .filter((group) => group.items.length > 0)
  }, [filtered, basis, t])

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const setGroup = (items: SessionSummary[], checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      for (const item of items) {
        if (checked) {
          next.add(item.id)
        } else {
          next.delete(item.id)
        }
      }
      return next
    })
  }

  const run = async () => {
    if (selected.size === 0 || busy) {
      return
    }
    if (protect) {
      if (password.length < 6) {
        setPasswordError('short')
        return
      }
      if (password !== confirm) {
        setPasswordError('mismatch')
        return
      }
    }
    setPasswordError(null)
    setBusy(true)
    try {
      const result = await exportHistory({
        sessionIds: [...selected],
        includeImages,
      })
      const blob = protect
        ? await encryptArchive(result.blob, password)
        : result.blob
      const name = protect
        ? result.name.replace(/\.zip$/, '.dsarchive')
        : result.name
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'exportDone', params: { count: selected.size } })
      onClose()
    } catch {
      showToast({ key: 'historyExportFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('exportDialogTitle')}
      className={styles.exportDialog}
      mainClassName={styles.exportMain}
      onClose={busy ? () => {} : onClose}
      footer={
        <div className={styles.exportFooter}>
          <span className={styles.exportCount}>
            {t('exportSelected', { count: selected.size })}
          </span>
          <div className={styles.exportFooterActions}>
            <Button variant="outlined" size="m" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button size="m" disabled={selected.size === 0 || busy} onClick={() => void run()}>
              {busy ? (protect ? t('archiveEncrypting') : t('exportPacking')) : t('exportStart')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.exportToolbar}>
        <Select
          ariaLabel={t('exportGroupBy')}
          value={basis}
          options={[
            { value: 'updated', label: t('exportBasisUpdated') },
            { value: 'created', label: t('exportBasisCreated') },
            { value: 'rounds', label: t('exportBasisRounds') },
          ]}
          onChange={setBasis}
        />
        <input
          className={styles.exportSearch}
          placeholder={t('exportSearchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className={styles.exportToggle} title={t('exportCompactionHint')}>
          <span>{t('exportIncludeImages')}</span>
          <Switch
            checked={includeImages}
            ariaLabel={t('exportIncludeImages')}
            onChange={setIncludeImages}
          />
        </label>
      </div>
      <div className={styles.exportHint}>{t('exportCompactionHint')}</div>
      <div className={styles.exportSecurity}>
        <label className={styles.securityToggle}>
          <Switch
            checked={protect}
            ariaLabel={t('archivePasswordProtect')}
            onChange={(checked) => {
              setProtect(checked)
              setPasswordError(null)
            }}
          />
          <span>{t('archivePasswordProtect')}</span>
        </label>
        {protect ? (
          <div className={styles.passwordFields}>
            <input
              className={styles.exportSearch}
              type="password"
              placeholder={t('archivePassword')}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError(null)
              }}
            />
            <input
              className={styles.exportSearch}
              type="password"
              placeholder={t('archivePasswordConfirm')}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                setPasswordError(null)
              }}
            />
          </div>
        ) : null}
        {protect ? (
          <div className={styles.securityHint}>{t('archivePasswordHint')}</div>
        ) : (
          <div className={styles.securityHint}>{t('archiveNoPasswordHint')}</div>
        )}
        {passwordError ? (
          <div className={styles.profileError}>
            {passwordError === 'short'
              ? t('archivePasswordTooShort')
              : t('archivePasswordMismatch')}
          </div>
        ) : null}
      </div>

      {!ready ? (
        <div className={styles.exportLoading}>
          {progress ? t('exportPreparing', { done: progress.done, total: progress.total }) : t('exportLoading')}
        </div>
      ) : groups.length === 0 ? (
        <div className={styles.exportLoading}>{t('exportEmpty')}</div>
      ) : (
        <div className={styles.exportGroups}>
          {groups.map((group) => {
            const allSelected = group.items.every((item) => selected.has(item.id))
            return (
              <div key={group.key} className={styles.exportGroup}>
                <div className={styles.exportGroupHead}>
                  <span className={styles.exportGroupTitle}>
                    {group.label}（{group.items.length}）
                  </span>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setGroup(group.items, !allSelected)}
                  >
                    {allSelected ? t('exportClear') : t('exportSelectAll')}
                  </button>
                </div>
                {group.items.map((item) => (
                  <label
                    key={item.id}
                    className={clsx(styles.exportRow, selected.has(item.id) && styles.exportRowOn)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span className={styles.exportTitle}>{item.title || t('untitledChat')}</span>
                    <span className={styles.exportMeta}>
                      {t('exportRounds', { count: roundsOf(item) })} ·{' '}
                      {timeLabel(basis === 'created' ? item.createdAt : item.updatedAt)}
                      {item.imageCount ? ` · ${t('exportImages', { count: item.imageCount })}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

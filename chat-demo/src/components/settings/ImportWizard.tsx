import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { mergeImport, useChatStore } from '../../services/chat/store.js'
import { loadSession } from '../../services/chat/db.js'
import {
  scanArchive,
  type ImportDecision,
  type ImportScan,
} from '../../services/chat/history/importArchive.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { decryptArchive, isEncryptedArchive } from '../../services/archiveCrypto.js'
import styles from './Settings.module.css'

type LocalInfo = { count: number; time: number }

const timeLabel = (ms: number) => {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 导入向导：扫描归档 → 展示新增与冲突 → 用户逐项决策 → 按决策写入。 */
export const ImportWizard = ({ file, onClose }: { file: File; onClose: () => void }) => {
  const t = useTranslate()
  const [scan, setScan] = useState<ImportScan | null>(null)
  const [localInfo, setLocalInfo] = useState<Map<string, LocalInfo>>(new Map())
  const [decisions, setDecisions] = useState<Map<string, ImportDecision>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [encrypted, setEncrypted] = useState(false)
  const [decrypting, setDecrypting] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState<'short' | 'wrong' | null>(null)

  useEffect(() => {
    let cancelled = false
    setSourceFile(null)
    setEncrypted(false)
    setScan(null)
    setError(null)
    void isEncryptedArchive(file).then((isEncrypted) => {
      if (cancelled) {
        return
      }
      if (isEncrypted) {
        setEncrypted(true)
      } else {
        setSourceFile(file)
      }
    })
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    if (!sourceFile) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const data = await scanArchive(sourceFile)
        if (cancelled) {
          return
        }
        const local = new Map(useChatStore.getState().sessions.map((item) => [item.id, item]))
        const conflicts = data.sessions.filter((session) => local.has(session.id))
        const infos = await Promise.all(
          conflicts.map(async (session) => {
            const stored = await loadSession(session.id)
            const info: LocalInfo = {
              count: stored?.messages.length ?? local.get(session.id)?.messageCount ?? 0,
              time: stored?.updatedAt ?? local.get(session.id)?.updatedAt ?? 0,
            }
            return [session.id, info] as const
          })
        )
        if (!cancelled) {
          setScan(data)
          setLocalInfo(new Map(infos))
          setDecisions(new Map(conflicts.map((session) => [session.id, 'skip' as ImportDecision])))
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sourceFile])

  const localIds = new Set(useChatStore.getState().sessions.map((item) => item.id))
  const added = scan ? scan.sessions.filter((session) => !localIds.has(session.id)) : []
  const conflicts = scan ? scan.sessions.filter((session) => localIds.has(session.id)) : []

  const setDecision = (id: string, decision: ImportDecision) => {
    setDecisions((previous) => new Map(previous).set(id, decision))
  }

  const setAll = (decision: ImportDecision) => {
    setDecisions(new Map(conflicts.map((session) => [session.id, decision])))
  }

  const unlock = async () => {
    if (password.length < 6) {
      setPasswordError('short')
      return
    }
    setDecrypting(true)
    setPasswordError(null)
    try {
      const blob = await decryptArchive(file, password)
      const name = file.name.replace(/\.dsarchive$/i, '') || 'archive.zip'
      setSourceFile(new File([blob], name.endsWith('.zip') ? name : `${name}.zip`, { type: 'application/zip' }))
      setEncrypted(false)
    } catch (cause) {
      setPasswordError(cause instanceof Error && cause.message === 'wrongPassword' ? 'wrong' : 'short')
    } finally {
      setDecrypting(false)
    }
  }

  const run = async () => {
    if (!scan || busy || !sourceFile) {
      return
    }
    setBusy(true)
    try {
      const result = await mergeImport(sourceFile, decisions)
      showToast({
        key: 'importDone',
        params: { imported: result.imported, skipped: result.skipped },
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('importWizardTitle')}
      className={styles.importDialog}
      mainClassName={styles.importMain}
      onClose={busy ? () => {} : onClose}
      footer={
        <div className={styles.exportFooter}>
          <span className={styles.exportCount}>
            {scan
              ? t('importFooter', { added: added.length, conflicts: conflicts.length })
              : ''}
          </span>
          <div className={styles.exportFooterActions}>
            <Button variant="outlined" size="m" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              size="m"
              disabled={!scan || busy || scan.sessions.length === 0}
              onClick={() => void run()}
            >
              {busy ? t('importApplying') : t('importApply')}
            </Button>
          </div>
        </div>
      }
    >
      {encrypted && !sourceFile ? (
        <div className={styles.archiveUnlock}>
          <div className={styles.importSummary}>{t('archiveEncryptedTitle')}</div>
          <div className={styles.securityHint}>{t('archiveImportPasswordHint')}</div>
          <input
            className={styles.exportSearch}
            type="password"
            autoFocus
            placeholder={t('archivePassword')}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setPasswordError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void unlock()
              }
            }}
          />
          {passwordError ? (
            <div className={styles.profileError}>
              {passwordError === 'short'
                ? t('archivePasswordTooShort')
                : t('archiveWrongPassword')}
            </div>
          ) : null}
          <div>
            <Button disabled={decrypting} onClick={() => void unlock()}>
              {decrypting ? t('archiveDecrypting') : t('archiveUnlock')}
            </Button>
          </div>
        </div>
      ) : error ? (
        <div className={styles.importError}>{error}</div>
      ) : !scan ? (
        <div className={styles.exportLoading}>{t('importScanning')}</div>
      ) : (
        <div className={styles.importBody}>
          <div className={styles.importSummary}>
            {t('importSummary', {
              sessions: scan.sessions.length,
              added: added.length,
              conflicts: conflicts.length,
            })}
            {scan.imageCount > 0
              ? ` · ${t('importImages', { count: scan.imageCount })}`
              : ''}
          </div>

          {added.length > 0 ? (
            <div className={styles.importSection}>
              <div className={styles.importSectionTitle}>
                {t('importNewTitle')}（{added.length}）
              </div>
              <div className={styles.importList}>
                {added.map((session) => (
                  <div key={session.id} className={styles.importRow}>
                    <span className={styles.exportTitle}>
                      {session.title || t('untitledChat')}
                      {session.compacted ? (
                        <span className={styles.importBadge}>{t('importCompactedBadge')}</span>
                      ) : null}
                    </span>
                    <span className={styles.exportMeta}>
                      {t('exportRounds', { count: Math.ceil(session.messageCount / 2) })} ·{' '}
                      {timeLabel(Date.parse(session.updatedAt))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {conflicts.length > 0 ? (
            <div className={styles.importSection}>
              <div className={styles.importSectionTitle}>
                {t('importConflictTitle')}（{conflicts.length}）
              </div>
              <div className={styles.importConflictHint}>{t('importConflictHint')}</div>
              <div className={styles.importBulk}>
                <Button size="s" variant="outlined" onClick={() => setAll('skip')}>
                  {t('importKeepAll')}
                </Button>
                <Button size="s" variant="outlined" onClick={() => setAll('replace')}>
                  {t('importOverwriteAll')}
                </Button>
              </div>
              {conflicts.map((session) => {
                const local = localInfo.get(session.id)
                return (
                  <div key={session.id} className={styles.importConflict}>
                    <div className={styles.importConflictHead}>
                      <span className={styles.exportTitle}>
                        {session.title || t('untitledChat')}
                        {session.compacted ? (
                          <span className={styles.importBadge}>{t('importCompactedBadge')}</span>
                        ) : null}
                      </span>
                      <Select
                        ariaLabel={t('importConflictTitle')}
                        value={decisions.get(session.id) ?? 'skip'}
                        options={[
                          { value: 'skip', label: t('importKeepLocal') },
                          { value: 'replace', label: t('importOverwrite') },
                        ]}
                        onChange={(value) => setDecision(session.id, value)}
                      />
                    </div>
                    <div className={styles.importCompare}>
                      <span>
                        {t('importLocalMeta', {
                          count: local?.count ?? 0,
                          time: local ? timeLabel(local.time) : '—',
                        })}
                      </span>
                      <span>
                        {t('importIncomingMeta', {
                          count: session.messageCount,
                          time: timeLabel(Date.parse(session.updatedAt)),
                        })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className={styles.importConflictHint}>{t('importNoConflicts')}</div>
          )}
        </div>
      )}
    </Modal>
  )
}

import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { exportHistory } from '../../services/chat/backup.js'
import { encryptArchive } from '../../services/archiveCrypto.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import styles from '../settings/Settings.module.css'

/** 单个对话导出：可选密码保护，加密为 .dsarchive。 */
export const SessionExportDialog = ({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<'short' | 'mismatch' | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) {
      return
    }
    if (protect) {
      if (password.length < 6) {
        setError('short')
        return
      }
      if (password !== confirm) {
        setError('mismatch')
        return
      }
    }
    setBusy(true)
    try {
      const result = await exportHistory({ sessionIds: [sessionId], includeImages: true })
      const blob = protect ? await encryptArchive(result.blob, password) : result.blob
      const name = protect ? result.name.replace(/\.zip$/, '.dsarchive') : result.name
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      showToast({ key: 'singleSessionExported' })
      onClose()
    } catch {
      showToast({ key: 'singleSessionExportFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('sessionItemMenuExportOption')}
      className={styles.wipeConfirm}
      onClose={busy ? () => {} : onClose}
      footer={
        <div className={styles.wipeActions}>
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? (protect ? t('archiveEncrypting') : t('exportPacking')) : t('exportStart')}
          </Button>
        </div>
      }
    >
      <div className={styles.exportSecurity}>
        <label className={styles.securityToggle}>
          <Switch
            checked={protect}
            ariaLabel={t('archivePasswordProtect')}
            onChange={(checked) => {
              setProtect(checked)
              setError(null)
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
                setError(null)
              }}
            />
            <input
              className={styles.exportSearch}
              type="password"
              placeholder={t('archivePasswordConfirm')}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                setError(null)
              }}
            />
          </div>
        ) : null}
        <div className={styles.securityHint}>
          {protect ? t('archivePasswordHint') : t('archiveNoPasswordHint')}
        </div>
        {error ? (
          <div className={styles.profileError}>
            {error === 'short' ? t('archivePasswordTooShort') : t('archivePasswordMismatch')}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  createProfile,
  deleteProfile,
  exportProfile,
  importProfile,
  isDefaultProfile,
  renameProfile,
  switchProfile,
  useProfiles,
} from '../../services/profiles.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

type NameDialog = { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null
type ExportDialog = {
  id: string
  includeKeys: boolean
  password: string
  confirm: string
  error: string | null
  busy: boolean
} | null
type ImportDialog = {
  file: File
  password: string
  error: string | null
  busy: boolean
} | null

const download = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 配置式：独立设置空间（主题/语言/音色/位置/模型/Key），加密导出与导入。 */
export const ProfilesPanel = () => {
  const t = useTranslate()
  const profiles = useProfiles((state) => state.profiles)
  const activeId = useProfiles((state) => state.activeId)
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [nameValue, setNameValue] = useState('')
  const [exportDialog, setExportDialog] = useState<ExportDialog>(null)
  const [importDialog, setImportDialog] = useState<ImportDialog>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openCreate = () => {
    setNameValue('')
    setNameDialog({ mode: 'create' })
  }

  const submitName = () => {
    const value = nameValue.trim()
    if (!value) {
      return
    }
    if (nameDialog?.mode === 'create') {
      createProfile(value)
      showToast({ key: 'profilesCreatedToast' })
    } else if (nameDialog?.mode === 'rename') {
      renameProfile(nameDialog.id, value)
    }
    setNameDialog(null)
  }

  const runExport = async () => {
    if (!exportDialog) {
      return
    }
    if (exportDialog.password.length < 6) {
      setExportDialog({ ...exportDialog, error: 'short' })
      return
    }
    if (exportDialog.password !== exportDialog.confirm) {
      setExportDialog({ ...exportDialog, error: 'mismatch' })
      return
    }
    setExportDialog({ ...exportDialog, busy: true, error: null })
    try {
      const { name, blob } = await exportProfile(exportDialog.id, {
        includeKeys: exportDialog.includeKeys,
        password: exportDialog.password,
      })
      download(name, blob)
      showToast({ key: 'profilesExportDone' })
      setExportDialog(null)
    } catch {
      setExportDialog({ ...exportDialog, busy: false, error: 'failed' })
    }
  }

  const runImport = async () => {
    if (!importDialog) {
      return
    }
    if (importDialog.password.length < 6) {
      setImportDialog({ ...importDialog, error: 'short' })
      return
    }
    setImportDialog({ ...importDialog, busy: true, error: null })
    try {
      const profile = await importProfile(importDialog.file, importDialog.password)
      switchProfile(profile.id)
      showToast({ key: 'profilesImportDone' })
      setImportDialog(null)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setImportDialog({
        ...importDialog,
        busy: false,
        error: code === 'wrongPassword' ? 'wrong' : code === 'passwordTooShort' ? 'short' : 'invalid',
      })
    }
  }

  const errorText = (error: string | null) =>
    error === 'short'
      ? t('profilesPasswordTooShort')
      : error === 'mismatch'
        ? t('profilesPasswordMismatch')
        : error === 'wrong'
          ? t('profilesWrongPassword')
          : error === 'invalid'
            ? t('profilesInvalidFile')
            : t('profilesError')

  return (
    <div className={styles.profiles}>
      <div className={styles.profilesHead}>
        <div>
          <div className={styles.label}>{t('profilesTitle')}</div>
          <div className={styles.description}>{t('profilesDescription')}</div>
        </div>
      </div>

      <div className={styles.profileList}>
        {profiles.map((profile) => {
          const active = profile.id === activeId
          return (
            <div key={profile.id} className={styles.profileRow}>
              <button
                type="button"
                className={styles.profileRadio}
                aria-label={t('profilesUse')}
                aria-pressed={active}
                onClick={() => switchProfile(profile.id)}
              >
                {active ? <span className={styles.profileRadioDot} /> : null}
              </button>
              <div className={styles.profileName}>
                <span>{profile.name}</span>
                {isDefaultProfile(profile.id) ? (
                  <span className={styles.profileBadge}>{t('profilesBuiltIn')}</span>
                ) : null}
                {active ? (
                  <span className={styles.profileBadgeActive}>{t('profilesCurrent')}</span>
                ) : null}
              </div>
              <div className={styles.profileActions}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() =>
                    setExportDialog({
                      id: profile.id,
                      includeKeys: true,
                      password: '',
                      confirm: '',
                      error: null,
                      busy: false,
                    })
                  }
                >
                  {t('profilesExport')}
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    setNameValue(profile.name)
                    setNameDialog({ mode: 'rename', id: profile.id, name: profile.name })
                  }}
                >
                  {t('profilesRename')}
                </button>
                {isDefaultProfile(profile.id) ? null : (
                  <button
                    type="button"
                    className={styles.linkButtonDanger}
                    onClick={() => setDeleteTarget(profile.id)}
                  >
                    {t('profilesDelete')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className={styles.profileButtons}>
        <Button size="m" variant="outlined" onClick={openCreate}>
          {t('profilesCreate')}
        </Button>
        <Button size="m" variant="outlined" onClick={() => fileInputRef.current?.click()}>
          {t('profilesImport')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dsprofile,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) {
              setImportDialog({ file, password: '', error: null, busy: false })
            }
          }}
        />
      </div>

      {nameDialog ? (
        <Modal
          title={t(nameDialog.mode === 'create' ? 'profilesCreateTitle' : 'profilesRenameTitle')}
          onClose={() => setNameDialog(null)}
          footer={
            <div className={styles.profileDialogActions}>
              <Button variant="outlined" onClick={() => setNameDialog(null)}>
                {t('cancel')}
              </Button>
              <Button disabled={!nameValue.trim()} onClick={submitName}>
                {t('confirm')}
              </Button>
            </div>
          }
        >
          <input
            className={styles.exportSearch}
            autoFocus
            maxLength={40}
            placeholder={t('profilesNamePlaceholder')}
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitName()
              }
            }}
          />
        </Modal>
      ) : null}

      {exportDialog ? (
        <Modal
          title={t('profilesExportTitle')}
          onClose={() => (exportDialog.busy ? undefined : setExportDialog(null))}
          footer={
            <div className={styles.profileDialogActions}>
              <Button
                variant="outlined"
                disabled={exportDialog.busy}
                onClick={() => setExportDialog(null)}
              >
                {t('cancel')}
              </Button>
              <Button disabled={exportDialog.busy} onClick={() => void runExport()}>
                {exportDialog.busy ? t('profilesExporting') : t('profilesExport')}
              </Button>
            </div>
          }
        >
          <div className={styles.profileField}>
            <div className={styles.profileFieldLabel}>{t('profilesIncludeKeys')}</div>
            <Switch
              checked={exportDialog.includeKeys}
              ariaLabel={t('profilesIncludeKeys')}
              onChange={(checked) => setExportDialog({ ...exportDialog, includeKeys: checked })}
            />
          </div>
          <div className={styles.profileFieldHint}>{t('profilesIncludeKeysHint')}</div>
          <div className={styles.profileField}>
            <div className={styles.profileFieldLabel}>{t('profilesPassword')}</div>
            <input
              className={styles.exportSearch}
              type="password"
              autoFocus
              value={exportDialog.password}
              onChange={(event) =>
                setExportDialog({ ...exportDialog, password: event.target.value, error: null })
              }
            />
          </div>
          <div className={styles.profileField}>
            <div className={styles.profileFieldLabel}>{t('profilesPasswordConfirm')}</div>
            <input
              className={styles.exportSearch}
              type="password"
              value={exportDialog.confirm}
              onChange={(event) =>
                setExportDialog({ ...exportDialog, confirm: event.target.value, error: null })
              }
            />
          </div>
          <div className={styles.profileFieldHint}>{t('profilesPasswordHint')}</div>
          {exportDialog.error ? (
            <div className={styles.profileError}>{errorText(exportDialog.error)}</div>
          ) : null}
        </Modal>
      ) : null}

      {importDialog ? (
        <Modal
          title={t('profilesImportTitle')}
          onClose={() => (importDialog.busy ? undefined : setImportDialog(null))}
          footer={
            <div className={styles.profileDialogActions}>
              <Button
                variant="outlined"
                disabled={importDialog.busy}
                onClick={() => setImportDialog(null)}
              >
                {t('cancel')}
              </Button>
              <Button disabled={importDialog.busy} onClick={() => void runImport()}>
                {importDialog.busy ? t('profilesImporting') : t('profilesImport')}
              </Button>
            </div>
          }
        >
          <div className={styles.profileFieldLabel}>{t('profilesPassword')}</div>
          <input
            className={styles.exportSearch}
            type="password"
            autoFocus
            value={importDialog.password}
            onChange={(event) =>
              setImportDialog({ ...importDialog, password: event.target.value, error: null })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void runImport()
              }
            }}
          />
          <div className={styles.profileFieldHint}>{t('profilesPasswordHint')}</div>
          {importDialog.error ? (
            <div className={styles.profileError}>{errorText(importDialog.error)}</div>
          ) : null}
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('profilesDeleteTitle')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <div className={styles.profileDialogActions}>
              <Button variant="outlined" onClick={() => setDeleteTarget(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteProfile(deleteTarget)
                  setDeleteTarget(null)
                }}
              >
                {t('profilesDelete')}
              </Button>
            </div>
          }
        >
          <div className={styles.description}>{t('profilesDeleteDescription')}</div>
        </Modal>
      ) : null}
    </div>
  )
}

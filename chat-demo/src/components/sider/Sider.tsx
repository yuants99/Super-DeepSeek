import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconPanelLeftOutline16,
  IconPlusOutline16,
  IconProfileOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { importSingleSession, removeSession, useChatStore } from '../../services/chat/store.js'
import { openNewChatSetup } from '../session/newChatSetupState.js'
import { decryptArchive, isEncryptedArchive } from '../../services/archiveCrypto.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { switchProfile, useProfiles } from '../../services/profiles.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { ServiceStatusButton } from './ServiceStatusButton.js'
import { PeakBadge } from './PeakBadge.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const profiles = useProfiles((state) => state.profiles)
  const activeProfileId = useProfiles((state) => state.activeId)
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId)
  const privacyMode = useChatStore((state) => state.privacyMode)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<File | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [decrypting, setDecrypting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const runSingleImport = async (file: File) => {
    setImporting(true)
    try {
      await importSingleSession(file)
      showToast({ key: 'singleSessionImported' })
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : ''
      showToast({
        key: code === 'singleOnly' ? 'singleSessionImportOnly' : 'singleSessionImportFailed',
        type: 'error',
      })
      throw error
    } finally {
      setImporting(false)
    }
  }

  const unlockImport = async () => {
    if (!pendingImport) {
      return
    }
    if (importPassword.length < 6) {
      setImportError('short')
      return
    }
    setDecrypting(true)
    setImportError(null)
    try {
      const blob = await decryptArchive(pendingImport, importPassword)
      const name = pendingImport.name.replace(/\.dsarchive$/i, '') || 'chat.zip'
      const file = new File([blob], name.endsWith('.zip') ? name : `${name}.zip`, {
        type: 'application/zip',
      })
      await runSingleImport(file)
      setPendingImport(null)
      setImportPassword('')
    } catch (error) {
      if (error instanceof Error && error.message === 'singleOnly') {
        setPendingImport(null)
      } else {
        setImportError(error instanceof Error && error.message === 'wrongPassword' ? 'wrong' : 'short')
      }
    } finally {
      setDecrypting(false)
    }
  }
  const profileOptions: MenuOption[] = [
    ...profiles.map((profile) => ({
      key: profile.id,
      label: profile.name,
      icon:
        profile.id === activeProfileId ? (
          <IconCheckOutline16 />
        ) : (
          <span className={styles.profileMenuPlaceholder} />
        ),
      onSelect: () => switchProfile(profile.id),
    })),
    {
      key: 'manage',
      label: t('profilesManage'),
      icon: <IconSettingsOutline16 />,
      onSelect: () => openSettings('profiles'),
    },
  ]
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(() => new Date().setHours(0, 0, 0, 0))
  const groups = useMemo(
    () => groupSessions(sessions.filter((item) => !item.privacy), now, t),
    [sessions, now, t]
  )
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      const dayStart = new Date(time).setHours(0, 0, 0, 0)
      setNow((prev) => (prev === dayStart ? prev : dayStart))
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>
            <span className={styles.wordDeep}>Deep</span>
            <span className={styles.wordSeek}>Seek</span>
          </span>
          <span className={styles.brandRule} aria-hidden />
          <span className={styles.appTagline}>{t('appTagline')}</span>
        </div>
        <div className={styles.topActions}>
          <IconButton
            size="m"
            icon={<IconPlusOutline16 />}
            tooltip={t('importSingleSession')}
            tooltipPlacement="bottom"
            disabled={importing || privacyMode}
            onClick={() => importInputRef.current?.click()}
          />
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="bottom"
            onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
          />
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".zip,.dsarchive,application/zip,application/x-zip-compressed,application/octet-stream"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) {
              return
            }
            if (privacyMode) {
              showToast({ key: 'singleSessionImportPrivacy' })
              return
            }
            void (async () => {
              if (await isEncryptedArchive(file)) {
                setPendingImport(file)
                setImportPassword('')
                setImportError(null)
                return
              }
              try {
                await runSingleImport(file)
              } catch {
                // 错误提示已在 runSingleImport 内处理
              }
            })()
          }}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          closeMobileSider()
          openNewChatSetup()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <ServiceStatusButton />
        <Menu options={profileOptions}>
          {({ toggle }) => (
            <button
              type="button"
              className={styles.profileSwitch}
              title={t('profilesSwitchMenu')}
              onClick={toggle}
            >
              <IconProfileOutline16 />
              <span className={styles.profileSwitchLabel}>{activeProfile?.name ?? ''}</span>
            </button>
          )}
        </Menu>
        <IconButton
          icon={<IconSettingsOutline16 />}
          size="m"
          tooltip={t('settings')}
          onClick={() => openSettings('general')}
        />
        <PeakBadge />
      </div>
      {pendingImport ? (
        <Modal
          title={t('archiveEncryptedTitle')}
          onClose={decrypting ? () => {} : () => setPendingImport(null)}
          footer={
            <div className={styles.importActions}>
              <Button variant="outlined" disabled={decrypting} onClick={() => setPendingImport(null)}>
                {t('cancel')}
              </Button>
              <Button disabled={decrypting} onClick={() => void unlockImport()}>
                {decrypting ? t('archiveDecrypting') : t('archiveUnlock')}
              </Button>
            </div>
          }
        >
          <div className={styles.importPrompt}>
            <div>{t('archiveImportPasswordHint')}</div>
            <input
              className={styles.importPasswordInput}
              type="password"
              autoFocus
              value={importPassword}
              onChange={(event) => {
                setImportPassword(event.target.value)
                setImportError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void unlockImport()
                }
              }}
            />
            {importError ? (
              <div className={styles.importPasswordError}>
                {importError === 'short' ? t('archivePasswordTooShort') : t('archiveWrongPassword')}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}

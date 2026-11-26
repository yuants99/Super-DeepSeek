import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconBillingOutline16,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconInfoOutline16,
  IconKeyOutline16,
  IconMeOutline16,
  IconPersonalizationOutline16,
  IconProfileOutline16,
  IconLightOutline16,
  IconModelOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import { clearHistory, wipeAllData } from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setLocale,
  setPrivacyDefault,
  setWelcomeMessage,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { AboutPanel } from './AboutPanel.js'
import { ApiKeysField } from './ApiKeysField.js'
import { BillingCenter } from './BillingCenter.js'
import { ExportDialog } from './ExportDialog.js'
import { ImportWizard } from './ImportWizard.js'
import { MePanel } from './MePanel.js'
import { ModelSettings } from './ModelSettings.js'
import { ProfilesPanel } from './ProfilesPanel.js'
import { PersonalizationPanel } from './PersonalizationPanel.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：通用设置 / 模型设置 / 计费中心 / API Key / 数据管理。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方。
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  { value: 'profiles', label: 'settingDialogAsideProfilesOptionLabel', icon: <IconProfileOutline16 /> },
  { value: 'general', label: 'settingDialogAsideGeneralOptionLabel', icon: <IconSettingsOutline16 /> },
  { value: 'me', label: 'settingDialogAsideMeOptionLabel', icon: <IconMeOutline16 /> },
  {
    value: 'personalization',
    label: 'settingDialogAsidePersonalizationOptionLabel',
    icon: <IconPersonalizationOutline16 />,
  },
  { value: 'model', label: 'settingDialogAsideModelOptionLabel', icon: <IconModelOutline16 /> },
  { value: 'billing', label: 'settingDialogAsideBillingOptionLabel', icon: <IconBillingOutline16 /> },
  { value: 'keys', label: 'settingDialogAsideKeysOptionLabel', icon: <IconKeyOutline16 /> },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  { value: 'about', label: 'settingDialogAsideAboutOptionLabel', icon: <IconInfoOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const [exportOpen, setExportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [wipeOpen, setWipeOpen] = useState(false)
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const sessionCount = useChatStore((state) => state.sessions.length)
  const privacyMode = useChatStore((state) => state.privacyMode)
  const privacyDefault = useSettings((state) => state.privacyDefault)
  const historyBusy = historyDelete.busy || replacingHistory

  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'profiles' ? (
            <ProfilesPanel />
          ) : section === 'me' ? (
            <MePanel />
          ) : section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <WelcomeSetting />
            </>
          ) : section === 'personalization' ? (
            <PersonalizationPanel />
          ) : section === 'model' ? (
            <ModelSettings />
          ) : section === 'billing' ? (
            <BillingCenter />
          ) : section === 'keys' ? (
            <ApiKeysField />
          ) : section === 'about' ? (
            <AboutPanel />
          ) : (
            <>
              <SettingCell
                label={t('privacyDefaultLabel')}
                description={t('privacyDefaultDescription')}
                status={null}
                action={
                  <Switch
                    checked={privacyDefault}
                    ariaLabel={t('privacyDefaultLabel')}
                    onChange={setPrivacyDefault}
                  />
                }
              />
              <ImportHistory disabled={historyBusy || privacyMode} onSelect={setImportFile} />
              <ExportHistory
                disabled={historyBusy || privacyMode}
                empty={sessionCount === 0}
                onOpen={() => setExportOpen(true)}
              />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              <SettingCell
                label={t('clearAllData')}
                description={t('clearAllDataDescription')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={() => setWipeOpen(true)}
                  >
                    {t('clearAllData')}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </Modal>
      {exportOpen ? <ExportDialog onClose={() => setExportOpen(false)} /> : null}
      {importFile ? <ImportWizard file={importFile} onClose={() => setImportFile(null)} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
      {wipeOpen ? <WipeAllConfirm onClose={() => setWipeOpen(false)} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}


/** 清除所有数据：列出后果、红色不可恢复提示，10 秒倒计时后才能确认。 */
const WipeAllConfirm = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [seconds, setSeconds] = useState(10)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (seconds <= 0) {
      return
    }
    const timer = setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [seconds])

  const run = async () => {
    setBusy(true)
    try {
      await wipeAllData()
    } catch {
      setBusy(false)
      showToast({ key: 'clearAllDataFailed', type: 'error' })
    }
  }

  return (
    <Modal
      title={t('clearAllDataTitle')}
      className={styles.wipeConfirm}
      onClose={busy ? () => {} : onClose}
      footer={
        <div className={styles.wipeActions}>
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="danger" disabled={busy || seconds > 0} onClick={() => void run()}>
            {busy
              ? t('clearAllDataBusy')
              : seconds > 0
                ? t('clearAllDataCountdown', { seconds })
                : t('clearAllDataButton')}
          </Button>
        </div>
      }
    >
      <div className={styles.wipeBody}>
        <p>{t('clearAllDataWarning')}</p>
        <ul className={styles.wipeList}>
          <li>{t('clearAllDataConversations')}</li>
          <li>{t('clearAllDataKeys')}</li>
          <li>{t('clearAllDataProfiles')}</li>
          <li>{t('clearAllDataSettings')}</li>
          <li>{t('clearAllDataBilling')}</li>
        </ul>
        <p className={styles.wipeIrreversible}>{t('clearAllDataIrreversible')}</p>
      </div>
    </Modal>
  )
}

const WelcomeSetting = () => {
  const t = useTranslate()
  const welcomeMessage = useSettings((state) => state.welcomeMessage)
  return (
    <SettingCell
      label={t('welcomeCustomLabel')}
      description={t('welcomeCustomDescription')}
      status={null}
      className={styles.welcomeCell}
      action={
        <div className={styles.welcomeEditor}>
          <input
            className={styles.welcomeInput}
            maxLength={160}
            value={welcomeMessage ?? ''}
            placeholder={t('welcomeMessageChat250808')}
            onChange={(event) => setWelcomeMessage(event.target.value)}
          />
          <Button
            variant="outlined"
            size="s"
            disabled={!welcomeMessage}
            onClick={() => setWelcomeMessage(null)}
          >
            {t('welcomeReset')}
          </Button>
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  { value: 'light', label: 'avatarMenuSettingsDialogThemeSelectLightOption', icon: <IconLightOutline16 /> },
  { value: 'dark', label: 'avatarMenuSettingsDialogThemeSelectDarkOption', icon: <IconDarkOutline16 /> },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/** 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

const SettingCell = ({
  label,
  description,
  action,
  className,
}: {
  label: string
  description?: string
  status: null
  action: ReactNode
  className?: string
}) => (
  <div className={clsx(styles.cell, styles.row, className)}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
    {action}
  </div>
)

const ImportHistory = ({
  onSelect,
  disabled,
}: {
  onSelect: (file: File) => void
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={null}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.dsarchive,application/zip,application/x-zip-compressed,application/octet-stream"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                onSelect(file)
              }
            }}
          />
        </>
      }
    />
  )
}

const ExportHistory = ({
  onOpen,
  disabled,
  empty,
}: {
  onOpen: () => void
  disabled: boolean
  empty: boolean
}) => {
  const t = useTranslate()
  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={null}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || empty}
          onClick={onOpen}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

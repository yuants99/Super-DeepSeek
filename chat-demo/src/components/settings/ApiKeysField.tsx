import { useState } from 'react'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconCheckOutline16, IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  API_KEY_LIMIT,
  API_KEY_TAG_LIMIT,
  activateApiKey,
  addApiKey,
  removeApiKey,
  updateApiKey,
  useSettings,
} from '../../services/settings.js'
import styles from './Settings.module.css'

const maskKey = (key: string) =>
  key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : '••••••'

/** API Key 管理：多 Key 列表 + 标签 + 新增/编辑/删除/设为当前。 */
export const ApiKeysField = () => {
  const t = useTranslate()
  const keys = useSettings((state) => state.apiKeys)
  const activeId = useSettings((state) => state.activeKeyId)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [tag, setTag] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const [showOnboard, setShowOnboard] = useState(() => {
    try {
      return localStorage.getItem('chat-demo:onboard-hint') !== '1'
    } catch {
      return true
    }
  })

  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const startNew = () => {
    setEditingId('new')
    setTag('')
    setValue('')
    setFailure(null)
  }

  const startEdit = (id: string, currentTag: string, currentKey: string) => {
    setEditingId(id)
    setTag(currentTag)
    setValue(currentKey)
    setFailure(null)
  }

  const save = async () => {
    const trimmed = value.trim()
    if (!trimmed || busy) {
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await verifyApiKey(trimmed)
      if (editingId === 'new') {
        addApiKey(tag, trimmed)
      } else if (editingId) {
        updateApiKey(editingId, { tag, key: trimmed })
      }
      setEditingId(null)
      setTag('')
      setValue('')
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setBusy(false)
    }
  }

  const dismissOnboard = () => {
    setShowOnboard(false)
    try {
      localStorage.setItem('chat-demo:onboard-hint', '1')
    } catch {
      // 忽略存储异常
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.keySection}>
        <div className={styles.keyHeader}>
          <div className={styles.label}>{t('keysTitle')}</div>
          <span className={styles.description}>{t('keysDescription')}</span>
        </div>

        {showOnboard && keys.length === 0 ? (
          <div className={styles.onboard}>
            <div className={styles.onboardText}>{t('onboardingHint')}</div>
            <div className={styles.onboardActions}>
              <a
                className={styles.linkButton}
                href="https://platform.deepseek.com/top_up"
                target="_blank"
                rel="noreferrer"
              >
                {t('onboardingLink')}
              </a>
              <button type="button" className={styles.linkButton} onClick={dismissOnboard}>
                {t('onboardingDismiss')}
              </button>
            </div>
          </div>
        ) : null}

        {keys.length === 0 && editingId !== 'new' ? (
          <div className={styles.emptyHint}>{t('keysEmpty')}</div>
        ) : null}

        <div className={styles.keyList}>
          {keys.map((entry) => {
            const active = entry.id === activeId
            return (
              <div key={entry.id} className={styles.keyRow}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={t('keysActive')}
                  className={clsxRadio(active)}
                  onClick={() => activateApiKey(entry.id)}
                >
                  {active ? <IconCheckOutline16 /> : null}
                </button>
                <div className={styles.keyInfo}>
                  <div className={styles.keyTagLine}>
                    <span className={styles.keyTag}>{entry.tag}</span>
                    {active ? <span className={styles.keyBadge}>{t('keysActive')}</span> : null}
                  </div>
                  <span className={styles.keyMask}>{maskKey(entry.key)}</span>
                </div>
                <div className={styles.keyActions}>
                  <IconButton
                    icon={<IconEditOutline16 />}
                    tooltip={t('apiKeyEdit')}
                    onClick={() => startEdit(entry.id, entry.tag, entry.key)}
                  />
                  <IconButton
                    icon={<IconTrashOutline16 />}
                    tooltip={t('delete')}
                    disabled={keys.length <= 1}
                    onClick={() => removeApiKey(entry.id)}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {editingId ? (
          <div className={styles.keyEditor}>
            <input
              className={styles.input}
              placeholder={t('keysTagPlaceholder')}
              maxLength={API_KEY_TAG_LIMIT}
              value={tag}
              autoFocus
              onChange={(event) => setTag(event.target.value)}
            />
            <input
              className={styles.input}
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void save()
                }
              }}
            />
            <div className={styles.keyEditorActions}>
              <Button size="s" disabled={busy || !value.trim()} onClick={() => void save()}>
                {busy ? t('apiKeyVerifying') : t('keysSave')}
              </Button>
              <Button size="s" variant="outlined" onClick={() => setEditingId(null)}>
                {t('cancel')}
              </Button>
            </div>
            {error ? <div className={styles.error}>{error}</div> : null}
          </div>
        ) : (
          <div className={styles.keyAddRow}>
            <Button
              size="s"
              variant="outlined"
              disabled={keys.length >= API_KEY_LIMIT}
              onClick={startNew}
            >
              {t('keysAdd')}
            </Button>
            <span className={styles.fieldHint}>{t('keysLimit')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const clsxRadio = (active: boolean) =>
  active ? `${styles.keyRadio} ${styles.keyRadioActive}` : styles.keyRadio

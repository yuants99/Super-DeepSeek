import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import {
  DEFAULT_SYSTEM_PROMPT,
  useSettings,
  type SafetyLevel,
} from '../../services/settings.js'
import { loadSession } from '../../services/chat/db.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import {
  beginConfiguredNewChat,
  captureChatSettings,
  patchSessionChatSettings,
  useChatStore,
} from '../../services/chat/store.js'
import type { Session, SessionChatSettings } from '../../services/chat/types.js'
import { MODEL_RATES, isPeak } from '../../services/usage.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { closeNewChatSetup, useNewChatSetup } from './newChatSetupState.js'
import styles from './SessionSettings.module.css'

const formatNumber = (value: number) => String(value)

const formatTime = (ms: number) => {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 单个对话的设置：行为、系统提示词、个性化、个人信息与基础统计。 */
export const SessionSettingsDialog = ({
  sessionId,
  onClose,
}: {
  sessionId: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const cached = useChatStore((state) => state.sessionCache[sessionId])
  const settings = useSettings((state) => state.modelSettings)
  const apiKeys = useSettings((state) => state.apiKeys)
  const activeKeyId = useSettings((state) => state.activeKeyId)
  const thinking = useSettings((state) => state.thinking)
  const thinkingEffort = useSettings((state) => state.thinkingEffort)
  const search = useSettings((state) => state.search)
  const meEnabled = useSettings((state) => state.me.enabled)
  const [loaded, setLoaded] = useState<Session | null>(cached ?? null)

  useEffect(() => {
    if (cached) {
      setLoaded(cached)
      return
    }
    let cancelled = false
    void loadSession(sessionId).then((session) => {
      if (!cancelled) {
        setLoaded(session ?? null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cached, sessionId])

  const session = cached ?? loaded
  const chat: SessionChatSettings = session?.chatSettings ?? {
    thinking,
    thinkingEffort,
    search,
    systemPrompt: settings.systemPrompt,
    safety: { ...settings.safety },
    activeKeyId,
    personalization: settings.personalization.enabled,
    personalInfo: meEnabled,
  }

  const update = (patch: Partial<SessionChatSettings>) => {
    void patchSessionChatSettings(sessionId, patch)
  }

  const stats = useMemo(() => {
    if (!session) {
      return { rounds: 0, tokens: 0, tools: 0, cost: 0 }
    }
    const path = getVisibleMessages(session)
    let rounds = 0
    let tokens = 0
    let tools = 0
    let cost = 0
    for (const message of path) {
      if (message.role === 'user') {
        rounds += 1
        continue
      }
      tools +=
        (message.usage?.server_tool_use?.web_search_requests ?? 0) +
        (message.usage?.server_tool_use?.web_fetch_requests ?? 0) +
        (message.usage?.server_tool_use?.tool_search ?? 0) +
        (message.usage?.server_tool_use?.tool_fetch ?? 0)
      if (!message.usage) {
        continue
      }
      const usage = message.usage
      tokens +=
        usage.input_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens +
        usage.output_tokens
      const rate = MODEL_RATES[message.model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash']
      const factor = isPeak(message.createdAt) ? 2 : 1
      cost +=
        ((usage.cache_read_input_tokens * rate.cacheHit +
          (usage.input_tokens + usage.cache_creation_input_tokens) * rate.cacheMiss +
          usage.output_tokens * rate.output) *
          factor) /
        1_000_000
    }
    return { rounds, tokens, tools, cost }
  }, [session])

  return (
    <Modal
      title={t('sessionSettingsTitle')}
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <span className={styles.autoSave}>{t('sessionSettingsAutoSave')}</span>
          <Button onClick={onClose}>{t('sessionSettingsClose')}</Button>
        </div>
      }
    >
      {!session ? (
        <div className={styles.loading}>{t('sessionLoading')}</div>
      ) : (
        <div className={styles.body}>
          <div className={styles.hero}>
            <div className={styles.heroTitle}>{session.title || t('untitledChat')}</div>
            <div className={styles.heroMeta}>
              {t('sessionSettingsHeroMeta', {
                rounds: stats.rounds,
                time: formatTime(session.updatedAt),
              })}
            </div>
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span>{t('sessionSettingsStatRounds')}</span>
              <strong>{stats.rounds}</strong>
            </div>
            <div className={styles.stat}>
              <span>{t('sessionSettingsStatTokens')}</span>
              <strong>{formatNumber(stats.tokens)}</strong>
            </div>
            <div className={styles.stat}>
              <span>{t('sessionSettingsStatTools')}</span>
              <strong>{stats.tools}</strong>
            </div>
            <div className={styles.stat}>
              <span>{t('sessionSettingsStatCost')}</span>
              <strong>¥{stats.cost.toFixed(2)}</strong>
            </div>
          </div>

          <SessionSettingsFields
            chat={chat}
            presets={settings.presets}
            apiKeys={apiKeys}
            personalizationMasterEnabled={settings.personalization.enabled}
            meMasterEnabled={meEnabled}
            onUpdate={update}
          />
        </div>
      )}
    </Modal>
  )
}

/** 点击“开启新对话”时先打开的新对话配置弹窗：不展示顶部消耗统计行，确认后绑定到本次新对话。 */
export const NewChatSettingsModal = () => {
  const open = useNewChatSetup((state) => state.open)
  return open ? <NewChatSettingsContent /> : null
}

const NewChatSettingsContent = () => {
  const t = useTranslate()
  const presets = useSettings((state) => state.modelSettings.presets)
  const apiKeys = useSettings((state) => state.apiKeys)
  const personalizationMasterEnabled = useSettings((state) => state.modelSettings.personalization.enabled)
  const meMasterEnabled = useSettings((state) => state.me.enabled)
  const [draft, setDraft] = useState<SessionChatSettings>(() => captureChatSettings())

  const update = (patch: Partial<SessionChatSettings>) => {
    setDraft((prev) => ({
      ...prev,
      ...patch,
      safety: patch.safety ? { ...prev.safety, ...patch.safety } : prev.safety,
    }))
  }

  const start = () => {
    beginConfiguredNewChat(draft)
    closeNewChatSetup()
  }

  return (
    <Modal
      title={t('newChatSetupTitle')}
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={closeNewChatSetup}
      footer={
        <div className={styles.footer}>
          <span className={styles.autoSave}>{t('newChatSetupHint')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outlined" onClick={closeNewChatSetup}>
              {t('cancel')}
            </Button>
            <Button onClick={start}>{t('newChatSetupStart')}</Button>
          </div>
        </div>
      }
    >
      <div className={styles.body}>
        <SessionSettingsFields
          chat={draft}
          presets={presets}
          apiKeys={apiKeys}
          personalizationMasterEnabled={personalizationMasterEnabled}
          meMasterEnabled={meMasterEnabled}
          onUpdate={update}
        />
      </div>
    </Modal>
  )
}

const SessionSettingsFields = ({
  chat,
  presets,
  apiKeys,
  personalizationMasterEnabled,
  meMasterEnabled,
  onUpdate,
}: {
  chat: SessionChatSettings
  presets: { id: string; name: string; text: string }[]
  apiKeys: { id: string; tag: string }[]
  personalizationMasterEnabled: boolean
  meMasterEnabled: boolean
  onUpdate: (patch: Partial<SessionChatSettings>) => void
}) => {
  const t = useTranslate()

  const promptOptions = [
    { value: 'default', label: t('sessionSettingsPromptDefault') },
    ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
    ...(chat.systemPrompt !== DEFAULT_SYSTEM_PROMPT &&
    !presets.some((preset) => preset.text === chat.systemPrompt)
      ? [{ value: 'custom', label: t('sessionSettingsPromptCustom') }]
      : []),
  ]
  const promptValue =
    chat.systemPrompt === DEFAULT_SYSTEM_PROMPT
      ? 'default'
      : (presets.find((preset) => preset.text === chat.systemPrompt)?.id ?? 'custom')

  const setPrompt = (value: string) => {
    if (value === 'custom') {
      return
    }
    onUpdate({
      systemPrompt:
        value === 'default'
          ? DEFAULT_SYSTEM_PROMPT
          : (presets.find((preset) => preset.id === value)?.text ?? DEFAULT_SYSTEM_PROMPT),
    })
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionTitle}>{t('sessionSettingsBehavior')}</div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsThinking')}</div>
            <div className={styles.rowHint}>{t('sessionSettingsThinkingHint')}</div>
          </div>
          <div className={styles.segmented}>
            {(
              [
                ['off', t('quickThinkingMenuOff')],
                ['low', t('quickThinkingLow')],
                ['high', t('quickThinkingHigh')],
                ['max', t('quickThinkingMax')],
              ] as const
            ).map(([value, label]) => {
              const active =
                value === 'off'
                  ? !chat.thinking
                  : chat.thinking && chat.thinkingEffort === value
              return (
                <button
                  key={value}
                  type="button"
                  className={clsx(
                    styles.segment,
                    active && styles.segmentActive,
                    active && value === 'low' && styles.toneLow,
                    active && value === 'max' && styles.toneMax
                  )}
                  onClick={() =>
                    onUpdate(
                      value === 'off'
                        ? { thinking: false }
                        : { thinking: true, thinkingEffort: value }
                    )
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsSearch')}</div>
            <div className={styles.rowHint}>{t('sessionSettingsSearchHint')}</div>
          </div>
          <Switch
            checked={chat.search}
            ariaLabel={t('sessionSettingsSearch')}
            onChange={(search) => onUpdate({ search })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsSafety')}</div>
            <div className={styles.rowHint}>{t('sessionSettingsSafetyHint')}</div>
          </div>
          <div className={styles.segmented}>
            {(
              [
                ['off', t('quickSafetyOff')],
                ['low', t('quickSafetyLow')],
                ['high', t('quickSafetyHigh')],
              ] as const
            ).map(([value, label]) => {
              const active =
                value === 'off'
                  ? !chat.safety.enabled
                  : chat.safety.enabled && chat.safety.level === value
              return (
                <button
                  key={value}
                  type="button"
                  className={clsx(styles.segment, active && styles.segmentActive)}
                  onClick={() =>
                    onUpdate(
                      value === 'off'
                        ? { safety: { ...chat.safety, enabled: false } }
                        : { safety: { enabled: true, level: value as SafetyLevel } }
                    )
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsKey')}</div>
            <div className={styles.rowHint}>{t('sessionSettingsKeyHint')}</div>
          </div>
          <Select
            ariaLabel={t('sessionSettingsKey')}
            value={chat.activeKeyId ?? ''}
            placeholder={t('sessionSettingsKeyPlaceholder')}
            options={apiKeys.map((entry) => ({ value: entry.id, label: entry.tag }))}
            onChange={(activeKeyId) => onUpdate({ activeKeyId })}
          />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>{t('sessionSettingsPrompt')}</div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsPromptChoice')}</div>
            <div className={styles.rowHint}>{t('sessionSettingsPromptHint')}</div>
          </div>
          <Select
            ariaLabel={t('sessionSettingsPromptChoice')}
            value={promptValue}
            options={promptOptions}
            onChange={setPrompt}
          />
        </div>
        <div className={styles.promptPreview}>{chat.systemPrompt}</div>
      </section>

      <section className={styles.section}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsPersonalization')}</div>
            <div className={styles.rowHint}>
              {personalizationMasterEnabled
                ? t('sessionSettingsPersonalizationHint')
                : t('sessionSettingsPersonalizationMasterOff')}
            </div>
          </div>
          <Switch
            checked={chat.personalization}
            ariaLabel={t('sessionSettingsPersonalization')}
            onChange={(personalization) => onUpdate({ personalization })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>{t('sessionSettingsPersonalInfo')}</div>
            <div className={styles.rowHint}>
              {meMasterEnabled
                ? t('sessionSettingsPersonalInfoHint')
                : t('sessionSettingsPersonalInfoMasterOff')}
            </div>
          </div>
          <Switch
            checked={chat.personalInfo ?? meMasterEnabled}
            ariaLabel={t('sessionSettingsPersonalInfo')}
            onChange={(personalInfo) => onUpdate({ personalInfo })}
          />
        </div>
      </section>
    </>
  )
}

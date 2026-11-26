import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { CompressionLevel } from '../../services/settings.js'
import {
  PRESET_LIMIT,
  PRESET_NAME_LIMIT,
  SYSTEM_PROMPT_LIMIT,
  deletePreset,
  resetSampling,
  resetSystemPrompt,
  savePreset,
  setCompression,
  setModel,
  setReminder,
  setSafety,
  setSampling,
  setSystemPrompt,
  useSettings,
} from '../../services/settings.js'
import { createLatestReminder, weekdayName } from '../../services/chat/latestReminder.js'
import { formatDate } from '../../utils/format.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { VoiceInputButton } from '../base/VoiceInputButton.js'
import styles from './Settings.module.css'

type ModelTab = 'prompt' | 'context' | 'safety' | 'sampling' | 'model' | 'reminder'

const tabs: { value: ModelTab; label: TranslationKey }[] = [
  { value: 'prompt', label: 'modelTabPrompt' },
  { value: 'context', label: 'modelTabContext' },
  { value: 'safety', label: 'modelTabSafety' },
  { value: 'sampling', label: 'modelTabSampling' },
  { value: 'model', label: 'modelTabModel' },
  { value: 'reminder', label: 'modelTabReminder' },
]

/** 模型设置：系统提示词 / 上下文压缩 / 安全 / 采样 / 模型 / 用户元数据 六个子选项卡。 */
export const ModelSettings = () => {
  const t = useTranslate()
  const [tab, setTab] = useState<ModelTab>('prompt')
  return (
    <div className={styles.modelSettings}>
      <div
        role="tablist"
        aria-label={t('settingDialogAsideModelOptionLabel')}
        className={styles.modelTabs}
      >
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={clsx(styles.modelTab, tab === item.value && styles.modelTabActive)}
            onClick={() => setTab(item.value)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className={styles.panel}>
        {tab === 'prompt' ? <PromptPanel /> : null}
        {tab === 'context' ? <ContextPanel /> : null}
        {tab === 'safety' ? <SafetyPanel /> : null}
        {tab === 'sampling' ? <SamplingPanel /> : null}
        {tab === 'model' ? <ModelPanel /> : null}
        {tab === 'reminder' ? <ReminderPanel /> : null}
      </div>
    </div>
  )
}

const Row = ({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) => (
  <div className={clsx(styles.cell, styles.row)}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
    {children}
  </div>
)


const compressionOptions: {
  value: CompressionLevel
  label: TranslationKey
  description: TranslationKey
}[] = [
  { value: 'light', label: 'compressionLight', description: 'compressionLightDesc' },
  { value: 'balanced', label: 'compressionBalanced', description: 'compressionBalancedDesc' },
  { value: 'aggressive', label: 'compressionAggressive', description: 'compressionAggressiveDesc' },
]

/** 上下文压缩档位：保留轮数与摘要比例不同，通过注入的摘要提示词生效。 */
const ContextPanel = () => {
  const t = useTranslate()
  const compression = useSettings((state) => state.modelSettings.compression)
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.label}>{t('compressionTitle')}</div>
          <div className={styles.description}>{t('compressionHint')}</div>
        </div>
      </div>
      <div role="radiogroup" aria-label={t('compressionTitle')} className={styles.compressionOptions}>
        {compressionOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={compression === option.value}
            className={clsx(
              styles.compressionOption,
              compression === option.value && styles.compressionOptionActive
            )}
            onClick={() => setCompression(option.value)}
          >
            <span className={styles.compressionName}>{t(option.label)}</span>
            <span className={styles.compressionDescription}>{t(option.description)}</span>
          </button>
        ))}
      </div>
      <div className={styles.compressionHint}>{t('compressionBudgetHint')}</div>
    </div>
  )
}

const PromptPanel = () => {
  const t = useTranslate()
  const settings = useSettings((state) => state.modelSettings)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const full = settings.systemPrompt.length >= SYSTEM_PROMPT_LIMIT

  const save = () => {
    if (!name.trim()) {
      return
    }
    savePreset(name, settings.systemPrompt)
    setName('')
    setNaming(false)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.label}>{t('modelSystemPromptLabel')}</div>
          <div className={styles.description}>{t('modelSystemPromptDescription')}</div>
        </div>
        <div className={styles.panelHeadActions}>
          <VoiceInputButton
            onText={(text) =>
              setSystemPrompt(
                `${settings.systemPrompt}${settings.systemPrompt.trim() ? '\n' : ''}${text}`
              )
            }
          />
          <span className={clsx(styles.counter, full && styles.counterLimit)}>
            {settings.systemPrompt.length}/{SYSTEM_PROMPT_LIMIT}
          </span>
        </div>
      </div>
      <textarea
        className={styles.promptArea}
        rows={7}
        maxLength={SYSTEM_PROMPT_LIMIT}
        spellCheck={false}
        value={settings.systemPrompt}
        aria-label={t('modelSystemPromptLabel')}
        onChange={(event) => setSystemPrompt(event.target.value)}
      />
      <div className={styles.panelActions}>
        <Button size="s" variant="outlined" onClick={resetSystemPrompt}>
          {t('modelPromptReset')}
        </Button>
        <Button
          size="s"
          variant="outlined"
          disabled={settings.presets.length >= PRESET_LIMIT || !settings.systemPrompt.trim()}
          onClick={() => {
            setName('')
            setNaming(true)
          }}
        >
          {t('modelPromptSavePreset')}
        </Button>
        <span className={styles.hint}>
          {t('modelPresetCount', { count: settings.presets.length, limit: PRESET_LIMIT })}
        </span>
      </div>
      {naming ? (
        <div className={styles.saveRow}>
          <input
            className={styles.input}
            autoFocus
            maxLength={PRESET_NAME_LIMIT}
            placeholder={t('modelPresetName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                save()
              } else if (event.key === 'Escape') {
                setNaming(false)
              }
            }}
          />
          <Button size="s" disabled={!name.trim()} onClick={save}>
            {t('modelPresetSave')}
          </Button>
          <Button size="s" variant="outlined" onClick={() => setNaming(false)}>
            {t('cancel')}
          </Button>
        </div>
      ) : null}
      <div className={styles.presetList}>
        {settings.presets.length === 0 ? (
          <div className={styles.emptyHint}>{t('modelPresetEmpty')}</div>
        ) : (
          settings.presets.map((preset) => (
            <div key={preset.id} className={styles.presetChip}>
              <button
                type="button"
                className={styles.presetApply}
                title={preset.text}
                onClick={() => setSystemPrompt(preset.text)}
              >
                {preset.name}
              </button>
              <button
                type="button"
                className={styles.presetRemove}
                aria-label={t('modelPresetDelete', { name: preset.name })}
                onClick={() => deletePreset(preset.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const SafetyPanel = () => {
  const t = useTranslate()
  const safety = useSettings((state) => state.modelSettings.safety)
  return (
    <div className={styles.panel}>
      <Row label={t('modelSafetyLabel')} description={t('modelSafetyDescription')}>
        <Switch
          checked={safety.enabled}
          ariaLabel={t('modelSafetyLabel')}
          onChange={(enabled) => setSafety({ enabled })}
        />
      </Row>
      {safety.enabled ? (
        <Row label={t('modelSafetyLevel')} description={t('modelSafetyLevelDescription')}>
          <div role="radiogroup" className={styles.segmented}>
            {(['low', 'high'] as const).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={safety.level === level}
                className={clsx(styles.segment, safety.level === level && styles.segmentActive)}
                onClick={() => setSafety({ level })}
              >
                {t(level === 'low' ? 'modelSafetyLow' : 'modelSafetyHigh')}
              </button>
            ))}
          </div>
        </Row>
      ) : (
        <div className={styles.note}>{t('modelSafetyOffNote')}</div>
      )}
    </div>
  )
}

const NumberField = ({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onCommit: (value: number) => void
}) => {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = () => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    setText(String(clamped))
    onCommit(clamped)
  }

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        className={styles.numberInput}
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

const SamplingPanel = () => {
  const t = useTranslate()
  const sampling = useSettings((state) => state.modelSettings.sampling)
  return (
    <div className={styles.panel}>
      <Row label={t('modelSamplingLabel')} description={t('modelSamplingDescription')}>
        <Switch
          checked={sampling.enabled}
          ariaLabel={t('modelSamplingLabel')}
          onChange={(enabled) => setSampling({ enabled })}
        />
      </Row>
      <div className={clsx(styles.numberGrid, !sampling.enabled && styles.disabledGroup)}>
        <NumberField
          label={t('modelTemperature')}
          value={sampling.temperature}
          min={0}
          max={2}
          step={0.1}
          disabled={!sampling.enabled}
          onCommit={(temperature) => setSampling({ temperature })}
        />
        <NumberField
          label={t('modelTopP')}
          value={sampling.topP}
          min={0}
          max={1}
          step={0.05}
          disabled={!sampling.enabled}
          onCommit={(topP) => setSampling({ topP })}
        />
        <NumberField
          label={t('modelTopK')}
          value={sampling.topK}
          min={0}
          max={100}
          step={1}
          disabled={!sampling.enabled}
          onCommit={(topK) => setSampling({ topK })}
        />
        <NumberField
          label={t('modelMaxTokens')}
          value={sampling.maxTokens}
          min={1}
          max={65536}
          step={1}
          disabled={!sampling.enabled}
          onCommit={(maxTokens) => setSampling({ maxTokens })}
        />
      </div>
      <div className={styles.panelActions}>
        <Button size="s" variant="outlined" onClick={resetSampling}>
          {t('modelSamplingReset')}
        </Button>
      </div>
    </div>
  )
}

const ModelPanel = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.modelSettings.model)
  return (
    <div className={styles.panel}>
      <Row label={t('modelModelLabel')} description={t('modelModelDescription')}>
        <Select
          ariaLabel={t('modelModelLabel')}
          value={model}
          options={[
            { value: 'deepseek-flash', label: t('modelFlashLabel') },
            { value: 'deepseek-v4-pro', label: t('modelProLabel') },
          ]}
          onChange={setModel}
        />
      </Row>
      <div className={styles.note}>{t('modelModelNote')}</div>
    </div>
  )
}

const ReminderPanel = () => {
  const t = useTranslate()
  const settings = useSettings((state) => state.modelSettings)
  const location = useSettings((state) => state.location)
  const locale = useSettings((state) => state.locale)
  const now = new Date()
  const autoDate = formatDate(now, '-') ?? ''
  const autoWeekday = weekdayName(locale === 'en-US' ? 'en' : 'zh', now)
  const preview = createLatestReminder(settings, location, locale, now)

  return (
    <div className={styles.panel}>
      <div className={styles.description}>{t('modelReminderDescription')}</div>
      <div className={styles.reminderGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('modelReminderDate')}</span>
          <input
            className={styles.input}
            value={settings.reminder.date ?? ''}
            placeholder={autoDate}
            onChange={(event) =>
              setReminder({ date: event.target.value.trim() ? event.target.value : null })
            }
          />
          <span className={styles.fieldHint}>
            {settings.reminder.date
              ? t('modelReminderManual')
              : t('modelReminderAutoHint', { value: autoDate })}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('modelReminderWeekday')}</span>
          <input
            className={styles.input}
            value={settings.reminder.weekday ?? ''}
            placeholder={autoWeekday}
            onChange={(event) =>
              setReminder({ weekday: event.target.value.trim() ? event.target.value : null })
            }
          />
          <span className={styles.fieldHint}>
            {settings.reminder.weekday
              ? t('modelReminderManual')
              : t('modelReminderAutoHint', { value: autoWeekday })}
          </span>
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('modelReminderClient')}</span>
          <div className={styles.readonlyValue}>Web</div>
          <span className={styles.fieldHint}>{t('modelReminderClientHint')}</span>
        </div>
      </div>
      <div className={styles.note}>{t('modelReminderInheritHint')}</div>
      <div className={styles.preview}>
        <span className={styles.previewLabel}>{t('modelReminderPreview')}</span>
        <code className={styles.previewValue}>{preview}</code>
      </div>
    </div>
  )
}

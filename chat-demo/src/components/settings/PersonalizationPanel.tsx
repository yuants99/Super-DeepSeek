import { useTranslate } from '../../i18n/index.js'
import {
  setPersonalization,
  useSettings,
  type PersonalizationLevel,
  type PersonalizationStyle,
} from '../../services/settings.js'
import type { TranslationKey } from '../../i18n/index.js'
import { VoiceInputButton } from '../base/VoiceInputButton.js'
import { Switch } from '../base/Switch.js'
import styles from './Settings.module.css'

const stylesOptions: { value: PersonalizationStyle; label: TranslationKey }[] = [
  { value: 'default', label: 'personalizationStyleDefault' },
  { value: 'professional', label: 'personalizationStyleProfessional' },
  { value: 'friendly', label: 'personalizationStyleFriendly' },
  { value: 'direct', label: 'personalizationStyleDirect' },
  { value: 'imaginative', label: 'personalizationStyleImaginative' },
  { value: 'efficient', label: 'personalizationStyleEfficient' },
  { value: 'witty', label: 'personalizationStyleWitty' },
]

const levels: { key: 'warmth' | 'enthusiasm' | 'structure' | 'emoji'; label: TranslationKey; hints: TranslationKey[] }[] = [
  {
    key: 'warmth',
    label: 'personalizationWarmth',
    hints: ['personalizationWarmthLow', 'personalizationWarmthMid', 'personalizationWarmthHigh'],
  },
  {
    key: 'enthusiasm',
    label: 'personalizationEnthusiasm',
    hints: ['personalizationEnthusiasmLow', 'personalizationEnthusiasmMid', 'personalizationEnthusiasmHigh'],
  },
  {
    key: 'structure',
    label: 'personalizationStructure',
    hints: ['personalizationStructureLow', 'personalizationStructureMid', 'personalizationStructureHigh'],
  },
  {
    key: 'emoji',
    label: 'personalizationEmoji',
    hints: ['personalizationEmojiLow', 'personalizationEmojiMid', 'personalizationEmojiHigh'],
  },
]

/** 个性化：总开关 + 风格 + 四个三档滑条 + 自定义指令，全部拼进 system 注入。 */
export const PersonalizationPanel = () => {
  const t = useTranslate()
  const personalization = useSettings((state) => state.modelSettings.personalization)
  const disabled = !personalization.enabled

  return (
    <div className={styles.personalization}>
      <div className={styles.personalizationHead}>
        <div>
          <div className={styles.label}>{t('personalizationTitle')}</div>
          <div className={styles.description}>{t('personalizationDescription')}</div>
        </div>
        <Switch
          checked={personalization.enabled}
          ariaLabel={t('personalizationEnable')}
          onChange={(enabled) => setPersonalization({ enabled })}
        />
      </div>

      <div className={styles.personalizationSectionHead}>
        <div>
          <div className={styles.personalizationSectionTitle}>{t('personalizationInPrivacy')}</div>
          <div className={styles.description}>{t('personalizationInPrivacyHint')}</div>
        </div>
        <Switch
          checked={personalization.applyInPrivacy}
          ariaLabel={t('personalizationInPrivacy')}
          onChange={(applyInPrivacy) => setPersonalization({ applyInPrivacy })}
        />
      </div>

      {disabled ? (
        <div className={styles.personalizationOff}>{t('personalizationOffHint')}</div>
      ) : (
        <>
          <div className={styles.personalizationSection}>
            <div className={styles.personalizationSectionTitle}>{t('personalizationStyle')}</div>
            <div role="radiogroup" aria-label={t('personalizationStyle')} className={styles.styleGrid}>
              {stylesOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={personalization.style === option.value}
                  className={
                    personalization.style === option.value
                      ? `${styles.styleOption} ${styles.styleOptionActive}`
                      : styles.styleOption
                  }
                  onClick={() => setPersonalization({ style: option.value })}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.personalizationSection}>
            <div className={styles.sliderGrid}>
              {levels.map((level) => {
              const value = personalization[level.key]
              return (
                <div key={level.key} className={styles.sliderRow}>
                  <div className={styles.sliderHead}>
                    <span>{t(level.label)}</span>
                    <span className={styles.sliderHint}>{t(level.hints[value - 1])}</span>
                  </div>
                  <input
                    className={styles.slider}
                    type="range"
                    min={1}
                    max={3}
                    step={1}
                    value={value}
                    aria-label={t(level.label)}
                    onChange={(event) =>
                      setPersonalization({
                        [level.key]: Number(event.target.value) as PersonalizationLevel,
                      })
                    }
                  />
                  <div className={styles.sliderMarks}>
                    <span>{t('personalizationLevelLow')}</span>
                    <span>{t('personalizationLevelMid')}</span>
                    <span>{t('personalizationLevelHigh')}</span>
                  </div>
                </div>
                )
              })}
            </div>
          </div>

          <div className={styles.personalizationSection}>
            <div className={styles.personalizationSectionHead}>
              <div>
                <div className={styles.personalizationSectionTitle}>{t('personalizationCustom')}</div>
                <div className={styles.description}>{t('personalizationCustomHint')}</div>
              </div>
              <VoiceInputButton
                onText={(text) => {
                  const current = useSettings.getState().modelSettings.personalization.custom
                  setPersonalization({
                    custom: `${current}${current && !current.endsWith('\n') ? '\n' : ''}${text}`,
                  })
                }}
              />
            </div>
            <textarea
              className={styles.personalizationTextarea}
              maxLength={2000}
              rows={5}
              placeholder={t('personalizationCustomPlaceholder')}
              value={personalization.custom}
              onChange={(event) => setPersonalization({ custom: event.target.value })}
            />
          </div>
        </>
      )}
    </div>
  )
}

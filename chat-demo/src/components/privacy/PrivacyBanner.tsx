import { useTranslate } from '../../i18n/index.js'
import { exitPrivacyMode, useChatStore } from '../../services/chat/store.js'
import { IconPrivacyOutline16 } from '../base/icons.js'
import styles from './PrivacyBanner.module.css'

/** 隐私模式常驻提示：明确告知不保存历史、不计费、不联网。 */
export const PrivacyBanner = () => {
  const t = useTranslate()
  const privacyMode = useChatStore((state) => state.privacyMode)
  if (!privacyMode) {
    return null
  }
  return (
    <div className={styles.banner} role="status">
      <span className={styles.icon}>
        <IconPrivacyOutline16 />
      </span>
      <span className={styles.label}>{t('privacyMode')}</span>
      <span className={styles.separator} />
      <span className={styles.text}>{t('privacyBannerShort')}</span>
      <button type="button" className={styles.exit} onClick={exitPrivacyMode}>
        {t('privacyExit')}
      </button>
    </div>
  )
}

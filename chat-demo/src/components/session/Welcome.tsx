import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { togglePrivacyMode, useChatStore } from '../../services/chat/store.js'
import { IconPrivacyOutline16 } from '../base/icons.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const privacyMode = useChatStore((state) => state.privacyMode)
  const welcomeMessage = useSettings((state) => state.welcomeMessage)
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      {privacyMode ? null : (
        <button
          type="button"
          className={styles.privacyButton}
          aria-label={t('privacyEnter')}
          title={t('privacyEnter')}
          onClick={togglePrivacyMode}
        >
          <IconPrivacyOutline16 />
        </button>
      )}
      <div className={styles.welcome}>
        <div className={styles.greeting}>{welcomeMessage || t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
      </div>
    </div>
  )
}

import { useTranslate } from '../../i18n/index.js'
import styles from './AboutPanel.module.css'

/** 关于页：品牌字标、版本、独立性声明与隐私说明。 */
export const AboutPanel = () => {
  const t = useTranslate()
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.glow} aria-hidden />
        <div className={styles.wordmark}>
          <span className={styles.wordDeep}>Deep</span>
          <span className={styles.wordSeek}>Seek</span>
        </div>
        <div className={styles.rule} aria-hidden />
        <div className={styles.name}>Super DeepSeek</div>
        <div className={styles.tagline}>{t('aboutTagline')}</div>
        <div className={styles.version}>v{__APP_VERSION__} · macOS</div>
      </section>

      <div className={styles.cards}>
        <section className={styles.card}>
          <div className={styles.cardLabel}>{t('aboutIndependenceTitle')}</div>
          <p>{t('aboutIndependenceBody')}</p>
          <p>{t('aboutIndependenceBody2')}</p>
        </section>
        <section className={styles.card}>
          <div className={styles.cardLabel}>{t('aboutPrivacyTitle')}</div>
          <p>{t('aboutPrivacyBody')}</p>
          <p>{t('aboutPrivacyBody2')}</p>
        </section>
      </div>

      <div className={styles.footnote}>{t('aboutFootnote')}</div>
    </div>
  )
}

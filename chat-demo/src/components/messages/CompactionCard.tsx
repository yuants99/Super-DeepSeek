import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronDownOutline14, IconChevronRightOutline14 } from '../base/icons.js'
import styles from './CompactionCard.module.css'

/** 上下文压缩后插入到对话里的摘要卡片：默认折叠，点开查看压缩产物。 */
export const CompactionCard = ({ digest, rounds }: { digest: string; rounds: number }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.chevron}>
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </span>
        <span className={styles.title}>{t('compactionCardTitle', { rounds })}</span>
        <span className={styles.badge}>{t('compactionCardBadge')}</span>
        {open ? null : <span className={styles.hint}>{t('compactionCardHint')}</span>}
      </button>
      {open ? <pre className={styles.body}>{digest}</pre> : null}
    </div>
  )
}

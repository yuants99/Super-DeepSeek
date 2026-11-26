import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconMemoryOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import { SessionExportDialog } from './SessionExportDialog.js'
import { SessionSettingsDialog } from '../session/SessionSettingsDialog.js'
import { MemorySummaryModal } from '../settings/MemorySummaryModal.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: (session: SessionSummary) => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memorySummaryOpen, setMemorySummaryOpen] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'settings',
              label: t('sessionItemMenuSettingsOption'),
              icon: <IconSettingsOutline16 />,
              onSelect: () => setSettingsOpen(true),
            },
            {
              key: 'memory',
              label: t('sessionItemMenuMemorySummaryOption'),
              icon: <IconMemoryOutline16 />,
              onSelect: () => {
                if (ensureApiKey()) {
                  setMemorySummaryOpen(true)
                }
              },
            },
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'export',
              label: t('sessionItemMenuExportOption'),
              icon: <IconDownloadOutline16 />,
              onSelect: () => setExporting(true),
            },
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: () => onDelete(session),
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
      {exporting ? (
        <SessionExportDialog sessionId={session.id} onClose={() => setExporting(false)} />
      ) : null}
      {settingsOpen ? (
        <SessionSettingsDialog sessionId={session.id} onClose={() => setSettingsOpen(false)} />
      ) : null}
      {memorySummaryOpen ? (
        <MemorySummaryModal
          sessionId={session.id}
          sessionTitle={displayTitle}
          onClose={() => setMemorySummaryOpen(false)}
        />
      ) : null}
    </div>
  )
})

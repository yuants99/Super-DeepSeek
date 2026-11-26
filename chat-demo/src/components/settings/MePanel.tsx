import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  converseWithMemory,
  parseMemoryChatReply,
  type MemoryChatTurn,
} from '../../services/memory.js'
import {
  ME_BACKGROUND_LIMIT,
  ME_NICKNAME_LIMIT,
  setMe,
  useSettings,
} from '../../services/settings.js'
import { createId } from '../../utils/id.js'
import { useImeGuard } from '../../utils/ime.js'
import { Button } from '../base/Button.js'
import { IconSendOutline16, IconStopFill16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { VoiceInputButton } from '../base/VoiceInputButton.js'
import { LocationSetting } from './LocationSetting.js'
import { ensureApiKey } from './settingsDialogState.js'
import styles from './Settings.module.css'

/** 「我的」设置页：全局注入开关、隐私开关、个人称呼、个人背景、位置、只读长期记忆与“与记忆对话”层级。 */
export const MePanel = () => {
  const t = useTranslate()
  const me = useSettings((state) => state.me)
  const [editingMemory, setEditingMemory] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)

  if (editingMemory) {
    return <MemoryChatSubpage onBack={() => setEditingMemory(false)} />
  }

  return (
    <div className={styles.mePanel}>
      <div className={styles.personalizationHead}>
        <div>
          <div className={styles.label}>{t('meTitle')}</div>
          <div className={styles.description}>{t('meDescription')}</div>
        </div>
        <Switch
          checked={me.enabled}
          ariaLabel={t('meTitle')}
          onChange={(enabled) => setMe({ enabled })}
        />
      </div>

      <div className={styles.personalizationSectionHead}>
        <div>
          <div className={styles.personalizationSectionTitle}>{t('meInPrivacy')}</div>
          <div className={styles.description}>{t('meInPrivacyHint')}</div>
        </div>
        <Switch
          checked={me.applyInPrivacy}
          ariaLabel={t('meInPrivacy')}
          onChange={(applyInPrivacy) => setMe({ applyInPrivacy })}
        />
      </div>

      {!me.enabled ? <div className={styles.personalizationOff}>{t('meDisabledHint')}</div> : null}

      <div className={styles.meField}>
        <div className={styles.meFieldHead}>
          <label htmlFor="me-nickname-input" className={styles.personalizationSectionTitle}>
            {t('meNicknameLabel')}
          </label>
          <span
            className={clsx(
              styles.counter,
              me.nickname.length >= ME_NICKNAME_LIMIT && styles.counterLimit
            )}
          >
            {me.nickname.length}/{ME_NICKNAME_LIMIT}
          </span>
        </div>
        <input
          id="me-nickname-input"
          className={styles.meInput}
          maxLength={ME_NICKNAME_LIMIT}
          placeholder={t('meNicknamePlaceholder')}
          value={me.nickname}
          onChange={(event) => setMe({ nickname: event.target.value })}
        />
      </div>

      <div className={styles.meField}>
        <div className={styles.meFieldHead}>
          <label htmlFor="me-background-input" className={styles.personalizationSectionTitle}>
            {t('meBackgroundLabel')}
          </label>
          <div className={styles.meFieldActions}>
            <VoiceInputButton
              onText={(text) => {
                const current = useSettings.getState().me.background
                const next = `${current}${current.trim() ? ' ' : ''}${text}`
                setMe({ background: next.slice(0, ME_BACKGROUND_LIMIT) })
              }}
            />
            <span
              className={clsx(
                styles.counter,
                me.background.length >= ME_BACKGROUND_LIMIT && styles.counterLimit
              )}
            >
              {me.background.length}/{ME_BACKGROUND_LIMIT}
            </span>
          </div>
        </div>
        <textarea
          id="me-background-input"
          className={styles.meTextarea}
          rows={3}
          maxLength={ME_BACKGROUND_LIMIT}
          placeholder={t('meBackgroundPlaceholder')}
          value={me.background}
          onChange={(event) => setMe({ background: event.target.value })}
        />
      </div>

      <LocationSetting />

      <div className={styles.meField}>
        <div className={styles.meFieldHead}>
          <div>
            <div className={styles.personalizationSectionTitle}>{t('meMemoryLabel')}</div>
            <div className={styles.description}>{t('meMemoryHint')}</div>
          </div>
        </div>
        <div className={clsx(styles.meMemoryBox, !me.memory.trim() && styles.meMemoryEmpty)}>
          {me.memory.trim() || t('meMemoryEmpty')}
        </div>
        <div className={styles.meMemoryActions}>
          <Button size="m" onClick={() => setEditingMemory(true)}>
            {t('meMemoryChatOpen')}
          </Button>
          {me.memory.trim() ? (
            <Button size="m" variant="dangerOutlined" onClick={() => setClearConfirm(true)}>
              {t('meMemoryClear')}
            </Button>
          ) : null}
        </div>
      </div>

      {clearConfirm ? (
        <Modal
          title={t('meMemoryClearTitle')}
          onClose={() => setClearConfirm(false)}
          footer={
            <div className={styles.deleteActions}>
              <Button variant="outlined" onClick={() => setClearConfirm(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setMe({ memory: '' })
                  setClearConfirm(false)
                  showToast({ key: 'meMemoryClearedToast' })
                }}
              >
                {t('meMemoryClear')}
              </Button>
            </div>
          }
        >
          {t('meMemoryClearDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 「与记忆对话」二级界面：上方只读展示当前/待确认记忆文章，下方通过对话持续补充和修正。 */
const MemoryChatSubpage = ({ onBack }: { onBack: () => void }) => {
  const t = useTranslate()
  const savedMemory = useSettings((state) => state.me.memory)
  const [draftMemory, setDraftMemory] = useState(savedMemory)
  const [comparingOriginal, setComparingOriginal] = useState(false)
  const [turns, setTurns] = useState<MemoryChatTurn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamRaw, setStreamRaw] = useState('')
  const [backConfirmOpen, setBackConfirmOpen] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const ime = useImeGuard()

  useEffect(() => () => controllerRef.current?.abort(), [])

  const hasDraftChanges = draftMemory.trim() !== savedMemory.trim()

  useEffect(() => {
    const el = listRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [turns, streamRaw, streaming])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) {
      return
    }
    if (!ensureApiKey()) {
      return
    }
    const userTurn: MemoryChatTurn = { id: createId(), role: 'user', content: text }
    const nextHistory = [...turns, userTurn]
    setTurns(nextHistory)
    setInput('')
    setStreamRaw('')
    setStreaming(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const result = await converseWithMemory({
        draftMemory,
        history: turns,
        userInput: text,
        signal: controller.signal,
        onStreamText: (raw) => setStreamRaw(raw),
      })
      if (controller.signal.aborted) {
        return
      }
      if (result.proposedMemory) {
        setDraftMemory(result.proposedMemory)
        setComparingOriginal(false)
      }
      setTurns((prev) => [
        ...prev,
        {
          id: createId(),
          role: 'assistant',
          content: result.visibleText || (result.proposedMemory ? t('meMemoryChatUpdatedChip') : ''),
          proposedMemory: result.proposedMemory ?? undefined,
        },
      ])
    } catch {
      if (!controller.signal.aborted) {
        setTurns((prev) => prev.filter((item) => item.id !== userTurn.id))
        setInput(text)
        showToast({ key: 'meMemoryChatFailed', type: 'error' })
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      setStreaming(false)
      setStreamRaw('')
    }
  }

  const handleBack = () => {
    if (streaming) {
      controllerRef.current?.abort()
    }
    if (hasDraftChanges) {
      setBackConfirmOpen(true)
      return
    }
    onBack()
  }

  const applyDraft = () => {
    setMe({ memory: draftMemory })
    setComparingOriginal(false)
    showToast({ key: 'meMemoryAppliedToast' })
  }

  const parsedStream = streaming ? parseMemoryChatReply(streamRaw) : null
  const shownMemory = comparingOriginal ? savedMemory : draftMemory

  return (
    <div className={styles.memoryChat}>
      <div className={styles.memoryChatHeader}>
        <div className={styles.memoryChatHeaderLeft}>
          <button type="button" className={styles.memoryBackButton} onClick={handleBack}>
            ← {t('meMemoryBack')}
          </button>
          <span className={styles.memoryChatTitle}>{t('meMemoryChatTitle')}</span>
        </div>
        {hasDraftChanges ? (
          <div className={styles.memoryChatHeaderActions}>
            <Button
              size="s"
              variant="outlined"
              disabled={streaming}
              onClick={() => {
                setDraftMemory(savedMemory)
                setComparingOriginal(false)
              }}
            >
              {t('meMemoryDiscardDraft')}
            </Button>
            <Button size="s" disabled={streaming} onClick={applyDraft}>
              {t('meMemoryConfirmApply')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={styles.memoryPreviewCard}>
        <div className={styles.memoryPreviewHead}>
          <span
            className={clsx(
              styles.memoryBadge,
              hasDraftChanges && !comparingOriginal && styles.memoryBadgeDraft
            )}
          >
            {hasDraftChanges && !comparingOriginal
              ? t('meMemoryDraftBadge')
              : t('meMemorySavedBadge')}
          </span>
          {hasDraftChanges ? (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setComparingOriginal((value) => !value)}
            >
              {comparingOriginal ? t('meMemoryCompareNew') : t('meMemoryCompareOld')}
            </button>
          ) : null}
        </div>
        <div className={clsx(styles.memoryPreviewBody, !shownMemory.trim() && styles.meMemoryEmpty)}>
          {shownMemory.trim() || t('meMemoryEmpty')}
        </div>
      </div>

      <div ref={listRef} className={styles.memoryMessages}>
        <div className={styles.memoryMsgAssistant}>
          <div className={styles.memoryBubbleAssistant}>{t('meMemoryChatIntro')}</div>
        </div>
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={turn.role === 'user' ? styles.memoryMsgUser : styles.memoryMsgAssistant}
          >
            <div
              className={
                turn.role === 'user' ? styles.memoryBubbleUser : styles.memoryBubbleAssistant
              }
            >
              {turn.content}
              {turn.proposedMemory ? (
                <div className={styles.memoryUpdatedTag}>{t('meMemoryChatUpdatedChip')}</div>
              ) : null}
            </div>
          </div>
        ))}
        {streaming ? (
          <div className={styles.memoryMsgAssistant}>
            <div className={styles.memoryBubbleAssistant}>
              {parsedStream?.visibleText || '...'}
              {parsedStream?.hasIncompleteMemoryTag ? (
                <div className={styles.memoryUpdatedTag}>{t('meMemoryChatUpdating')}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.memoryComposer}>
        <textarea
          className={styles.memoryComposerInput}
          rows={2}
          placeholder={t('meMemoryChatPlaceholder')}
          value={input}
          disabled={streaming}
          onChange={(event) => setInput(event.target.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || ime.isComposing(event)) {
              return
            }
            event.preventDefault()
            void send()
          }}
        />
        <div className={styles.memoryComposerActions}>
          <VoiceInputButton
            onText={(text) =>
              setInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${text}`)
            }
          />
          {streaming ? (
            <button
              type="button"
              className={styles.memorySendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => controllerRef.current?.abort()}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.memorySendButton, !input.trim() && styles.memorySendDisabled)}
              aria-label={t('send')}
              disabled={!input.trim()}
              onClick={() => void send()}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>

      {backConfirmOpen ? (
        <Modal
          title={t('meMemoryUnsavedConfirmTitle')}
          onClose={() => setBackConfirmOpen(false)}
          footer={
            <div className={styles.deleteActions}>
              <Button variant="outlined" onClick={() => setBackConfirmOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                onClick={() => {
                  setBackConfirmOpen(false)
                  onBack()
                }}
              >
                {t('meMemoryUnsavedDiscard')}
              </Button>
              <Button
                onClick={() => {
                  applyDraft()
                  setBackConfirmOpen(false)
                  onBack()
                }}
              >
                {t('meMemoryConfirmApply')}
              </Button>
            </div>
          }
        >
          {t('meMemoryUnsavedConfirmDesc')}
        </Modal>
      ) : null}
    </div>
  )
}

import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconChevronDownOutline14,
  IconGlobeLanguageOutline14,
  IconKeyOutline16,
  IconPaperclipOutline16,
  IconPromptOutline16,
  IconSendOutline16,
  IconShieldOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import {
  DEFAULT_SYSTEM_PROMPT,
  activateApiKey,
  setSafety,
  setSearch,
  setSystemPrompt,
  setThinking,
  setThinkingEffort,
  useSettings,
} from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { ensureApiKey, openSettings } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { SessionStatsBar } from './SessionStatsBar.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import { useImeGuard } from '../../utils/ime.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const privacyMode = useChatStore((state) => state.privacyMode)
  const thinkingEffort = useSettings((state) => state.thinkingEffort)
  const modelSettings = useSettings((state) => state.modelSettings)
  const apiKeys = useSettings((state) => state.apiKeys)
  const activeKeyId = useSettings((state) => state.activeKeyId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [collapsedByUser, setCollapsedByUser] = useState<boolean | null>(null)
  const [statsVisible, setStatsVisible] = useState(() => {
    try {
      const saved = localStorage.getItem('chat-demo:stats-visible')
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })
  const collapsed = collapsedByUser ?? narrow
  const ime = useImeGuard()

  // 输入框变窄时自动折叠快捷区，只保留思考按钮和展开按钮。
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) {
      return
    }
    const update = () => setNarrow(el.clientWidth < 640)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const acceptFiles = (files: File[]) => {
    if (privacyMode || files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const preset = modelSettings.presets.find((item) => item.text === modelSettings.systemPrompt)
  const promptLabel =
    modelSettings.systemPrompt === DEFAULT_SYSTEM_PROMPT
      ? t('quickPromptDefault')
      : preset
        ? preset.name
        : t('quickPromptCustom')
  const safetyLabel = !modelSettings.safety.enabled
    ? t('quickSafetyOff')
    : modelSettings.safety.level === 'low'
      ? t('quickSafetyLow')
      : t('quickSafetyHigh')
  const blank = <span className={styles.menuBlank} />
  const promptOptions: MenuOption[] = [
    {
      key: 'default',
      label: t('quickPromptDefault'),
      icon: modelSettings.systemPrompt === DEFAULT_SYSTEM_PROMPT ? <IconCheckOutline16 /> : blank,
      onSelect: () => setSystemPrompt(DEFAULT_SYSTEM_PROMPT),
    },
    ...modelSettings.presets.map((item) => ({
      key: item.id,
      label: item.name,
      icon: item.text === modelSettings.systemPrompt ? <IconCheckOutline16 /> : blank,
      onSelect: () => setSystemPrompt(item.text),
    })),
    {
      key: 'edit',
      label: t('quickPromptEdit'),
      icon: <IconPromptOutline16 />,
      onSelect: () => openSettings('model'),
    },
  ]
  const effortLabel =
    thinkingEffort === 'low'
      ? t('quickThinkingLow')
      : thinkingEffort === 'max'
        ? t('quickThinkingMax')
        : t('quickThinkingHigh')
  const activeKey = apiKeys.find((entry) => entry.id === activeKeyId)
  const thinkingTone =
    thinking && thinkingEffort === 'low'
      ? { backgroundColor: 'rgba(52, 199, 123, 0.16)', color: '#16794f' }
      : thinking && thinkingEffort === 'max'
        ? { backgroundColor: 'rgba(139, 92, 246, 0.16)', color: '#6d28d9' }
        : undefined
  const thinkingOptions: MenuOption[] = [
    {
      key: 'off',
      label: t('quickThinkingMenuOff'),
      icon: !thinking ? <IconCheckOutline16 /> : blank,
      onSelect: () => setThinking(false),
    },
    ...(['low', 'high', 'max'] as const).map((effort) => ({
      key: effort,
      label:
        effort === 'low'
          ? t('quickThinkingLow')
          : effort === 'max'
            ? t('quickThinkingMax')
            : t('quickThinkingHigh'),
      icon: thinking && thinkingEffort === effort ? <IconCheckOutline16 /> : blank,
      onSelect: () => {
        setThinking(true)
        setThinkingEffort(effort)
      },
    })),
  ]
  const safetyTone = !modelSettings.safety.enabled
    ? null
    : modelSettings.safety.level === 'low'
      ? styles.safetyLow
      : styles.safetyHigh
  const keyOptions: MenuOption[] = [
    ...apiKeys.map((entry) => ({
      key: entry.id,
      label: entry.tag,
      icon: entry.id === activeKeyId ? <IconCheckOutline16 /> : blank,
      onSelect: () => activateApiKey(entry.id),
    })),
    {
      key: 'manage',
      label: t('quickKeyManage'),
      icon: <IconKeyOutline16 />,
      onSelect: () => openSettings('keys'),
    },
  ]
  const safetyOptions: MenuOption[] = [
    {
      key: 'off',
      label: t('quickSafetyMenuOff'),
      icon: !modelSettings.safety.enabled ? <IconCheckOutline16 /> : blank,
      onSelect: () => setSafety({ enabled: false }),
    },
    {
      key: 'low',
      label: t('quickSafetyMenuLow'),
      icon:
        modelSettings.safety.enabled && modelSettings.safety.level === 'low' ? (
          <IconCheckOutline16 />
        ) : (
          blank
        ),
      onSelect: () => setSafety({ enabled: true, level: 'low' }),
    },
    {
      key: 'high',
      label: t('quickSafetyMenuHigh'),
      icon:
        modelSettings.safety.enabled && modelSettings.safety.level === 'high' ? (
          <IconCheckOutline16 />
        ) : (
          blank
        ),
      onSelect: () => setSafety({ enabled: true, level: 'high' }),
    },
  ]

  return (
    <div
      ref={wrapperRef}
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) {
              return
            }
            // 中文/日文等输入法组合期间的回车用于选词上屏，不能发送。
            if (ime.isComposing(event)) {
              return
            }
            event.preventDefault()
            send()
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={clsx(
        styles.functionRow,
        sessionId !== null && statsVisible && styles.functionRowWithStats
      )}>
        <div className={styles.toggles}>
          {privacyMode ? <span className={styles.privacyChip}>{t('privacyChip')}</span> : null}
          <Menu options={thinkingOptions}>
            {({ open, toggle }) => (
              <button
                type="button"
                className={clsx(
                  styles.toggle,
                  thinking && styles.selected,
                  thinking && thinkingEffort === 'low' && styles.thinkingLow,
                  thinking && thinkingEffort === 'max' && styles.thinkingMax,
                  open && styles.selected
                )}
                aria-label={t('quickThinking')}
                title={`${t('quickThinking')}：${thinking ? effortLabel : t('quickThinkingMenuOff')}`}
                style={thinkingTone}
                onClick={toggle}
              >
                <IconThinkOutline14 />
                <span className={styles.toggleLabel}>{t('quickThinking')}</span>
              </button>
            )}
          </Menu>
          {collapsed ? (
            <button
              type="button"
              className={styles.collapseButton}
              aria-label={t('quickExpand')}
              title={t('quickExpand')}
              onClick={() => setCollapsedByUser(false)}
            >
              <IconChevronRightOutline14 />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('quickOnline')}
                aria-pressed={search}
                title={t('quickOnline')}
                onClick={() => setSearch(!search)}
              >
                <IconGlobeLanguageOutline14 />
                <span className={styles.toggleLabel}>{t('quickOnline')}</span>
              </button>
              <Menu options={promptOptions}>
                {({ open, toggle }) => (
                  <button
                    type="button"
                    className={clsx(styles.toggle, open && styles.selected)}
                    aria-label={t('quickPrompt')}
                    title={`${t('quickPrompt')}：${promptLabel}`}
                    onClick={toggle}
                  >
                    <IconPromptOutline16 />
                    <span className={clsx(styles.toggleLabel, styles.quickLabel)}>{promptLabel}</span>
                  </button>
                )}
              </Menu>
              <Menu options={safetyOptions}>
                {({ open, toggle }) => (
                  <button
                    type="button"
                    className={clsx(styles.toggle, safetyTone, open && styles.selected)}
                    aria-label={`${t('quickSafety')}：${safetyLabel}`}
                    title={`${t('quickSafety')}：${safetyLabel}`}
                    onClick={toggle}
                  >
                    <IconShieldOutline16 />
                    <span className={styles.toggleLabel}>{t('quickSafety')}</span>
                  </button>
                )}
              </Menu>
              <Menu options={keyOptions}>
                {({ open, toggle }) => (
                  <button
                    type="button"
                    className={clsx(styles.toggle, open && styles.selected)}
                    aria-label={t('quickKey')}
                    title={`${t('quickKey')}：${activeKey?.tag ?? t('quickKey')}`}
                    onClick={toggle}
                  >
                    <IconKeyOutline16 />
                    <span className={clsx(styles.toggleLabel, styles.quickLabel)}>
                      {activeKey?.tag ?? t('quickKey')}
                    </span>
                  </button>
                )}
              </Menu>
              <button
                type="button"
                className={styles.collapseButton}
                aria-label={t('quickCollapse')}
                title={t('quickCollapse')}
                onClick={() => setCollapsedByUser(true)}
              >
                <span className={styles.flipIcon}>
                  <IconChevronRightOutline14 />
                </span>
              </button>
            </>
          )}
          {sessionId ? (
            <button
              type="button"
              className={styles.statsToggle}
              aria-label={t(statsVisible ? 'statsToggleHide' : 'statsToggleShow')}
              title={t(statsVisible ? 'statsToggleHide' : 'statsToggleShow')}
              onClick={() => {
                setStatsVisible((visible) => {
                  const next = !visible
                  try {
                    localStorage.setItem('chat-demo:stats-visible', String(next))
                  } catch {
                    // 忽略存储异常
                  }
                  return next
                })
              }}
            >
              {statsVisible ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
            </button>
          ) : null}
        </div>
        <div className={styles.right}>
          <VoiceButton
            status={voice.status}
            disabled={!voice.available}
            seconds={voice.seconds}
            onClick={() => {
              if (
                voice.status !== 'idle' ||
                (!useChatStore.getState().importingHistory && ensureApiKey())
              ) {
                void voice.toggle()
              }
            }}
          />
          {privacyMode ? null : (
            <IconButton
              size="m"
              tone="primary"
              icon={<IconPaperclipOutline16 />}
              tooltip={t('uploadFile')}
              disabled={importingHistory}
              onClick={() => ensureApiKey() && fileInputRef.current?.click()}
            />
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
      </div>
      {sessionId && statsVisible ? <SessionStatsBar sessionId={sessionId} /> : null}
      {dragging ? <DragMask /> : null}
    </div>
  )
}

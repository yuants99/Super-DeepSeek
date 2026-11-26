import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { CompactionCard } from './CompactionCard.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

const isAtBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= STICKY_THRESHOLD

const canScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight > 1

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const previousVersionsRef = useRef<ReadonlyMap<string, MessageVersions>>(new Map())
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersionsRef.current),
    [session]
  )
  useLayoutEffect(() => {
    previousVersionsRef.current = versions
  }, [versions])
  const lastMessageId = messages.at(-1)?.id

  /** 立即贴底：只在切换会话等需要同步完成的场景使用。 */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    el.scrollTop = el.scrollHeight
    scrollTopRef.current = el.scrollTop
  }, [])

  /**
   * 跟随底部：仅在仍处于跟随状态时执行，并合并到下一帧。
   * 流式输出时每帧最多滚动一次，避免每个 token 都读写布局造成卡顿；
   * 用户一旦向上滚动（滚轮 / 触摸 / 滚动条），排队的贴底会被立即取消。
   */
  const scrollToBottom = useCallback(() => {
    if (!stickyRef.current || rafRef.current !== null) {
      return
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el || !stickyRef.current) {
        return
      }
      const target = el.scrollHeight - el.clientHeight
      if (target - el.scrollTop <= 1) {
        return
      }
      el.scrollTop = target
      scrollTopRef.current = el.scrollTop
    })
  }, [])

  // 卸载时取消排队中的滚动
  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    },
    []
  )

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      scrollTopRef.current = scroll.scrollTop
      return
    }
    stickyRef.current = true
    jumpToBottom()
  }, [session.id, lastMessageId, jumpToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      jumpToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    scrollTopRef.current = el.scrollTop

    const cancelPending = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    const onScroll = () => {
      const current = scrollRef.current
      if (!current || current !== el) {
        return
      }
      if (isAtBottom(current)) {
        stickyRef.current = true
      } else if (current.scrollTop < scrollTopRef.current - 1) {
        // 用户向上滚动（含拖动滚动条）：停止跟随，并取消同一帧里排队的贴底。
        stickyRef.current = false
        cancelPending()
      }
      scrollTopRef.current = current.scrollTop
    }
    const onWheel = (event: WheelEvent) => {
      // 不等 scroll 事件：内容增长可能先于 scroll 把位置拉回底部。
      if (event.deltaY < 0 && !event.ctrlKey && canScroll(el)) {
        stickyRef.current = false
        cancelPending()
      }
    }
    let touchY = 0
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY
      // 手指下滑 = 内容向上翻，去读更早的消息。
      if (y - touchY > 2 && canScroll(el)) {
        stickyRef.current = false
        cancelPending()
      }
      touchY = y
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'PageUp' && event.key !== 'Home') {
        return
      }
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }
      stickyRef.current = false
      cancelPending()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('keydown', onKeyDown)
      cancelPending()
    }
  }, [isMobile, jumpToBottom])

  const lastIndex = messages.length - 1
  const compaction = session.compaction
  const compactionIndex = compaction
    ? messages.findIndex((message) => message.id === compaction.upToMessageId)
    : -1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {messages.map((message, index) => (
              <Fragment key={message.id}>
                {message.role === 'user' ? (
                  <UserMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  isLast={index === lastIndex}
                  streaming={streaming && index === lastIndex}
                  busy={streaming}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )}
                {index === compactionIndex && compaction ? (
                  <CompactionCard
                    digest={compaction.digest}
                    rounds={compaction.droppedRounds}
                  />
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}

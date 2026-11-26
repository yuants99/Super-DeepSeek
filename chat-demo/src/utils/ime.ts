import { useCallback, useRef } from 'react'
import type { CompositionEvent, KeyboardEvent } from 'react'

/**
 * compositionend 与 keydown 的先后顺序在不同浏览器/输入法下并不一致：
 * Safari 会先结束组合、再补发一个 keydown，此时 isComposing 已经是 false。
 * 用一个很短的窗口拦住这次“上屏回车”，避免误发送。
 */
const AFTER_COMPOSITION_MS = 30

/**
 * 输入法组合态守卫：组合期间的回车只用于选词/上屏，不能触发发送。
 * 同时覆盖：
 * - 标准 `isComposing`；
 * - 旧式 IME 的 `keyCode 229`；
 * - compositionend 之后紧邻的那一次 keydown。
 */
export const useImeGuard = () => {
  const composingRef = useRef(false)
  const endedAtRef = useRef(-Infinity)

  const onCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const onCompositionEnd = useCallback((event: CompositionEvent) => {
    composingRef.current = false
    endedAtRef.current = event.timeStamp
  }, [])

  const isComposing = useCallback((event: KeyboardEvent) => {
    const native = event.nativeEvent
    return (
      composingRef.current ||
      native.isComposing ||
      native.keyCode === 229 ||
      event.timeStamp - endedAtRef.current < AFTER_COMPOSITION_MS
    )
  }, [])

  return { onCompositionStart, onCompositionEnd, isComposing }
}

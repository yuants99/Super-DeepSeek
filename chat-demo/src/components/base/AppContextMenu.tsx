import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { readClipboard, writeClipboard } from '../../services/clipboard.js'
import styles from './AppContextMenu.module.css'

type Target = HTMLInputElement | HTMLTextAreaElement | HTMLElement

type MenuState = {
  x: number
  y: number
  editable: Target | null
  selectable: Target | null
  text: string
  range: Range | null
  start: number
  end: number
}

const selectedInputText = (element: HTMLInputElement | HTMLTextAreaElement) => {
  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? start
  return { start, end, text: element.value.slice(start, end) }
}

const setNativeValue = (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  cursor: number
) => {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.setSelectionRange(cursor, cursor)
}

const insertIntoEditable = (element: Target, text: string, range: Range | null, start: number, end: number) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const before = element.value.slice(0, start)
    const after = element.value.slice(end)
    const cursor = (before + text).length
    setNativeValue(element, before + text + after, cursor)
    return
  }
  element.focus()
  if (range) {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  if (!document.execCommand('insertText', false, text)) {
    const selection = window.getSelection()
    if (selection?.rangeCount) {
      const target = selection.getRangeAt(0)
      target.deleteContents()
      target.insertNode(document.createTextNode(text))
      target.collapse(false)
    }
  }
}

const deleteEditableSelection = (element: Target, range: Range | null, start: number, end: number) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, element.value.slice(0, start) + element.value.slice(end), start)
    return
  }
  element.focus()
  if (range) {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  document.execCommand('delete')
}

/** 自实现的客户端右键菜单：输入框保留剪切/复制/粘贴，消息正文保留复制。 */
export const AppContextMenu = () => {
  const t = useTranslate()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        event.preventDefault()
        setMenu(null)
        return
      }
      const editable = target.closest<Target>('input, textarea, [contenteditable="true"]')
      const selectable = target.closest<Target>('.ds-markdown, [class*="bubble"], pre, code')
      if (!editable && !selectable) {
        event.preventDefault()
        setMenu(null)
        return
      }
      event.preventDefault()
      const isField = editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement
      const selection = window.getSelection()
      const range =
        !isField && selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
      const inputSelection = isField ? selectedInputText(editable) : { start: 0, end: 0, text: '' }
      setMenu({
        x: event.clientX,
        y: event.clientY,
        editable: editable ?? null,
        selectable: selectable ?? null,
        text: isField ? inputSelection.text : (selection?.toString() ?? ''),
        range,
        start: isField ? inputSelection.start : 0,
        end: isField ? inputSelection.end : 0,
      })
    }
    const onDragStart = (event: DragEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('input, textarea, [contenteditable="true"]')) {
        event.preventDefault()
      }
    }
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('dragstart', onDragStart)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('dragstart', onDragStart)
    }
  }, [])

  useEffect(() => {
    if (!menu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenu(null)
      }
    }
    const close = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  if (!menu) {
    return null
  }

  const close = () => setMenu(null)
  const copy = async () => {
    await writeClipboard(menu.text)
    close()
  }
  const cut = async () => {
    if (!menu.editable) {
      return
    }
    await writeClipboard(menu.text)
    deleteEditableSelection(menu.editable, menu.range, menu.start, menu.end)
    close()
  }
  const paste = async () => {
    if (!menu.editable) {
      return
    }
    const text = await readClipboard()
    if (text) {
      insertIntoEditable(menu.editable, text, menu.range, menu.start, menu.end)
    }
    close()
  }
  const selectAll = () => {
    if (menu.editable) {
      if (menu.editable instanceof HTMLInputElement || menu.editable instanceof HTMLTextAreaElement) {
        menu.editable.focus()
        menu.editable.select()
      } else {
        const range = document.createRange()
        range.selectNodeContents(menu.editable)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        menu.editable.focus()
      }
    } else if (menu.selectable) {
      const range = document.createRange()
      range.selectNodeContents(menu.selectable)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    close()
  }

  const left = Math.min(menu.x, window.innerWidth - 172)
  const top = Math.min(menu.y, window.innerHeight - 148)

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.editable && menu.text ? (
        <button type="button" role="menuitem" className={styles.item} onMouseDown={(e) => e.preventDefault()} onClick={() => void cut()}>
          <span>{t('contextCut')}</span>
          <kbd>⌘X</kbd>
        </button>
      ) : null}
      {menu.text ? (
        <button type="button" role="menuitem" className={styles.item} onMouseDown={(e) => e.preventDefault()} onClick={() => void copy()}>
          <span>{t('contextCopy')}</span>
          <kbd>⌘C</kbd>
        </button>
      ) : null}
      {menu.editable ? (
        <button type="button" role="menuitem" className={styles.item} onMouseDown={(e) => e.preventDefault()} onClick={() => void paste()}>
          <span>{t('contextPaste')}</span>
          <kbd>⌘V</kbd>
        </button>
      ) : null}
      <div className={styles.separator} />
      <button type="button" role="menuitem" className={styles.item} onMouseDown={(e) => e.preventDefault()} onClick={selectAll}>
        <span>{t('contextSelectAll')}</span>
        <kbd>⌘A</kbd>
      </button>
    </div>,
    document.body
  )
}

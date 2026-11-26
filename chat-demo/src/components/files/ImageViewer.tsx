import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { loadFile } from '../../services/chat/db.js'
import {
  IconCloseOutline16,
  IconDownloadOutline16,
  IconMinusOutline16,
  IconPlusOutline16,
} from '../base/icons.js'
import { useImageViewer } from './imageViewerState.js'
import styles from './ImageViewer.module.css'

const MIN_SCALE = 0.2
const MAX_SCALE = 8

const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

/** 内置图片查看器：按需读取原图，支持滚轮缩放、拖拽平移与保存。 */
export const ImageViewer = () => {
  const t = useTranslate()
  const source = useImageViewer((state) => state.source)
  const closeImage = useImageViewer((state) => state.closeImage)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0 })
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!source) {
      setUrl(null)
      setFailed(false)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setFailed(false)
    setScale(1)
    setOffset({ x: 0, y: 0 })
    const pending =
      source.kind === 'draft'
        ? Promise.resolve(source.file)
        : loadFile(source.id).then((blob) => blob ?? null)
    void pending
      .then((blob) => {
        if (!blob || cancelled) {
          if (!cancelled) {
            setFailed(true)
          }
          return
        }
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) {
          setUrl(objectUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [source])

  useEffect(() => {
    if (!source) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImage()
      } else if (event.key === '+' || event.key === '=') {
        setScale((value) => clamp(value + 0.25))
      } else if (event.key === '-') {
        setScale((value) => clamp(value - 0.25))
      } else if (event.key === '0') {
        setScale(1)
        setOffset({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeImage, source])

  const zoomAt = useCallback((next: number, clientX?: number, clientY?: number) => {
    setScale((current) => {
      const target = clamp(next)
      const rect = stageRef.current?.getBoundingClientRect()
      if (rect && clientX !== undefined && clientY !== undefined && current !== 0) {
        const cx = clientX - rect.left - rect.width / 2
        const cy = clientY - rect.top - rect.height / 2
        const ratio = target / current
        setOffset((point) => ({
          x: cx - (cx - point.x) * ratio,
          y: cy - (cy - point.y) * ratio,
        }))
      }
      return target
    })
  }, [])

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0015)
    zoomAt(scale * factor, event.clientX, event.clientY)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging) {
      return
    }
    setOffset({
      x: dragRef.current.originX + event.clientX - dragRef.current.startX,
      y: dragRef.current.originY + event.clientY - dragRef.current.startY,
    })
  }

  const onPointerUp = () => setDragging(false)

  const save = () => {
    if (!url) {
      return
    }
    const link = document.createElement('a')
    link.href = url
    link.download = source?.name || 'image'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  if (!source) {
    return null
  }

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={source.name} onClick={closeImage}>
      <div className={styles.header} onClick={(event) => event.stopPropagation()}>
        <div className={styles.name} title={source.name}>{source.name}</div>
        <div className={styles.actions}>
          <div className={styles.zoomGroup}>
            <button type="button" className={styles.iconButton} aria-label={t('imageViewerZoomOut')} onClick={() => zoomAt(scale - 0.25)}>
              <IconMinusOutline16 />
            </button>
            <button type="button" className={styles.zoomValue} onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }} title={t('imageViewerReset')}>
              {Math.round(scale * 100)}%
            </button>
            <button type="button" className={styles.iconButton} aria-label={t('imageViewerZoomIn')} onClick={() => zoomAt(scale + 0.25)}>
              <IconPlusOutline16 />
            </button>
          </div>
          <button type="button" className={styles.actionButton} disabled={!url} onClick={save}>
            <IconDownloadOutline16 />
            <span>{t('imageViewerSave')}</span>
          </button>
          <button type="button" className={styles.iconButton} aria-label={t('imageViewerClose')} onClick={closeImage}>
            <IconCloseOutline16 />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={styles.stage}
        onClick={(event) => event.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (scale > 1) {
            setScale(1)
            setOffset({ x: 0, y: 0 })
          } else {
            zoomAt(2)
          }
        }}
      >
        {failed ? (
          <div className={styles.error}>{t('imageViewerLoadFailed')}</div>
        ) : url ? (
          <img
            src={url}
            alt={source.name}
            className={styles.image}
            draggable={false}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: dragging ? 'grabbing' : scale > 1 ? 'grab' : 'default',
            }}
          />
        ) : (
          <div className={styles.loading}>{t('imageViewerLoading')}</div>
        )}
      </div>

      <div className={styles.hint} onClick={(event) => event.stopPropagation()}>
        {t('imageViewerHint')}
      </div>
    </div>,
    document.body
  )
}

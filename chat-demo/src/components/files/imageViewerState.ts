import { create } from 'zustand'

export type ImageViewerSource =
  | { kind: 'stored'; id: string; name: string }
  | { kind: 'draft'; file: File; name: string }

type ImageViewerState = {
  source: ImageViewerSource | null
  openImage: (source: ImageViewerSource) => void
  closeImage: () => void
}

export const useImageViewer = create<ImageViewerState>((set) => ({
  source: null,
  openImage: (source) => set({ source }),
  closeImage: () => set({ source: null }),
}))

export const openImage = (source: ImageViewerSource) => useImageViewer.getState().openImage(source)

import { create } from 'zustand'
import { useChatStore } from '../../services/chat/store.js'

/** 点击“开启新对话”时先打开新对话设置弹窗，确认后再进入新对话 */
export const useNewChatSetup = create(() => ({
  open: false,
}))

export const openNewChatSetup = () => {
  if (!useChatStore.getState().importingHistory) {
    useNewChatSetup.setState({ open: true })
  }
}

export const closeNewChatSetup = () => useNewChatSetup.setState({ open: false })

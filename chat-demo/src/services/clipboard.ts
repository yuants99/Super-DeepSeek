/** 复制/粘贴优先走原生 NSPasteboard，浏览器环境退化为 Clipboard API。 */
export const writeClipboard = async (text: string): Promise<void> => {
  if (window.__nativeBridge?.writeClipboard) {
    window.__nativeBridge.writeClipboard(text)
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用时静默失败
  }
}

export const readClipboard = async (): Promise<string> => {
  if (window.__nativeBridge?.readClipboard) {
    return window.__nativeBridge.readClipboard()
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

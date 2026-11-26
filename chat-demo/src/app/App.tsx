import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  enterPrivacyMode,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { NewChatSettingsModal } from '../components/session/SessionSettingsDialog.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { openSettings } from '../components/settings/settingsDialogState.js'
import { useSettingsDialog } from '../components/settings/settingsDialogState.js'

const SettingsDialog = lazy(() =>
  import('../components/settings/SettingsDialog.js').then((module) => ({
    default: module.SettingsDialog,
  }))
)
import { Toast } from '../components/base/Toast.js'
import { AppContextMenu } from '../components/base/AppContextMenu.js'
import { ImageViewer } from '../components/files/ImageViewer.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { PrivacyBanner } from '../components/privacy/PrivacyBanner.js'
import { fetchBalance } from '../services/api/client.js'
import { dayKeyOf } from '../services/usage.js'
import { Modal } from '../components/base/Modal.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const settingsOpen = useSettingsDialog((state) => state.open)
  const privacyDefault = useSettings((state) => state.privacyDefault)
  const [balanceWarning, setBalanceWarning] = useState<
    { kind: 'low'; amount: number } | { kind: 'empty' } | null
  >(null)
  const privacyStarted = useRef(false)
  const balanceChecked = useRef(false)

  // 首次启动且没有 Key：自动打开 API Key 页，并只提示一次
  useEffect(() => {
    if (!ready) {
      return
    }
    if (useSettings.getState().apiKey) {
      return
    }
    try {
      if (localStorage.getItem('chat-demo:onboarded') === '1') {
        return
      }
      localStorage.setItem('chat-demo:onboarded', '1')
    } catch {
      // 忽略存储异常
    }
    openSettings('keys')
  }, [ready])

  // 默认以隐私模式启动
  useEffect(() => {
    if (!ready || privacyStarted.current) {
      return
    }
    privacyStarted.current = true
    if (privacyDefault && !useChatStore.getState().privacyMode) {
      enterPrivacyMode()
    }
  }, [ready, privacyDefault])

  // 每次启动检查一次余额，低于 3 元当天只提示一次
  useEffect(() => {
    if (!ready || balanceChecked.current) {
      return
    }
    balanceChecked.current = true
    const key = useSettings.getState().apiKey
    if (!key) {
      return
    }
    let cancelled = false
    void fetchBalance(key)
      .then((data) => {
        if (cancelled) {
          return
        }
        const cny = data.balance_infos.find((info) => info.currency === 'CNY')
        const usd = data.balance_infos.find((info) => info.currency === 'USD')
        const amount = cny ? Number(cny.total_balance) : usd ? Number(usd.total_balance) * 7.2 : NaN
        if (!Number.isFinite(amount) || amount >= 3) {
          return
        }
        const today = dayKeyOf(Date.now())
        try {
          if (localStorage.getItem('chat-demo:low-balance-date') === today) {
            return
          }
          localStorage.setItem('chat-demo:low-balance-date', today)
        } catch {
          // 忽略存储异常
        }
        setBalanceWarning({ kind: 'low', amount })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ready])

  // 服务端返回余额用尽时立即提示
  useEffect(() => {
    const handler = () => setBalanceWarning({ kind: 'empty' })
    window.addEventListener('deepseek:balance-exhausted', handler)
    return () => window.removeEventListener('deepseek:balance-exhausted', handler)
  }, [])

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
        <PrivacyBanner />
      </div>
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog />
        </Suspense>
      ) : null}
      <NewChatSettingsModal />
      {balanceWarning ? (
        <Modal
          title={t(
            balanceWarning.kind === 'low' ? 'lowBalanceTitle' : 'balanceExhaustedTitle'
          )}
          onClose={() => setBalanceWarning(null)}
          footer={
            <div className={styles.balanceActions}>
              <Button variant="outlined" onClick={() => setBalanceWarning(null)}>
                {t('balanceLater')}
              </Button>
              <a
                className={styles.balanceLink}
                href="https://platform.deepseek.com/top_up"
                target="_blank"
                rel="noreferrer"
              >
                {t('balanceTopUp')}
              </a>
            </div>
          }
        >
          <div className={styles.balanceText}>
            {balanceWarning.kind === 'low'
              ? t('lowBalanceBody', { amount: balanceWarning.amount.toFixed(2) })
              : t('balanceExhaustedBody')}
          </div>
        </Modal>
      ) : null}
      <Toast />
      <AppContextMenu />
      <ImageViewer />
    </>
  )
}

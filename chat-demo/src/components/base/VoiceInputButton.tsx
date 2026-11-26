import { useTranslate } from '../../i18n/index.js'
import { useVoiceInput } from '../chatInput/useVoiceInput.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { IconMicOutline16, IconStopFill16 } from './icons.js'
import { IconButton } from './IconButton.js'

/** 通用语音输入按钮：点击开始录音，再次点击转写并把文本交给 onText。 */
export const VoiceInputButton = ({
  onText,
  size = 'xs',
}: {
  onText: (text: string) => void
  size?: 'xs' | 'm'
}) => {
  const t = useTranslate()
  const { status, toggle } = useVoiceInput(onText)
  const recording = status === 'recording'
  return (
    <IconButton
      icon={recording ? <IconStopFill16 /> : <IconMicOutline16 />}
      size={size}
      tooltip={
        recording
          ? t('voiceInputStop')
          : status === 'transcribing'
            ? t('voiceInputTranscribing')
            : t('voiceInputStart')
      }
      disabled={!window.isSecureContext}
      onClick={() => {
        if (status === 'idle' && !ensureApiKey()) {
          return
        }
        void toggle()
      }}
    />
  )
}

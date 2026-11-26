import { createId } from '../utils/id.js'
import { streamMessage } from './api/client.js'
import type { MessageParam, MessageUsage } from './api/types.js'
import { getVisibleMessages } from './chat/branches.js'
import * as db from './chat/db.js'
import { getContextRounds, toRequestMessages } from './chat/reply.js'
import { useChatStore } from './chat/store.js'
import type { AssistantMessage, UserMessage } from './chat/types.js'
import { ME_MEMORY_LIMIT, useSettings } from './settings.js'
import { recordUsage } from './usage.js'

export type MemoryChatTurn = {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 本轮助手回复是否产生了更新后的记忆草稿 */
  proposedMemory?: string
}

export type MemoryExtractionResult =
  | { status: 'updated'; highlights: string; memory: string }
  | { status: 'unchanged'; highlights: string }

const stripTag = (raw: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(raw)
  return match ? match[1].trim() : null
}

/** 从记忆对话的流式/完整回复中分离自然语言回复与 <memory>...</memory> 块 */
export const parseMemoryChatReply = (
  raw: string
): { visibleText: string; hasIncompleteMemoryTag: boolean; proposedMemory: string | null } => {
  const complete = /<memory>([\s\S]*?)<\/memory>/i.exec(raw)
  if (complete) {
    const visibleText = `${raw.slice(0, complete.index)}${raw.slice(complete.index + complete[0].length)}`.trim()
    const memory = complete[1].trim().slice(0, ME_MEMORY_LIMIT)
    return {
      visibleText,
      hasIncompleteMemoryTag: false,
      proposedMemory: memory || null,
    }
  }
  const openIndex = raw.search(/<memory>/i)
  if (openIndex >= 0) {
    return {
      visibleText: raw.slice(0, openIndex).trim(),
      hasIncompleteMemoryTag: true,
      proposedMemory: null,
    }
  }
  return {
    visibleText: raw.trim(),
    hasIncompleteMemoryTag: false,
    proposedMemory: null,
  }
}

const trackSyntheticUsage = (
  kind: 'memory-chat' | 'memory-summary',
  model: 'deepseek-flash' | 'deepseek-v4-pro',
  createdAt: number,
  usage?: MessageUsage
) => {
  if (!usage || useChatStore.getState().privacyMode) {
    return
  }
  const synthetic: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt,
    model,
    prefix: false,
    status: 'done',
    blocks: [],
    usage,
  }
  recordUsage(kind, synthetic)
}

/**
 * 与记忆对话：用户通过自然语言对话补充、修正、润色个人记忆。
 * 返回助手对用户的回复，以及可选的完整新记忆文章文本（需由用户确认后再覆盖本地记忆）。
 */
export const converseWithMemory = async ({
  draftMemory,
  history,
  userInput,
  signal,
  onStreamText,
}: {
  draftMemory: string
  history: MemoryChatTurn[]
  userInput: string
  signal: AbortSignal
  onStreamText: (rawText: string) => void
}): Promise<{ visibleText: string; proposedMemory: string | null }> => {
  const settings = useSettings.getState()
  const apiKey = settings.apiKey ?? ''
  if (!apiKey) {
    throw new Error('Missing API key')
  }
  const { nickname, background } = settings.me
  const zh = settings.locale !== 'en-US'

  const system = zh
    ? [
        '你是用户的「个人记忆助手」。你的职责是通过自然对话帮助用户记录、补充、修正并整理他们的长期个人记忆。',
        '【重要格式要求】',
        '1. 记忆本身是一大段或若干段连贯、流畅的文章式描述（第三人称“用户…”），绝对不要写成零碎的条列清单、标题列表或卡片式短句。',
        '2. 先用简洁自然的语言回应用户（1～3 句话即可）。',
        '3. 如果用户的发言包含了需要新增、修改、删除或重新整理的个人信息/偏好/背景/习惯/目标，请在回复末尾另起一行输出完整的最新记忆文章，用 <memory> 和 </memory> 标签包裹：',
        '<memory>\n完整的新记忆文章\n</memory>',
        '4. 必须保留现有记忆中仍然有效的内容，不能擅自丢弃未提及的已有记忆，只能在现有基础上增补、润色或按用户要求修正。',
        '5. 如果用户只是询问当前记住了什么或普通闲聊、无需改动记忆，则不要输出 <memory> 标签。',
        `6. 总字数控制在 ${ME_MEMORY_LIMIT} 字符以内，不要编造用户未提供的信息。`,
        nickname || background
          ? `已知基础档案（无需重复堆砌，保持一致即可）：称呼=${nickname || '未填'}；背景=${background || '未填'}`
          : '',
        `【当前记忆全文】\n${draftMemory.trim() || '（暂无已有记忆）'}`,
      ]
        .filter(Boolean)
        .join('\n')
    : [
        'You are the user’s Personal Memory Assistant. Help the user record, refine, correct, and organize their long-term personal memory through natural conversation.',
        'Rules:',
        '1. Memory must be written as cohesive, flowing prose paragraphs (third-person "The user..."), NEVER as fragmented bullet points or headings.',
        '2. Reply concisely and naturally first (1–3 sentences).',
        '3. Whenever the user adds, changes, removes, or asks to reorganize personal facts/preferences/background/goals, append the COMPLETE updated prose memory wrapped in <memory>...</memory> tags at the end of your reply:',
        '<memory>\nComplete updated prose memory\n</memory>',
        '4. Preserve existing valid memories unless explicitly corrected or removed by the user; only refine or add seamlessly.',
        '5. If the user is only asking a question without changing memory, omit the <memory> tag.',
        `6. Keep memory within ${ME_MEMORY_LIMIT} characters and never invent facts.`,
        nickname || background
          ? `Known profile fields: name=${nickname || 'unset'}, background=${background || 'unset'}`
          : '',
        `[Current Memory]\n${draftMemory.trim() || '(Empty)'}`,
      ]
        .filter(Boolean)
        .join('\n')

  const messages: MessageParam[] = [
    ...history.map(
      (turn): MessageParam =>
        turn.role === 'user'
          ? { role: 'user', content: turn.content }
          : { role: 'assistant', content: [{ type: 'text', text: turn.content }] }
    ),
    { role: 'user', content: userInput },
  ]

  const startedAt = Date.now()
  let rawText = ''
  let latestUsage: MessageUsage | undefined
  for await (const event of streamMessage(
    apiKey,
    {
      model: settings.modelSettings.model,
      system,
      messages,
      thinking: { type: 'disabled' },
      tools: [],
      max_tokens: 4096,
    },
    signal
  )) {
    if (event.type === 'message_start' && event.message.usage) {
      latestUsage = event.message.usage
    } else if (event.type === 'message_delta' && event.usage) {
      latestUsage = event.usage
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      rawText += event.delta.text
      onStreamText(rawText)
    }
  }

  trackSyntheticUsage('memory-chat', settings.modelSettings.model, startedAt, latestUsage)
  const parsed = parseMemoryChatReply(rawText)
  if (!parsed.visibleText && !parsed.proposedMemory) {
    throw new Error('Empty memory reply')
  }
  return {
    visibleText: parsed.visibleText,
    proposedMemory: parsed.proposedMemory,
  }
}

/**
 * 从指定会话的完整上下文（存在压缩时从压缩点起，模拟正常对话但不进入原会话）
 * 结合现有记忆总结新的个人记忆，交由用户查看确认后覆盖。
 */
export const extractMemoryFromSession = async (
  sessionId: string,
  { signal }: { signal: AbortSignal }
): Promise<MemoryExtractionResult> => {
  const settings = useSettings.getState()
  const apiKey = settings.apiKey ?? ''
  if (!apiKey) {
    throw new Error('Missing API key')
  }
  const cache = useChatStore.getState().sessionCache
  const session = Object.hasOwn(cache, sessionId) ? cache[sessionId] : await db.loadSession(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }

  const path = getVisibleMessages(session)
  const compaction = session.compaction
  let history = path
  let digest = ''
  if (compaction) {
    const cut = history.findIndex((message) => message.id === compaction.upToMessageId)
    if (cut >= 0) {
      history = history.slice(cut + 1)
      digest = compaction.digest
    }
  }

  const rounds = getContextRounds(history)
  if (rounds.length === 0 && !digest) {
    throw new Error('NoContext')
  }

  const zh = settings.locale !== 'en-US'
  const existingMemory = settings.me.memory.trim()
  const { nickname, background } = settings.me

  const question: UserMessage = {
    id: 'memory-extract-request',
    role: 'user',
    content: zh
      ? '请根据以上完整对话上下文以及系统提示中提供的现有个人记忆，提炼出值得长期记住的关于我个人的稳定信息（如身份、专业技能、长期项目、生活/工作偏好、习惯、目标等），与现有记忆融合生成一份新的完整记忆。'
      : 'Based on the conversation context above and my existing personal memory in the system prompt, extract any lasting personal details worth remembering about me (identity, skills, ongoing projects, preferences, habits, goals) and merge them with my existing memory into an updated cohesive profile.',
    files: [],
    createdAt: Date.now(),
  }

  const messages = toRequestMessages(history, question, undefined, false)
  const systemParts = [
    zh
      ? [
          '你是一个个人长期记忆提炼器。请结合用户的对话历史与【现有个人记忆】，生成更新后的个人记忆。',
          '【严格规则】',
          '1. 只能修正或增加，绝对不要破坏或删掉现有记忆中仍然有效的既有事实。',
          '2. 新生成的记忆必须是一大段或若干段连贯、流畅的文章式描述（第三人称“用户…”），禁止写成零碎的条列清单。',
          '3. 只提炼对未来对话有长期参考价值的个人事实与偏好，忽略一次性的临时任务细节（例如某次偶发的代码报错）。',
          '4. 严格按以下格式输出：',
          '   - 在 <highlights>...</highlights> 中用 1～4 句简述本次新提取或修正的记忆点（若没有任何可提取的新记忆，填写“无新增”）；',
          '   - 若有新增或修正，在 <memory>...</memory> 中输出融合后的完整新记忆文章（不超过 ' +
            `${ME_MEMORY_LIMIT} 字符）；`,
          '   - 若对话中没有值得记忆的新个人点，则不要输出 <memory> 标签，或输出 <no_change/>。',
          nickname || background
            ? `已知基础档案（仅作背景参考，避免冲突）：称呼=${nickname || '未填'}；背景=${background || '未填'}`
            : '',
          `【现有个人记忆】\n${existingMemory || '（暂无已有记忆）'}`,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'You are a long-term personal memory extractor. Combine the conversation context with the user’s [Existing Memory] to produce an updated personal memory.',
          'Strict rules:',
          '1. Only refine or add — NEVER destroy or drop valid existing facts unless clearly corrected by the conversation.',
          '2. The updated memory MUST be written as cohesive, flowing prose paragraphs (third-person "The user..."), never as fragmented bullet lists.',
          '3. Extract only lasting personal facts, skills, ongoing projects, preferences, habits, or goals; ignore transient task details.',
          '4. Output strictly in this format:',
          '   - Inside <highlights>...</highlights>, briefly list (1–4 short points) what was newly extracted or updated (or "None" if nothing new).',
          `   - If anything new/updated was found, output the complete merged prose memory inside <memory>...</memory> (max ${ME_MEMORY_LIMIT} chars).`,
          '   - If nothing worthwhile was found, output <no_change/> instead of <memory>.',
          nickname || background
            ? `Known profile fields: name=${nickname || 'unset'}, background=${background || 'unset'}`
            : '',
          `[Existing Memory]\n${existingMemory || '(Empty)'}`,
        ]
          .filter(Boolean)
          .join('\n'),
    digest ? `${zh ? '较早对话摘要：' : 'Earlier conversation summary:'}\n${digest}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const startedAt = Date.now()
  let rawText = ''
  let latestUsage: MessageUsage | undefined
  for await (const event of streamMessage(
    apiKey,
    {
      model: settings.modelSettings.model,
      system: systemParts,
      messages,
      thinking: { type: 'disabled' },
      tools: [],
      max_tokens: 4096,
    },
    signal
  )) {
    if (event.type === 'message_start' && event.message.usage) {
      latestUsage = event.message.usage
    } else if (event.type === 'message_delta' && event.usage) {
      latestUsage = event.usage
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      rawText += event.delta.text
    }
  }

  trackSyntheticUsage('memory-summary', settings.modelSettings.model, startedAt, latestUsage)

  const highlights = stripTag(rawText, 'highlights') ?? ''
  const memory = stripTag(rawText, 'memory')?.slice(0, ME_MEMORY_LIMIT) ?? ''
  const noChange = /<no_change\s*\/?>/i.test(rawText) || !memory || memory === existingMemory

  if (noChange) {
    return {
      status: 'unchanged',
      highlights: highlights || (zh ? '本次对话未发现需要新增或修正的长期个人记忆。' : 'No new personal facts worth saving were found in this conversation.'),
    }
  }

  return {
    status: 'updated',
    highlights,
    memory,
  }
}

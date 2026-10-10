import { describe, expect, it, vi } from 'vitest'
import { requestsVoiceEnd } from '../server/contracts'
import { VoiceSession, type VoicePhase } from '../src/ui/voice'

describe('日常语音收尾', () => {
  it.each([
    '那今天先到这儿了，我们明天再聊。',
    '今天先到这里吧。',
    '今天就到这儿。',
    '今天先到这吧。',
    '我们明天再聊。',
    '咱们明天再聊吧。',
    '明天再聊。',
    '好，明天再聊吧。',
    '刚才还想继续聊，不过现在我们明天再聊。',
    '先接着聊今天的事，不过今天先到这里吧。',
    '今天先到这里，之后我们继续打字聊。',
    '明天再聊，不过我们继续文字聊天。',
    '卡片文案写「明天再聊」，今天先到这里吧。',
  ])('明确收尾 %s 结束当前语音', text => {
    expect(requestsVoiceEnd(text)).toBe(true)
  })

  it.each([
    '这版就到这里。',
    '这个作品今天先到这里吧。',
    '本轮需求今天先到这里了。',
    '我们明天再聊这个功能。',
    '明天再聊是什么意思？',
    '今天先到这里是按钮文案。',
    '按钮叫“明天再聊”。',
    '「明天再聊」',
    '『今天先到这里吧』',
    '「今天先到这里，我们明天再聊。」',
    '『今天先到这里。明天再聊。』',
    '"我们明天再聊"',
    '`今天先到这里吧`',
    '如果我说我们明天再聊，你会怎么做？',
    '假如今天先到这里，那剩下怎么办？',
    '比如我们明天再聊，先不做决定。',
    '我们明天再聊，不过现在还想问一个问题。',
    '今天先到这里，不过现在继续聊。',
    '明天再聊，不过不要结束语音。',
  ])('作品、引用、假设或最新继续 %s 保持语音', text => {
    expect(requestsVoiceEnd(text)).toBe(false)
  })

  it.each([
    { text: '那今天先到这儿了，我们明天再聊。', done: true },
    { text: '我们明天再聊。', done: true },
    { text: '明天再聊，不过现在继续聊。', done: false },
    { text: '这个作品今天先到这里吧。', done: false },
  ])('播完最新一句以后才根据真实结束判断切换 $text', async ({ text, done }) => {
    const phases: VoicePhase[] = [], enabled: boolean[] = [], chats: string[] = []
    let utterance!: (audio: Blob | undefined, final?: boolean) => void, closed = 0, completePlayback!: () => void
    const playback = new Promise<void>(resolve => { completePlayback = resolve })
    const session = new VoiceSession({
      capture: async (_signal, ready) => { utterance = ready; return { enable(value) { enabled.push(value) }, close() { closed++ } } },
      transcribe: async () => text,
      chat: async received => { chats.push(received); return { text: '这一句的回复。', done: requestsVoiceEnd(received) } },
      play: async () => playback,
      changed: phase => { phases.push(phase) },
      transcript() {},
    })
    try {
      await session.start(); utterance(new Blob(['recorded audio']))
      await vi.waitFor(() => expect(phases.at(-1)).toBe('speaking'))
      expect(closed).toBe(0); expect(chats).toEqual([text]); expect(enabled).toEqual([true, false])
      completePlayback()
      await vi.waitFor(() => expect(phases.at(-1)).toBe(done ? 'off' : 'listening'))
      expect(closed).toBe(done ? 1 : 0); expect(enabled).toEqual(done ? [true, false] : [true, false, true])
    } finally { completePlayback(); session.stop() }
  })
})

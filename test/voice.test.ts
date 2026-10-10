import { describe, it, expect, vi, afterEach } from 'vitest'
import { VoiceSession, SpeechSegmenter, wav, captureMicrophone, type VoicePorts, type VoicePhase, type Capture, type VoiceInvitation } from '../src/ui/voice'
import { handoffDecision, requestsExplicitHandoff, requestsBuildCancellation, requestsContinuedDiscussion, requestsVoiceEnd, spokenInvitation, type Project } from '../server/contracts'
import { decodePcmWave, LocalAsr } from '../server/asr'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed }); return { promise, resolve, reject } }
function conversation(overrides: Partial<VoicePorts> = {}) {
  const phases: VoicePhase[] = [], enables: boolean[] = [], transcripts: string[] = [], requests: string[] = [], playback: string[] = [], warnings: {phase: VoicePhase; error: string}[] = [], captureSignals: AbortSignal[] = []
  let deliver!: (audio: Blob | undefined, final?: boolean) => void
  let breakMicrophone!: (error: Error) => void
  let closed = 0
  const ports: VoicePorts = {
    capture: async (signal, utterance, failed) => { captureSignals.push(signal); deliver = utterance; breakMicrophone = failed; return { enable: value => { enables.push(value) }, close: () => { closed++ } } },
    transcribe: async () => '做一个抽签小程序',
    chat: async text => { requests.push(text); return { text: '你想放几件事？' } },
    play: async text => { playback.push(text) },
    changed: (phase, error) => { phases.push(phase); if (error) warnings.push({phase,error}) }, transcript: text => { transcripts.push(text) }, ...overrides,
  }
  const session = new VoiceSession(ports)
  return { session, phases, enables, transcripts, requests, playback, warnings, captureSignals, breakMicrophone: (error: Error) => breakMicrophone(error), deliver: (final = true) => deliver(new Blob(['speech']), final), finish: () => deliver(undefined, true), closed: () => closed }
}

describe('持续语音聊天', () => {
  it('无音频的结束标记只汇总已识别的长句，不启动第二次识别', async () => {
    let calls = 0; const c = conversation({ transcribe: async () => { calls++; return '已经说完的完整内容' } }); await c.session.start()
    c.finish(); expect(calls).toBe(0); expect(c.enables).toEqual([true]); c.deliver(false); await vi.waitFor(() => expect(calls).toBe(1)); c.finish()
    await vi.waitFor(() => expect(c.requests).toEqual(['已经说完的完整内容'])); expect(calls).toBe(1); c.session.stop()
  })
  it('长句分段识别期间继续听，实际停顿后只提交完整的一轮', async () => {
    const first = deferred<string>(); let calls = 0
    const c = conversation({ transcribe: async () => ++calls === 1 ? first.promise : calls === 2 ? '后半句' : '先不编程' }); await c.session.start()
    c.deliver(false); c.deliver(false); expect(calls).toBe(1); expect(c.phases.at(-1)).toBe('listening'); expect(c.enables).toEqual([true]); expect(c.requests).toEqual([])
    c.deliver(); expect(c.phases.at(-1)).toBe('transcribing'); first.resolve('前半句'); await vi.waitFor(() => expect(c.requests).toEqual(['前半句 后半句 先不编程']))
    expect(c.transcripts).toEqual(['前半句 后半句 先不编程']); expect(c.playback).toHaveLength(1); expect(c.enables).toEqual([true, false, true]); c.session.stop()
  })
  it('长句结尾只有静音时保留先前文字，下一轮不混入旧内容', async () => {
    let calls = 0; const c = conversation({ transcribe: async () => ['完整的前半段', ' ', '下一句话'][calls++] }); await c.session.start()
    c.deliver(false); await vi.waitFor(() => expect(calls).toBe(1)); c.deliver(); await vi.waitFor(() => expect(c.requests).toEqual(['完整的前半段']))
    c.deliver(); await vi.waitFor(() => expect(c.requests).toEqual(['完整的前半段', '下一句话'])); c.session.stop()
  })
  it('退出时取消长句的待处理识别，旧结果不进入重开的会话', async () => {
    const old = deferred<string>(); let calls = 0, oldSignal!: AbortSignal
    const c = conversation({ transcribe: async (_audio, signal) => { if (++calls === 1) { oldSignal = signal; return old.promise } return '新的这一句' } }); await c.session.start()
    c.deliver(false); c.session.stop(); expect(oldSignal.aborted).toBe(true); await c.session.start(); c.deliver(); old.resolve('旧的前半段')
    await vi.waitFor(() => expect(c.requests).toEqual(['新的这一句'])); expect(c.transcripts).toEqual(['新的这一句']); c.session.stop(); expect(c.closed()).toBe(2)
  })
  it('任意分段识别失败都不把不完整需求交给聊天', async () => {
    let calls = 0; const c = conversation({ transcribe: async () => { if (++calls === 1) return '前半段'; throw new Error('recognition failed') } }); await c.session.start()
    c.deliver(false); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('error')); expect(c.requests).toEqual([]); expect(c.transcripts).toEqual([]); expect(c.closed()).toBe(1)
  })
  it('长句等待结束时作品提醒不能抢话，即使采集端没有提供 busy', async () => {
    let calls = 0; const c = conversation({ transcribe: async () => ++calls === 1 ? '还在讲的前半段' : '终于说完' }); await c.session.start()
    c.deliver(false); await vi.waitFor(() => expect(calls).toBe(1)); c.session.announce('作品可以预览了'); expect(c.playback).toEqual([]); expect(c.enables).toEqual([true])
    c.deliver(); await vi.waitFor(() => expect(c.playback).toEqual(['你想放几件事？', '作品可以预览了'])); expect(c.requests).toEqual(['还在讲的前半段 终于说完']); c.session.stop()
  })
  it('长句分段之间不发制作接话，完整回复结束后恢复接话', async () => {
    vi.useFakeTimers(); let generated = 0; const c = conversation({ followup: async () => { generated++; return { text: '想给它什么颜色？', accept: async () => true } } }); await c.session.start()
    c.session.followBuild('run', 'lively'); c.deliver(false); await vi.advanceTimersByTimeAsync(0); c.session.followBuild('run', 'standard'); await vi.advanceTimersByTimeAsync(25000); expect(generated).toBe(0); expect(c.requests).toEqual([])
    c.deliver(); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(25000); expect(generated).toBe(1); c.session.stop()
  })
  it('明确道别后等最后一句播完再退出，不重新开启聆听', async () => {
    const played = deferred<void>(); let calls = 0
    const c = conversation({chat:async()=>{calls++;return {text:'晚安，好好休息。',done:true}},play:async()=>played.promise})
    await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('speaking'))
    expect(c.closed()).toBe(0);played.resolve();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('off'))
    expect(c.closed()).toBe(1);expect(c.enables).toEqual([true,false]);c.deliver();await Promise.resolve();expect(calls).toBe(1)
  })
  it('打断道别后仍可接着说，旧的道别结果不关闭新聆听', async () => {
    const played = deferred<void>();const c=conversation({chat:async()=>({text:'晚安。',done:true}),play:async()=>played.promise})
    await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('speaking'))
    c.session.interrupt();played.resolve();await played.promise;await Promise.resolve()
    expect(c.phases.at(-1)).toBe('listening');expect(c.closed()).toBe(0);expect(c.enables).toEqual([true,false,true]);c.session.stop()
  })
  it('说完自动发给对话，播完恢复聆听，第二轮无需按发送', async () => {
    const c = conversation(); await c.session.start()
    c.deliver(); await vi.waitFor(() => expect(c.playback).toEqual(['你想放几件事？']))
    expect(c.phases.at(-1)).toBe('listening')
    c.deliver(); await vi.waitFor(() => expect(c.requests).toEqual(['做一个抽签小程序', '做一个抽签小程序']))
    expect(c.transcripts).toEqual(['做一个抽签小程序', '做一个抽签小程序'])
    expect(c.enables).toEqual([true, false, true, false, true])
    c.session.stop(); expect(c.closed()).toBe(1)
  })
  it('正在识别时忽略重复的录音结束回调', async () => {
    const text = deferred<string>(); let calls = 0
    const c = conversation({ transcribe: async () => { calls++; return text.promise } }); await c.session.start()
    c.deliver(); c.deliver(); expect(calls).toBe(1)
    text.resolve('做抽签'); await vi.waitFor(() => expect(c.requests).toEqual(['做抽签']))
    c.session.stop()
  })
  it('无识别文字时继续听，不给模型发送空白消息', async () => {
    const c = conversation({ transcribe: async () => '  ' }); await c.session.start(); c.deliver()
    await vi.waitFor(() => expect(c.enables).toEqual([true, false, true]))
    expect(c.requests).toEqual([]); expect(c.playback).toEqual([]); c.session.stop()
  })
  it('结束语音后，迟到的识别结果不会继续请求模型', async () => {
    const text = deferred<string>(); const c = conversation({ transcribe: async () => text.promise })
    await c.session.start(); c.deliver(); c.session.stop(); text.resolve('迟到的录音')
    await text.promise; await Promise.resolve(); await Promise.resolve()
    expect(c.requests).toEqual([]); expect(c.phases.at(-1)).toBe('off'); expect(c.closed()).toBe(1)
  })
  it('权限申请期间退出，迟到的麦克风资源立即关闭', async () => {
    const capture = deferred<Capture>(); let closed = 0
    const c = conversation({ capture: async () => capture.promise })
    const started = c.session.start(); c.session.stop(); capture.resolve({ enable: () => {}, close: () => { closed++ } }); await started
    expect(closed).toBe(1); expect(c.phases.at(-1)).toBe('off'); expect(c.requests).toEqual([])
  })
  it('已生成回复的播放失败会提示并恢复原麦克风聆听', async () => {
    const c = conversation({ play: async () => { throw new Error('audio unavailable') } }); await c.session.start(); c.deliver()
    await vi.waitFor(() => expect(c.warnings).toEqual([{phase:'listening',error:'audio unavailable'}]))
    expect(c.phases.at(-1)).toBe('listening'); expect(c.closed()).toBe(0); expect(c.enables).toEqual([true, false, true]); c.session.stop()
  })
  it('回复声音失败后下一句仍自动提交且不新建麦克风', async () => {
    let played=0; const c=conversation({play:async()=>{if(++played===1)throw new Error('MiMo timeout')}});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.warnings).toHaveLength(1));c.deliver();await vi.waitFor(()=>expect(played).toBe(2));expect(c.requests).toEqual(['做一个抽签小程序','做一个抽签小程序']);expect(c.captureSignals).toHaveLength(1);expect(c.captureSignals[0].aborted).toBe(false);expect(c.closed()).toBe(0);expect(c.enables).toEqual([true,false,true,false,true]);c.session.stop()
  })
  it('回复声音失败只取消旧播放，不自动重复对话或播放', async () => {
    vi.useFakeTimers();let played=0,signal!:AbortSignal;const c=conversation({play:async(_text,value)=>{played++;signal=value;throw new Error('MiMo timeout')}});await c.session.start();c.deliver();await vi.advanceTimersByTimeAsync(0);expect(signal.aborted).toBe(true);expect(c.captureSignals[0].aborted).toBe(false);await vi.advanceTimersByTimeAsync(90000);expect(played).toBe(1);expect(c.requests).toEqual(['做一个抽签小程序']);expect(c.phases.at(-1)).toBe('listening');c.session.stop()
  })
  it('道别声音失败仍关闭语音并保留播放失败提示', async () => {
    const c=conversation({chat:async()=>({text:'下次再聊。',done:true}),play:async()=>{throw new Error('speaker unavailable')}});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.warnings).toEqual([{phase:'off',error:'speaker unavailable'}]));expect(c.phases.at(-1)).toBe('off');expect(c.closed()).toBe(1);expect(c.enables).toEqual([true,false]);expect(c.captureSignals[0].aborted).toBe(true)
  })
  it('一条交付声音失败不会清掉后续已排队的交付提醒', async () => {
    const pending=deferred<void>(),played:string[]=[];const c=conversation({play:async(text)=>{played.push(text);if(text==='第一版可以预览了')await pending.promise}});await c.session.start();c.session.announce('第一版可以预览了');c.session.announce('修复版可以预览了');pending.reject(new Error('notice unavailable'));await vi.waitFor(()=>expect(played).toEqual(['第一版可以预览了','修复版可以预览了']));expect(c.closed()).toBe(0);c.session.stop()
  })
  it('交付提醒声音失败后继续接收用户下一句', async () => {
    const c=conversation({play:async(text)=>{if(text==='作品可以预览了')throw new Error('notice unavailable')}});await c.session.start();c.session.announce('作品可以预览了');await vi.waitFor(()=>expect(c.warnings).toEqual([{phase:'listening',error:'notice unavailable'}]));c.deliver();await vi.waitFor(()=>expect(c.requests).toEqual(['做一个抽签小程序']));expect(c.phases.at(-1)).toBe('listening');expect(c.captureSignals).toHaveLength(1);expect(c.closed()).toBe(0);c.session.stop()
  })
  it('普通回复声音失败后仍播放已排队的交付提醒', async () => {
    const pending=deferred<void>(),played:string[]=[];const c=conversation({play:async(text)=>{played.push(text);if(text==='你想放几件事？')await pending.promise}});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('speaking'));c.session.announce('作品可以预览了');pending.reject(new Error('reply unavailable'));await vi.waitFor(()=>expect(played).toEqual(['你想放几件事？','作品可以预览了']));expect(c.phases.at(-1)).toBe('listening');expect(c.closed()).toBe(0);expect(c.warnings).toEqual([{phase:'listening',error:'reply unavailable'}]);c.session.stop()
  })
  it('主动接话声音失败会提示并保留同一麦克风', async () => {
    vi.useFakeTimers();let accepted=0,signal!:AbortSignal;const c=conversation({followup:async()=>({text:'像一片叶子吗？',accept:async()=>{accepted++;return true}}),play:async(_text,value)=>{signal=value;throw new Error('followup unavailable')}});await c.session.start();c.session.followBuild('run-one','standard');await vi.advanceTimersByTimeAsync(25000);expect(accepted).toBe(1);expect(signal.aborted).toBe(true);expect(c.warnings).toEqual([{phase:'listening',error:'followup unavailable'}]);expect(c.captureSignals[0].aborted).toBe(false);expect(c.closed()).toBe(0);expect(c.phases.at(-1)).toBe('listening');c.session.stop()
  })
  it('停止语音后迟到的播放失败不能重新开启麦克风', async () => {
    const pending=deferred<void>(),c=conversation({play:async()=>pending.promise});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('speaking'));c.session.stop();pending.reject(new Error('late unavailable'));await Promise.resolve();await Promise.resolve();expect(c.phases.at(-1)).toBe('off');expect(c.enables).toEqual([true,false]);expect(c.warnings).toEqual([]);expect(c.closed()).toBe(1)
  })
  it('打断后的旧播放失败不能报错或重复恢复聆听', async () => {
    const pending=deferred<void>(),c=conversation({play:async()=>pending.promise});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('speaking'));c.session.interrupt();pending.reject(new Error('late unavailable'));await Promise.resolve();await Promise.resolve();expect(c.phases.at(-1)).toBe('listening');expect(c.enables).toEqual([true,false,true]);expect(c.warnings).toEqual([]);expect(c.closed()).toBe(0);c.session.stop()
  })
  it('新会话已启动时旧播放失败不能关闭新麦克风', async () => {
    const pending=deferred<void>(),c=conversation({play:async()=>pending.promise});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('speaking'));await c.session.start();pending.reject(new Error('old unavailable'));await Promise.resolve();await Promise.resolve();expect(c.captureSignals).toHaveLength(2);expect(c.captureSignals[0].aborted).toBe(true);expect(c.captureSignals[1].aborted).toBe(false);expect(c.phases.at(-1)).toBe('listening');expect(c.warnings).toEqual([]);expect(c.closed()).toBe(1);c.session.stop()
  })
  it('模型请求失败仍暂停，不能把未生成回复当作播音故障', async () => {
    const c=conversation({chat:async()=>{throw new Error('dialogue unavailable')}});await c.session.start();c.deliver();await vi.waitFor(()=>expect(c.phases.at(-1)).toBe('error'));expect(c.closed()).toBe(1);expect(c.playback).toEqual([]);expect(c.enables).toEqual([true,false]);expect(c.warnings).toEqual([{phase:'error',error:'dialogue unavailable'}])
  })
  it('真实采集失败仍关闭会话并暂停', async () => {
    const c=conversation();await c.session.start();c.breakMicrophone(new Error('microphone ended'));expect(c.phases.at(-1)).toBe('error');expect(c.closed()).toBe(1);expect(c.captureSignals[0].aborted).toBe(true);expect(c.warnings).toEqual([{phase:'error',error:'microphone ended'}])
  })
  it('打断回复后立即继续听，旧播放结束不重复启动录音', async () => {
    const played = deferred<void>(); const c = conversation({ play: async () => played.promise })
    await c.session.start(); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('speaking'))
    c.session.interrupt(); expect(c.phases.at(-1)).toBe('listening'); played.resolve(); await played.promise; await Promise.resolve()
    expect(c.enables).toEqual([true, false, true]); c.session.stop()
  })
  it('生成完成的提醒等当前对话播完，再播报并恢复聆听', async () => {
    const reply = deferred<void>(); const played: string[] = []
    const c = conversation({ play: async text => { played.push(text); if (played.length === 1) await reply.promise } })
    await c.session.start(); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('speaking'))
    c.session.announce('作品可以预览了'); expect(played).toEqual(['你想放几件事？'])
    reply.resolve(); await vi.waitFor(() => expect(played).toEqual(['你想放几件事？', '作品可以预览了']))
    expect(c.phases.at(-1)).toBe('listening'); c.session.stop()
  })
  it('作品提醒不切断正在说的话，停止语音会清除等待的提醒', async () => {
    vi.useFakeTimers(); let busy = true; const played: string[] = []
    const c = conversation({ capture: async () => ({ enable: () => {}, close: () => {}, busy: () => busy }), play: async text => { played.push(text) } })
    await c.session.start(); c.session.announce('作品已完成')
    await vi.advanceTimersByTimeAsync(500); expect(played).toEqual([])
    busy = false; await vi.advanceTimersByTimeAsync(250); expect(played).toEqual(['作品已完成']); expect(c.phases.at(-1)).toBe('listening')
    busy = true; c.session.announce('下一条提醒'); c.session.stop(); await vi.advanceTimersByTimeAsync(1000)
    expect(played).toEqual(['作品已完成']); expect(c.phases.at(-1)).toBe('off')
  })
})

describe('语音自然结束的边界', () => {
  it.each(['结束语音','先暂停语音吧','doda，关掉麦克风吧','今天就聊到这里，我先去睡觉了，晚安。','今天先聊到这吧','咱们先不聊了','我想停止聊天','我们下次再聊','晚安','结束语音，我们继续打字聊'])('明确结束 %s 关闭语音', text=>{
    expect(requestsVoiceEnd(text)).toBe(true)
  })

  it.each(['本来我还想继续聊，不过现在我们先聊到这里，晚安。', '我们刚才说继续聊，不过现在结束聊天吧。', '刚才还想问一个问题，但现在我们下次再聊。', '先接着聊刚才的事，不过今天不聊了。', '晚安，不过还是继续聊吧，想了想现在先聊到这里。'])('最新道别覆盖前面的继续聊天 %s', text => {
    expect(requestsVoiceEnd(text)).toBe(true)
  })

  it.each(['结束语音，不过我改主意了，继续语音聊天吧。', '晚安，不过先不要结束语音。', '先结束聊天，不过现在接着聊刚才的事。', '今天不聊了，不过我还想问一个问题。'])('最新继续聊天覆盖前面的道别 %s', text => {
    expect(requestsVoiceEnd(text)).toBe(false)
  })

  it.each(['结束语音，之后打字继续聊。', '结束语音之后打字继续聊。', '晚安，不过我们继续文字聊天。'])('继续文字聊天不取消语音关闭 %s', text => {
    expect(requestsVoiceEnd(text)).toBe(true)
  })
  it.each(['就这样','这版作品完成了，我们继续聊','作品不用再改了，聊天还没有结束','晚安，不过我还想聊刚才的事','先停这轮编程','不要结束语音，咱们继续聊','别停止聊天','如果我说结束语音，你会怎么做？','请解释“结束语音”这个按钮','把故事结局叫“晚安”','晚安是故事里的台词','睡觉之前我还想问一个问题','今天聊到这里是什么意思？','这版就到这里'])('作品状态、继续聊或引用 %s 保持语音', text=>{
    expect(requestsVoiceEnd(text)).toBe(false)
  })
})

describe('打断回复时把话轮交给用户', () => {
  it('排队的交付提示等待用户下一句，旧播放结束不能抢回话轮', async () => {
    const held = deferred<void>(), played: string[] = [], c = conversation({ play: async text => { played.push(text); if (played.length === 1) await held.promise } })
    try {
      await c.session.start(); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('speaking')); c.session.announce('这一版可以预览了'); c.session.interrupt()
      expect(c.phases.at(-1)).toBe('listening'); expect(played).toEqual(['你想放几件事？']); held.resolve(); await held.promise; await Promise.resolve(); expect(c.phases.at(-1)).toBe('listening')
      c.deliver(); await vi.waitFor(() => expect(played).toEqual(['你想放几件事？', '你想放几件事？', '这一版可以预览了'])); expect(c.requests).toHaveLength(2); expect(c.closed()).toBe(0)
    } finally { held.resolve(); c.session.stop() }
  })
  it('打断后才到达的交付提示同样等待用户，不关闭麦克风', async () => {
    const held = deferred<void>(), played: string[] = [], c = conversation({ play: async text => { played.push(text); if (played.length === 1) await held.promise } })
    try {
      await c.session.start(); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('speaking')); c.session.interrupt(); c.session.announce('刚刚完成的新版本')
      expect(c.phases.at(-1)).toBe('listening'); expect(played).toHaveLength(1); expect(c.enables.at(-1)).toBe(true)
      c.deliver(); await vi.waitFor(() => expect(played.at(-1)).toBe('刚刚完成的新版本')); expect(c.requests).toHaveLength(2)
    } finally { held.resolve(); c.session.stop() }
  })
  it('空录音不算用户已接话，提示仍等到下一句有效内容', async () => {
    const held = deferred<void>(), played: string[] = []; let recognized = 0
    const c = conversation({ transcribe: async () => ++recognized === 2 ? '' : '继续陪我聊', play: async text => { played.push(text); if (played.length === 1) await held.promise } })
    try {
      await c.session.start(); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('speaking')); c.session.announce('作品可以预览了'); c.session.interrupt(); expect(c.phases.at(-1)).toBe('listening')
      c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('listening')); expect(c.requests).toHaveLength(1); expect(played).toHaveLength(1)
      c.deliver(); await vi.waitFor(() => expect(played.at(-1)).toBe('作品可以预览了')); expect(c.requests).toHaveLength(2)
    } finally { held.resolve(); c.session.stop() }
  })
  it('用户正在拿回话轮时，等待生成的自动接话不会先开口', async () => {
    vi.useFakeTimers(); const held = deferred<void>(); let generated = 0, plays = 0
    const c = conversation({ play: async () => { if (++plays === 1) await held.promise }, followup: async () => { generated++; return { text: '你想聊聊哪个感觉？', accept: async () => true } } })
    try {
      await c.session.start(); c.session.followBuild('waiting-run', 'standard'); c.deliver(); await vi.advanceTimersByTimeAsync(0); expect(c.phases.at(-1)).toBe('speaking'); c.session.interrupt(); held.resolve(); await vi.advanceTimersByTimeAsync(60000)
      expect(generated).toBe(0); expect(c.phases.at(-1)).toBe('listening'); c.deliver(); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(25000); expect(generated).toBe(1)
    } finally { held.resolve(); c.session.stop() }
  })
  it('打断交付播报也先听用户，后续提示不连续挤掉用户的下一句', async () => {
    const held = deferred<void>(), played: string[] = [], c = conversation({ play: async text => { played.push(text); if (played.length === 1) await held.promise } })
    try {
      await c.session.start(); c.session.announce('第一个作品提示'); c.session.announce('第二个作品提示'); c.session.interrupt()
      expect(c.phases.at(-1)).toBe('listening'); expect(played).toEqual(['第一个作品提示']); c.deliver(); await vi.waitFor(() => expect(played.at(-1)).toBe('第二个作品提示')); expect(c.requests).toHaveLength(1); expect(played.filter(text => text === '第一个作品提示')).toHaveLength(1)
    } finally { held.resolve(); c.session.stop() }
  })
  it('结束并重新开始聊天会清除旧提示和旧的话轮等待', async () => {
    const held = deferred<void>(), played: string[] = [], c = conversation({ play: async text => { played.push(text); if (played.length === 1) await held.promise } })
    try {
      await c.session.start(); c.deliver(); await vi.waitFor(() => expect(c.phases.at(-1)).toBe('speaking')); c.session.announce('旧会话的提示'); c.session.interrupt(); c.session.stop(); held.resolve(); await c.session.start(); c.session.announce('新会话的提示')
      await vi.waitFor(() => expect(played.at(-1)).toBe('新会话的提示')); expect(played).toEqual(['你想放几件事？', '新会话的提示']); expect(c.phases.at(-1)).toBe('listening')
    } finally { held.resolve(); c.session.stop() }
  })
})

describe('生成等待时的语音互动', () => {
  it('空闲二十五秒接一句，不创建用户消息，同一轮仅一次', async () => {
    vi.useFakeTimers(); let generated = 0, accepted = 0
    const c = conversation({ followup: async () => { generated++; return { text: '你觉得哪一步最有意思？', accept: async () => { accepted++; return true } } } })
    await c.session.start(); c.session.followBuild('run-one', 'standard')
    await vi.advanceTimersByTimeAsync(24999); expect(generated).toBe(0)
    await vi.advanceTimersByTimeAsync(1); expect(c.playback).toEqual(['你觉得哪一步最有意思？']); expect(accepted).toBe(1)
    c.session.followBuild('run-one', 'standard'); await vi.advanceTimersByTimeAsync(60000)
    expect(generated).toBe(1); expect(c.requests).toEqual([]); expect(c.transcripts).toEqual([]); expect(c.phases.at(-1)).toBe('listening'); c.session.stop()
  })
  it('安静模式不主动说话，灵动模式仍只接一句', async () => {
    vi.useFakeTimers(); let generated = 0
    const c = conversation({ followup: async () => { generated++; return { text: '想聊聊这个点子怎么来的吗？', accept: async () => true } } })
    await c.session.start(); c.session.followBuild('run-one', 'quiet'); await vi.advanceTimersByTimeAsync(60000)
    expect(generated).toBe(0)
    c.session.followBuild('run-one', 'lively'); await vi.advanceTimersByTimeAsync(12000)
    expect(c.playback).toEqual(['想聊聊这个点子怎么来的吗？']); await vi.advanceTimersByTimeAsync(60000); expect(generated).toBe(1); c.session.stop()
  })
  it('正在说话时让开，接收到用户一句话后重新等待空闲', async () => {
    vi.useFakeTimers(); let busy = true, generated = 0
    const c = conversation({ capture: async (_signal, deliver) => { utterance = deliver; return { enable: () => {}, close: () => {}, busy: () => busy } }, followup: async () => { generated++; return { text: '还想聊点什么？', accept: async () => true } } })
    let utterance!: (wav: Blob) => void
    await c.session.start(); c.session.followBuild('run-one', 'standard'); await vi.advanceTimersByTimeAsync(26000)
    expect(generated).toBe(0)
    utterance(new Blob(['speech'])); busy = false; await vi.advanceTimersByTimeAsync(0)
    expect(c.requests).toEqual(['做一个抽签小程序'])
    await vi.advanceTimersByTimeAsync(24999); expect(generated).toBe(0)
    await vi.advanceTimersByTimeAsync(1); expect(generated).toBe(1); c.session.stop()
  })
  it('用户先说话时丢弃迟到的主动问句，不提交未播放的问题', async () => {
    vi.useFakeTimers(); const invitation = deferred<VoiceInvitation | undefined>(); let accepted = 0
    const c = conversation({ followup: async () => invitation.promise }); await c.session.start(); c.session.followBuild('run-one', 'standard')
    await vi.advanceTimersByTimeAsync(25000); c.deliver(); await vi.advanceTimersByTimeAsync(0)
    invitation.resolve({ text: '迟到的问题？', accept: async () => { accepted++; return true } }); await vi.advanceTimersByTimeAsync(0)
    expect(accepted).toBe(0); expect(c.playback).toEqual(['你想放几件事？']); expect(c.phases.at(-1)).toBe('listening'); c.session.stop()
  })
  it('生成结束后只播交付提醒，迟到的主动问句不插进来', async () => {
    vi.useFakeTimers(); const invitation = deferred<VoiceInvitation | undefined>(); let accepted = 0
    const c = conversation({ followup: async () => invitation.promise }); await c.session.start(); c.session.followBuild('run-one', 'standard')
    await vi.advanceTimersByTimeAsync(25000); c.session.followBuild(undefined, 'standard'); c.session.announce('作品可以预览了')
    invitation.resolve({ text: '迟到的问题？', accept: async () => { accepted++; return true } }); await vi.advanceTimersByTimeAsync(0)
    expect(accepted).toBe(0); expect(c.playback).toEqual(['作品可以预览了']); expect(c.phases.at(-1)).toBe('listening'); c.session.stop()
  })
  it('已经开始说的问句播完后，再播完成提醒', async () => {
    vi.useFakeTimers(); const spoken = deferred<void>(), played: string[] = []
    const c = conversation({ followup: async () => ({ text: '你最喜欢哪只小动物？', accept: async () => true }), play: async text => { played.push(text); if (text === '你最喜欢哪只小动物？') await spoken.promise } })
    await c.session.start(); c.session.followBuild('run-one', 'lively'); await vi.advanceTimersByTimeAsync(12000)
    expect(c.phases.at(-1)).toBe('speaking'); c.session.followBuild(undefined, 'lively'); c.session.announce('作品可以预览了')
    expect(played).toEqual(['你最喜欢哪只小动物？'])
    spoken.resolve(); await vi.advanceTimersByTimeAsync(0)
    expect(played).toEqual(['你最喜欢哪只小动物？', '作品可以预览了']); expect(c.phases.at(-1)).toBe('listening'); c.session.stop()
  })
  it('退出语音取消主动请求，迟到结果不复活麦克风', async () => {
    vi.useFakeTimers(); const invitation = deferred<VoiceInvitation | undefined>(); let requestSignal!: AbortSignal, accepted = 0
    const c = conversation({ followup: async signal => { requestSignal = signal; return invitation.promise } }); await c.session.start(); c.session.followBuild('run-one', 'standard')
    await vi.advanceTimersByTimeAsync(25000); c.session.stop(); expect(requestSignal.aborted).toBe(true)
    invitation.resolve({ text: '迟到的问题？', accept: async () => { accepted++; return true } }); await vi.advanceTimersByTimeAsync(0)
    expect(accepted).toBe(0); expect(c.playback).toEqual([]); expect(c.phases.at(-1)).toBe('off'); expect(c.closed()).toBe(1)
  })
  it('主动请求失败或服务器拒绝旧问句时，仍能继续聊天', async () => {
    vi.useFakeTimers(); let generated = 0
    const c = conversation({ followup: async () => { if (++generated === 1) throw new Error('provider unavailable'); return { text: '旧问句？', accept: async () => false } } })
    await c.session.start(); c.session.followBuild('run-one', 'standard'); await vi.advanceTimersByTimeAsync(25000)
    expect(c.phases.at(-1)).toBe('listening'); c.session.followBuild('run-two', 'standard'); await vi.advanceTimersByTimeAsync(25000)
    expect(c.playback).toEqual([]); expect(c.phases.at(-1)).toBe('listening'); c.deliver(); await vi.advanceTimersByTimeAsync(0)
    expect(c.requests).toEqual(['做一个抽签小程序']); expect(c.playback).toEqual(['你想放几件事？']); c.session.stop()
  })
})

describe('录音分句与 WAV', () => {
  it('实际采集工厂把分段结束标记和有界 WAV 一起传出，长句期间保持 busy', async () => {
    const stop = vi.fn(), close = vi.fn(async () => {}), track = { stop, onended: undefined }, stream = { getTracks: () => [track], getAudioTracks: () => [track] }, port = { onmessage: undefined as undefined | ((event: { data: Float32Array }) => void) }, graph = { connect: vi.fn() }, context = { sampleRate: 16000, resume: async () => {}, close, createMediaStreamSource: () => graph, createGain: () => ({ connect: vi.fn(), gain: { value: 1 } }), destination: {}, audioWorklet: { addModule: async () => {} } }, chunks: Array<{ audio: Blob | undefined, final?: boolean }> = []
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } }); vi.stubGlobal('AudioContext', function AudioContext() { return context }); vi.stubGlobal('AudioWorkletNode', function AudioWorkletNode() { return { port, connect: vi.fn(), onprocessorerror: undefined } })
    const controller = new AbortController(), failed = vi.fn(), capture = await captureMicrophone(controller.signal, (audio, final) => chunks.push({ audio, final }), failed)
    try {
      capture.enable(true); for (let i = 0; i < 250; i++) port.onmessage!({ data: new Float32Array(1600).fill(.03) }); expect(capture.busy!()).toBe(true); expect(chunks.map(chunk => chunk.final)).toEqual([false])
      for (let i = 0; i < 370; i++) port.onmessage!({ data: new Float32Array(1600).fill(.04) }); for (let i = 0; i < 12; i++) port.onmessage!({ data: new Float32Array(1600) }); expect(chunks.map(chunk => chunk.final)).toEqual([false, false, true]); expect(capture.busy!()).toBe(false)
      const decoded = await Promise.all(chunks.map(async chunk => { if (!chunk.audio) throw new Error('Voiced chunks must contain audio'); return decodePcmWave(Buffer.from(await chunk.audio.arrayBuffer())) })); expect(decoded.every(audio => audio.rate === 16000 && audio.samples.length <= 30 * 16000)).toBe(true); expect(decoded.reduce((sum, audio) => sum + audio.samples.filter(value => value > .029).length, 0)).toBe(62 * 16000)
      capture.enable(false); port.onmessage!({ data: new Float32Array(1600).fill(.03) }); expect(capture.busy!()).toBe(false); expect(failed).not.toHaveBeenCalled()
      capture.enable(true); for (let i = 0; i < 250; i++) port.onmessage!({ data: new Float32Array(1600).fill(.03) }); for (let i = 0; i < 20; i++) port.onmessage!({ data: new Float32Array(1600) }); expect(chunks.slice(3).map(chunk => chunk.final)).toEqual([false, true]); expect(chunks.at(-1)!.audio).toBeUndefined(); expect(capture.busy!()).toBe(false)
    } finally { capture.close() }
    controller.abort(); expect(stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
  })
  it.each([16000, 48000])('%sHz 的长句保留后半段，分段最长仍可交给三十秒接口', rate => {
    const heard: Array<{ samples: Float32Array, final?: boolean }> = [], segmenter = new SpeechSegmenter(rate, (samples, final?: boolean) => heard.push({ samples, final }))
    for (let i = 0; i < 5; i++) segmenter.push(new Float32Array(rate / 10))
    for (let i = 0; i < 350; i++) segmenter.push(new Float32Array(rate / 10).fill(i < 250 ? .03 : .04))
    expect(heard).toHaveLength(1); expect(heard[0].final).toBe(false); expect(segmenter.busy()).toBe(true)
    for (let i = 0; i < 12; i++) segmenter.push(new Float32Array(rate / 10))
    expect(heard).toHaveLength(2); expect(heard[1].final).toBe(true); expect(segmenter.busy()).toBe(false); expect(heard.every(part => part.samples.length / rate <= 30)).toBe(true)
    const tail = heard[1].samples.filter(value => value > .039); expect(tail.length).toBe(rate * 10)
  })
  it('恰好在分段边界说完也发出一次最终结束标记', () => {
    const flags: Array<boolean | undefined> = [], lengths: number[] = [], segmenter = new SpeechSegmenter(16000, (samples, final?: boolean) => { flags.push(final); lengths.push(samples.length) })
    for (let i = 0; i < 250; i++) segmenter.push(new Float32Array(1600).fill(.03)); expect(flags).toEqual([false]); expect(segmenter.busy()).toBe(true)
    for (let i = 0; i < 20; i++) segmenter.push(new Float32Array(1600)); expect(flags).toEqual([false, true]); expect(lengths[1]).toBe(0); expect(segmenter.busy()).toBe(false)
  })
  it('清除长句采集后下一句不会继承未完成状态', () => {
    const flags: Array<boolean | undefined> = [], segmenter = new SpeechSegmenter(16000, (_samples, final?: boolean) => flags.push(final))
    for (let i = 0; i < 250; i++) segmenter.push(new Float32Array(1600).fill(.03)); segmenter.reset(); expect(segmenter.busy()).toBe(false)
    for (let i = 0; i < 5; i++) segmenter.push(new Float32Array(1600).fill(.04)); for (let i = 0; i < 12; i++) segmenter.push(new Float32Array(1600)); expect(flags).toEqual([false, true])
  })
  it('持续安静与短促碰撞不产生对话轮次', () => {
    const heard: Float32Array[] = []; const segmenter = new SpeechSegmenter(16000, data => heard.push(data))
    for (let i = 0; i < 50; i++) segmenter.push(new Float32Array(1600))
    segmenter.push(new Float32Array(800).fill(0.05))
    for (let i = 0; i < 12; i++) segmenter.push(new Float32Array(1600))
    expect(heard).toHaveLength(0)
  })
  it('一句话经过短暂停顿保持同一句，较长停顿只提交一次', () => {
    const heard: Float32Array[] = []; const segmenter = new SpeechSegmenter(16000, data => heard.push(data))
    for (let i = 0; i < 4; i++) segmenter.push(new Float32Array(1600).fill(0.03))
    for (let i = 0; i < 3; i++) segmenter.push(new Float32Array(1600))
    for (let i = 0; i < 4; i++) segmenter.push(new Float32Array(1600).fill(0.03))
    for (let i = 0; i < 12; i++) segmenter.push(new Float32Array(1600))
    expect(heard).toHaveLength(1); expect(heard[0].length).toBe(33600)
  })
  it('48k 采样录音转换成 16k 单声道 PCM16 WAV', async () => {
    const audio = wav(new Float32Array(48000).fill(0.5), 48000)
    const bytes = await audio.arrayBuffer(); const header = new DataView(bytes)
    expect(audio.type).toBe('audio/wav'); expect(bytes.byteLength).toBe(32044)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(header.getUint32(24, true)).toBe(16000); expect(header.getUint16(22, true)).toBe(1); expect(header.getUint16(34, true)).toBe(16)
    expect(header.getInt16(44, true)).toBe(16384)
  })
  it('客户端 WAV 可被服务端解码为完整音频', async () => {
    const audio = Buffer.from(await wav(new Float32Array(4800).fill(0.5), 48000).arrayBuffer())
    const decoded = decodePcmWave(audio)
    expect(decoded.rate).toBe(16000); expect(decoded.samples).toHaveLength(1600); expect(decoded.samples[0]).toBe(0.5)
  })
  it('损坏的 WAV 被拒绝，不交给原生识别器', async () => {
    const audio = Buffer.from(await wav(new Float32Array(1600), 16000).arrayBuffer())
    expect(() => decodePcmWave(audio.subarray(0, audio.length - 2))).toThrow('录音文件不完整')
  })
  it('超过三十秒的录音被拒绝', async () => {
    const audio = Buffer.from(await wav(new Float32Array(16000 * 31), 16000).arrayBuffer())
    expect(() => decodePcmWave(audio)).toThrow('不超过 30 秒')
  })
  it.each([.16, .96])('%s 秒的有效全零录音返回空文本并跳过本机模型', async seconds => {
    const asr = new LocalAsr('unprepared-silence-fixture'), available = vi.spyOn(asr, 'available'), audio = Buffer.from(await wav(new Float32Array(Math.round(16000 * seconds)), 16000).arrayBuffer())
    await expect(asr.transcribe(audio, new AbortController().signal)).resolves.toBe(''); expect(available).not.toHaveBeenCalled(); await asr.close()
  })
  it('已经取消的本机识别不会启动识别进程', async () => {
    const asr = new LocalAsr('nonexistent-test-model'); const controller = new AbortController(); controller.abort()
    await expect(asr.transcribe(Buffer.from('invalid'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await asr.close()
  })
})

function proposal(): Project {
  return { id: 'project', name: '抽签', createdAt: '', updatedAt: '', phase: 'explore', messages: [{ id: 'offer', role: 'assistant', content: '「抽签」的这轮需求整理好了，细节都在需求卡里。就按这张卡交给编程伙伴吗？', time: '' }], revision: 2, handoffRevision: 2, designId: 'soft-blue', runs: [], inspirations: [], archive: { highlights: '', interview: '' }, brief: { title: '抽签', audience: '自己', purpose: '决定先做哪件事', features: ['抽出一件事'], pages: ['首页'], acceptance: ['能抽签'], deferred: [], designId: 'soft-blue' } }
}
describe('聊天停止编程', () => {
  it.each(['先修正这张需求卡，不要编程，名字是口袋散步，首页加重新走一圈按钮。', '修正本轮需求，先别写代码，清空按钮要保留。', '不用构建，先修正这张卡给我看。', '先修正两项验收需求，不要生成代码，等我确认。'])('修正 %s 不取消任务或丢掉卡片提议', text => {
    expect(requestsBuildCancellation(text)).toBe(false)
  })
  it.each(['先修正需求卡，但停止当前编程任务。', '请修正这张卡，取消当前构建任务。', '先修正需求卡，别再写代码了。', '把需求卡修正好，先不要再生成了。'])('修正语境里的明确停止 %s 仍然取消任务', text => {
    expect(requestsBuildCancellation(text)).toBe(true)
  })
  it.each(['请把这两项修复整理到本轮需求卡给我看，先不要编程。', '先整理本轮需求，先不要编程。', '先不要编程，更新需求卡给我看。', '只总结修复卡，暂时不做；不要写代码。', '把需求整理成一张卡，不用构建。', '请更新这张需求卡，不要生成代码。'])('整理或审阅 %s 不被当作取消当前任务', text => {
    expect(requestsBuildCancellation(text)).toBe(false)
  })
  it.each(['先停止这轮编程，然后整理本轮需求卡。', '取消当前构建任务，把需求卡给我看。', '请整理需求，别再写代码了。', '先不要再生成了，重新总结需求卡。'])('明确停止 %s 仍然取消当前任务', text => {
    expect(requestsBuildCancellation(text)).toBe(true)
  })
  it.each(['先停这轮编程', '取消这轮代码生成吧', '请帮我停止生成', '这轮编程先停一下', '别再写代码了', '先不要再生成了', '别停聊天，但先取消这轮编程', '你能暂停当前编程任务吗？'])('明确要求 %s 停止当前编程', text => {
    expect(requestsBuildCancellation(text)).toBe(true)
  })
  it.each(['不要停止生成', '编程别停，我们继续聊', '暂停说话', '停止聊天', '如果我说取消这轮编程，你会怎样？', '比如取消这轮编程是什么意思', '请回答“停止生成”是什么意思', '不要执行“取消这轮编程”', '先不改需求，继续生成', '别再追问了，先写代码', '停止生成会丢掉旧版吗？', '等我说停止生成再停', '不要停止生成，但是可以继续聊天'])('讨论或否定 %s 保持编程', text => {
    expect(requestsBuildCancellation(text)).toBe(false)
  })
})
describe('等待时的可朗读问句', () => {
  it('合并模型的短句换行后保留同一个问题', () => {
    expect(spokenInvitation('  这个点子很有趣。\n\n  最喜欢哪只小动物？  ')).toBe('这个点子很有趣。 最喜欢哪只小动物？')
  })
  it.each(['', '先聊聊天。', '你喜欢哪只？还想做什么？', '{"reply":"喜欢哪只？"}', '`喜欢哪只？`', '字'.repeat(181) + '？'])('不朗读不符合等待问句约定的输出', text => {
    expect(spokenInvitation(text)).toBeUndefined()
  })
})
describe('对话需求交接', () => {
  it.each(['就按这张卡做？', '就按这个做?', '照这份需求卡做出来？', '现在开始做？', '交给 Agent ?', '好的?', '就这样？', '开始做??!'])('疑问句 %s 不确认已展示的需求卡', text => {
    expect(requestsExplicitHandoff(text)).toBe(false)
    for (const intent of ['none', 'offer', 'confirm'] as const) expect(handoffDecision(proposal(), intent, text, 2)).not.toBe('start')
  })
  it.each(['好的！', '嗯，行。'])('没有问号的自然肯定 %s 仍确认已展示的需求卡', text => {
    expect(handoffDecision(proposal(), 'confirm', text, 2)).toBe('start')
  })
  it.each(['就按这张卡做。', '按这张需求卡做吧', '照这份需求卡做出来', '就照当前需求卡做呀', '就 按 这张 卡 做出来！'])('明确确认当前卡片 %s 不再重复提问', text => {
    const project = proposal()
    expect(requestsExplicitHandoff(text)).toBe(true)
    expect(handoffDecision(project, 'none', text, 2)).toBe('start')
    expect(handoffDecision(project, 'offer', text, 2)).toBe('start')
    expect(handoffDecision(project, 'confirm', text, 2)).toBe('start')
  })
  it.each(['不要按这张卡做', '如果我说就按这张卡做呢？', '“就按这张卡做”只是按钮文案', '`就按这张卡做`', '就按这张卡做，不过先加一个登录', '就按这张卡做，等等先别开始', '等我说就按这张卡做再开始', '是不是就按这张卡做？'])('卡片引用、拒绝、提问或新增要求 %s 不执行', text => {
    expect(requestsExplicitHandoff(text)).toBe(false)
    expect(handoffDecision(proposal(), 'confirm', text, 2)).not.toBe('start')
  })
  it('卡片确认仍要求已展示的当前版本，没有确认或版本变化时先回看卡片', () => {
    const project = proposal(); delete project.handoffRevision
    expect(handoffDecision(project, 'none', '就按这张卡做', 2)).toBe('offer')
    project.handoffRevision = 1
    expect(handoffDecision(project, 'none', '就按这张卡做', 2)).toBe('offer')
    project.handoffRevision = 2; project.revision = 3
    expect(handoffDecision(project, 'none', '就按这张卡做', 2)).toBe('offer')
  })
  it('卡片确认不能越过整理错误或已收官状态', () => {
    const project = proposal(); project.requirementsError = '整理失败'
    expect(handoffDecision(project, 'confirm', '就按这张卡做', 2)).toBe('none')
    delete project.requirementsError; project.phase = 'done'
    expect(handoffDecision(project, 'confirm', '就按这张卡做', 2)).toBe('none')
  })
  it('编程期间卡片确认不启动第二个任务', () => {
    const project = proposal()
    project.runs.push({ id: 'running', status: 'running', startedAt: '', events: [], snapshot: { id: 'snapshot', revision: 2, hash: 'frozen', time: '', brief: project.brief!, design: { id: 'soft-blue', name: '晴空', description: '', version: 1, source: '', tokens: { background: '', surface: '', text: '', muted: '', accent: '', radius: 18 } } } })
    expect(handoffDecision(project, 'none', '就按这张卡做', 2)).toBe('none')
    expect(handoffDecision(project, 'confirm', '就按这张卡做', 2)).toBe('busy')
  })
  it.each(['就按这个做！', '交给 Agent 吧', '照这个做', '现在开始做。'])('识别明确交付指令 %s', text => {
    expect(requestsExplicitHandoff(text)).toBe(true)
  })
  it.each(['好的', '“就按这个做”是按钮文字', '就按这个做，不过加上分享', '如果我说就按这个做呢？'])('普通肯定、引用或增加要求 %s 不是明确交付指令', text => {
    expect(requestsExplicitHandoff(text)).toBe(false)
  })
  it.each(['接下来咱们先聊怎么挑预设，不急编程', '先帮我把玩法聊清楚，还不要编程', '你陪我聊聊，还没决定怎么换', '先讨论，还没决定加', '继续聊这个玩法，先不整理需求', '只聊一聊体验，不改这轮', '咱们接着讨论预设'])('尊重继续讨论请求 %s', text => {
    expect(requestsContinuedDiscussion(text)).toBe(true)
  })
  it.each(['先整理这一轮，不开始编程', '把卡片给我看', '“先讨论”是按钮上的文字', '就按这个做', '聊好了，总结本轮需求'])('不把整理、引用或确认 %s 当作只讨论', text => {
    expect(requestsContinuedDiscussion(text)).toBe(false)
  })
  it('继续讨论优先于模型的交付提议，不因新版本号抢着交付', () => {
    const project = proposal(); project.revision = 3
    expect(handoffDecision(project, 'offer', '接下来咱们先聊怎么挑预设，不急编程', 2)).toBe('none')
  })
  it('新卡片没有明确整理请求或模型交付提议时，不自行插入确认问题', () => {
    const project = proposal(); project.revision = 3
    expect(handoffDecision(project, 'none', '这个点子似乎更清楚了', 2)).toBe('none')
  })
  it('新需求卡已更新但模型未给交付分类时，先展示待确认提议', () => {
    const project = proposal(); project.revision = 3
    expect(handoffDecision(project, 'none', '只整理这一轮，先不编程', 2)).toBe('offer')
  })
  it('没有更新需求的普通接话，不重复邀请交付', () => {
    expect(handoffDecision(proposal(), 'none', '这张纸条让我轻松一点', 2)).toBe('none')
  })
  it.each(['现在更新这张卡给我看，仍然先不要编程。', '只纠正最后一项，更新后的需求卡给我看看，先别编程。', '改好的这张需求卡先给我看。'])('语音纠正后的卡片查看请求 %s 更新待确认提议', text => {
    const project = proposal(); project.handoffRevision = 1
    expect(handoffDecision(project, 'none', text, 2)).toBe('offer')
    expect(project.runs).toEqual([])
  })
  it.each(['先修正这张需求卡，不要编程，名字是口袋散步。', '请修正本轮需求，先别写代码。', '不用构建，先修正这张卡，等我确认。', '帮我修正这轮需求，保留清空按钮。'])('明确修正 %s 即使模型没给交付分类也提议当前卡片', text => {
    const project = proposal(); project.revision = 3; project.handoffRevision = 1
    expect(handoffDecision(project, 'none', text, 2)).toBe('offer')
    expect(project.runs).toEqual([])
  })
  it.each(['先别修正这张需求卡，继续聊体验，不整理。', '我只是看到“修正这张需求卡”字样。', '如果我说先修正这张需求卡，会怎样？', '修正按钮颜色，暂时不改需求卡。'])('否定引用假设或别的修正 %s 不自行插入卡片提议', text => {
    const project = proposal(); project.revision = 3; project.handoffRevision = 1
    expect(handoffDecision(project, 'none', text, 2)).toBe('none')
    expect(project.runs).toEqual([])
  })
  it.each(['更新这张卡但不用给我看，先别开始。', '“更新这张卡给我看”是按钮文字。'])('否定或引用的卡片查看请求 %s 不插入提议', text => {
    const project = proposal(); project.handoffRevision = 1
    expect(handoffDecision(project, 'none', text, 2)).toBe('none')
    expect(project.runs).toEqual([])
  })
  it.each([false, true])('内容没有变化的明确整理请求仍进入待确认版本 summarize=%s', summarize => {
    const project = proposal(); delete project.handoffRevision
    expect(handoffDecision(project, 'none', '请重新整理本轮需求给我看，先不要编程', 2, summarize)).toBe('offer')
    expect(project.runs).toEqual([])
  })
  it('编程期间记录的新需求，不重新邀请交付', () => {
    const project = proposal(); project.revision = 3
    project.runs.push({ id: 'running', status: 'running', startedAt: '', events: [], snapshot: { id: 'snapshot', revision: 2, hash: 'frozen', time: '', brief: project.brief!, design: { id: 'soft-blue', name: '晴空', description: '', version: 1, source: '', tokens: { background: '', surface: '', text: '', muted: '', accent: '', radius: 18 } } } })
    expect(handoffDecision(project, 'none', '这轮之后再调整', 2)).toBe('none')
  })
  it('已收官作品不因新的版本号重新邀请交付', () => {
    const project = proposal(); project.phase = 'done'; project.revision = 3
    expect(handoffDecision(project, 'offer', '先聊一聊', 2)).toBe('none')
  })
  it('先给出需求，再用下一轮明确肯定自动交给独立实现任务', () => {
    const project = proposal()
    expect(handoffDecision(project, 'confirm', '就按这个做', 2)).toBe('start')
  })
  it.each(['就这样', '嗯，就这样吧'])('首版待交付卡片接受自然确认 %s', text => {
    expect(handoffDecision(proposal(), 'confirm', text, 2)).toBe('start')
  })
  it.each(['“就这样”是按钮文字', '就这样，不过加上分享', '如果我说就这样呢？'])('引用或增加要求 %s 不直接执行', text => {
    expect(handoffDecision(proposal(), 'confirm', text, 2)).toBe('offer')
  })
  it('自然确认仍需当前需求版本的待交付提议', () => {
    const project = proposal(); delete project.handoffRevision
    expect(handoffDecision(project, 'confirm', '就这样', 2)).toBe('offer')
    project.handoffRevision = 1
    expect(handoffDecision(project, 'confirm', '就这样', 2)).toBe('offer')
  })
  it.each(['none', 'offer'] as const)('明确执行当前待确认版本不受模型分类 %s 阻断', intent => {
    expect(handoffDecision(proposal(), intent, '就按这个做', 2)).toBe('start')
  })
  it('明确执行也不能绕过最新需求整理失败', () => {
    const project = proposal(); project.requirementsError = '本轮尚未整理成功'
    expect(handoffDecision(project, 'confirm', '就按这个做', 2)).toBe('none')
  })
  it('一般肯定句仍结合模型分类，不把别的问题当成交付确认', () => {
    expect(handoffDecision(proposal(), 'none', '好的', 2)).toBe('none')
    expect(handoffDecision(proposal(), 'offer', '好的', 2)).toBe('offer')
  })
  it('回答后续生活问题的普通肯定句不接受模型错误的交付分类', () => {
    const project = proposal(); project.messages.push({ id: 'water', role: 'assistant', content: '你想先喝口水再继续聊吗？', time: '' })
    expect(handoffDecision(project, 'confirm', '好的', 2)).toBe('none')
  })
  it('没有最近交付问句的普通肯定句不能启动待确认卡片', () => {
    const project = proposal(); project.messages = []
    expect(handoffDecision(project, 'confirm', '嗯，就这样吧', 2)).toBe('none')
  })
  it('普通肯定句不能确认最近问句中的其他作品标题', () => {
    const project = proposal(); project.messages[0].content = '「喝水」的这轮需求整理好了，细节都在需求卡里。就按这张卡交给编程伙伴吗？'
    expect(handoffDecision(project, 'confirm', '可以', 2)).toBe('none')
  })
  it('回答生活问题后仍可明确交付当前待确认版本', () => {
    const project = proposal(); project.messages.push({ id: 'water', role: 'assistant', content: '你想先喝口水再继续聊吗？', time: '' })
    expect(handoffDecision(project, 'none', '就按这个做', 2)).toBe('start')
  })
  it('明确执行但没有当前待确认版本时，仍先展示卡片', () => {
    const project = proposal(); delete project.handoffRevision
    expect(handoffDecision(project, 'none', '就按这个做', 2)).toBe('offer')
    project.handoffRevision = 2; project.revision = 3
    expect(handoffDecision(project, 'none', '就按这个做', 2)).toBe('offer')
  })
  it('没有询问确认的需求，不因模型确认字段直接执行', () => {
    const project = proposal(); delete project.handoffRevision
    expect(handoffDecision(project, 'confirm', '就按这个做', 2)).toBe('offer')
  })
  it('需求修改后旧确认失效，需要重新确认', () => {
    const project = proposal(); project.revision = 3
    expect(handoffDecision(project, 'confirm', '就按这个做', 2)).toBe('offer')
  })
  it.each(['先不要做', '好的，不过加上登录', '这个怎么实现？'])('继续讨论 %s 不触发代码生成', text => {
    expect(handoffDecision(proposal(), 'confirm', text, 2)).toBe('offer')
  })
  it('没有需求时只聊天，不启动实现任务', () => {
    const project = proposal(); delete project.brief
    expect(handoffDecision(project, 'confirm', '开始做', 2)).toBe('none')
  })
})

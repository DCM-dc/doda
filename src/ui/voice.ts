export type VoicePhase = 'off' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'
export interface VoiceReply { text: string; done?: boolean }
export interface VoiceInvitation { text: string; accept(signal: AbortSignal): Promise<boolean> }
export interface Capture { enable: (enabled: boolean) => void; close: () => void; busy?: () => boolean }
export interface VoicePorts {
  capture: (signal: AbortSignal, utterance: (wav: Blob | undefined, final?: boolean) => void, failed: (error: Error) => void) => Promise<Capture>
  transcribe: (wav: Blob, signal: AbortSignal) => Promise<string>
  chat: (text: string, signal: AbortSignal) => Promise<VoiceReply>
  play: (text: string, signal: AbortSignal) => Promise<void>
  changed: (phase: VoicePhase, error?: string) => void
  transcript: (text: string) => void
  followup?: (signal: AbortSignal) => Promise<VoiceInvitation | undefined>
}

export class VoiceSession {
  private life?: AbortController
  private turn?: AbortController
  private microphone?: Capture
  private phase: VoicePhase = 'off'
  private announcements: string[] = []
  private announcementTimer?: ReturnType<typeof setTimeout>
  private build?: { id: string; delay: number }
  private followed = new Set<string>()
  private followupTimer?: ReturnType<typeof setTimeout>
  private followupRequest?: AbortController
  private recording?: { turn: AbortController; signal: AbortSignal; pending: Promise<void>; texts: string[] }
  private waitingForUser = false
  constructor(private ports: VoicePorts) {}
  private set(phase: VoicePhase, error?: string) { this.phase = phase; this.ports.changed(phase, error) }
  async start() {
    this.stop()
    const life = new AbortController(); this.life = life
    this.set('connecting')
    try {
      const microphone = await this.ports.capture(life.signal, (wav, final) => { if (!life.signal.aborted) void this.respond(wav, final) }, error => { if (!life.signal.aborted) this.fail(error) })
      if (life.signal.aborted) { microphone.close(); return }
      this.microphone = microphone
      this.listen()
    } catch (error) { if (!life.signal.aborted) this.fail(error as Error) }
  }
  private listen(error?: string) {
    if (!this.life || this.life.signal.aborted) return
    this.set('listening', error); this.microphone?.enable(true); this.drainAnnouncements(); this.scheduleFollowup()
  }
  followBuild(runId: string | undefined, level: 'quiet' | 'standard' | 'lively') {
    const delay = level === 'lively' ? 12000 : 25000
    const id = level === 'quiet' ? undefined : runId
    if (this.build?.id === id && this.build?.delay === delay) return
    this.build = id ? { id, delay } : undefined
    this.cancelFollowup(); this.scheduleFollowup()
  }
  private cancelFollowup() {
    clearTimeout(this.followupTimer)
    const request = this.followupRequest
    if (request && this.turn === request && this.phase === 'speaking') return
    this.followupRequest = undefined; request?.abort()
    if (request && this.turn === request) { this.turn = undefined; this.listen() }
  }
  private scheduleFollowup(delay = this.build?.delay) {
    clearTimeout(this.followupTimer)
    if (!delay || !this.build || !this.ports.followup || !this.life || this.life.signal.aborted || this.phase !== 'listening' || this.recording || this.followupRequest || this.waitingForUser || this.followed.has(this.build.id)) return
    this.followupTimer = setTimeout(() => {
      if (this.microphone?.busy?.()) this.scheduleFollowup(250)
      else void this.askFollowup()
    }, delay)
  }
  private async askFollowup() {
    if (!this.life || this.life.signal.aborted || !this.build || !this.ports.followup || this.phase !== 'listening' || this.recording || this.microphone?.busy?.()) return
    const id = this.build.id
    const turn = new AbortController(); this.followupRequest = turn; this.followed.add(id)
    const signal = AbortSignal.any([this.life.signal, turn.signal])
    let playing = false
    try {
      const invitation = await this.ports.followup(signal)
      if (!invitation || signal.aborted || this.build?.id !== id || this.phase !== 'listening' || this.microphone?.busy?.()) return
      this.turn = turn; this.microphone?.enable(false); this.set('thinking')
      if (!await invitation.accept(signal) || signal.aborted) return
      this.set('speaking'); playing = true; await this.ports.play(invitation.text, signal)
    } catch (error) {
      if (!signal.aborted && this.turn === turn) { if (playing) this.resumePlayback(error as Error, turn); else this.set('listening') }
    } finally {
      if (this.followupRequest === turn) this.followupRequest = undefined
      if (this.turn === turn) { this.turn = undefined; if (!signal.aborted) this.listen() }
    }
  }
  announce(text: string) { if (!this.life || this.life.signal.aborted || !text.trim()) return; this.announcements.push(text); this.cancelFollowup(); this.drainAnnouncements() }
  private drainAnnouncements() {
    clearTimeout(this.announcementTimer)
    if (!this.life || this.life.signal.aborted || this.phase !== 'listening' || this.waitingForUser || !this.announcements.length) return
    if (this.recording || this.microphone?.busy?.()) { this.announcementTimer = setTimeout(() => this.drainAnnouncements(), 250); return }
    void this.sayAnnouncement(this.announcements.shift()!)
  }
  private async sayAnnouncement(text: string) {
    const turn = new AbortController(); this.turn = turn
    const signal = AbortSignal.any([this.life!.signal, turn.signal])
    this.microphone?.enable(false); this.set('speaking')
    try { await this.ports.play(text, signal); if (!signal.aborted) this.listen() }
    catch (error) { if (!signal.aborted) this.resumePlayback(error as Error, turn) }
    finally { if (this.turn === turn) this.turn = undefined }
  }
  private fail(error: Error) { this.stop(); this.set('error', error.message) }
  private resumePlayback(error: Error, turn: AbortController, done = false) {
    if (!this.life || this.life.signal.aborted || this.turn !== turn) return
    turn.abort(); this.turn = undefined
    if (done) { this.stop(); this.set('off', error.message) }
    else this.listen(error.message)
  }
  private async respond(wav: Blob | undefined, final = true) {
    if (this.phase !== 'listening' || !this.life || this.life.signal.aborted) return
    if (!wav && !this.recording) return
    clearTimeout(this.followupTimer); this.followupRequest?.abort(); this.followupRequest = undefined
    const first = !this.recording
    if (!this.recording) { const turn = new AbortController(); this.turn = turn; this.recording = { turn, signal: AbortSignal.any([this.life.signal, turn.signal]), pending: Promise.resolve(), texts: [] } }
    const recording = this.recording, { turn, signal } = recording
    let reply: VoiceReply | undefined
    try {
      if (wav) { const request = first ? this.ports.transcribe(wav, signal) : recording.pending.then(() => { signal.throwIfAborted(); return this.ports.transcribe(wav, signal) }); recording.pending = request.then(text => { const value = text.trim(); if (!signal.aborted && value) recording.texts.push(value) }) }
      if (!final) { void recording.pending.catch(error => { if (!signal.aborted && this.recording === recording) this.fail(error as Error) }); return }
      this.microphone?.enable(false); this.set('transcribing')
      await recording.pending
      if (signal.aborted) return
      if (this.recording === recording) this.recording = undefined
      const text = recording.texts.join(' ').trim()
      if (!text) { this.listen(); return }
      this.waitingForUser = false
      this.ports.transcript(text); this.set('thinking')
      reply = await this.ports.chat(text, signal)
      if (signal.aborted) return
      this.set('speaking')
      await this.ports.play(reply.text, signal)
      if (signal.aborted) return
      if (reply.done) this.stop()
      else this.listen()
    } catch (error) { if (!signal.aborted) { if (reply) this.resumePlayback(error as Error, turn, Boolean(reply.done)); else this.fail(error as Error) } }
    finally { if (final) { if (this.recording === recording) this.recording = undefined; if (this.turn === turn) this.turn = undefined } }
  }
  interrupt() {
    if (this.phase !== 'speaking') return
    this.waitingForUser = true
    this.turn?.abort(); this.turn = undefined; this.listen()
  }
  stop() {
    clearTimeout(this.announcementTimer); this.announcements = []
    clearTimeout(this.followupTimer); this.followupRequest?.abort(); this.followupRequest = undefined; this.build = undefined
    this.life?.abort(); this.turn?.abort(); this.microphone?.close()
    this.life = undefined; this.turn = undefined; this.microphone = undefined; this.recording = undefined; this.waitingForUser = false
    this.set('off')
  }
}

export class SpeechSegmenter {
  private frames: Float32Array[] = []
  private pre: Float32Array[] = []
  private speaking = 0
  private chunkSpeaking = 0
  private quiet = 0
  private duration = 0
  private noise = 0.002
  private active = false
  constructor(private rate: number, private ready: (samples: Float32Array, final: boolean) => void) {}
  busy() { return this.active }
  reset() { this.frames = []; this.pre = []; this.speaking = 0; this.chunkSpeaking = 0; this.quiet = 0; this.duration = 0; this.active = false }
  push(samples: Float32Array) {
    const seconds = samples.length / this.rate
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    const voice = rms >= Math.max(0.009, Math.min(0.035, this.noise * 3.5))
    if (!this.active && !voice) {
      this.noise = this.noise * 0.98 + rms * 0.02
      this.pre.push(samples)
      while (this.pre.reduce((sum, frame) => sum + frame.length, 0) > this.rate * 0.25) this.pre.shift()
      return
    }
    if (!this.active) { this.frames = this.pre.splice(0); this.active = true }
    this.frames.push(samples); this.duration += seconds
    if (voice) { this.speaking += seconds; this.chunkSpeaking += seconds; this.quiet = 0 }
    else this.quiet += seconds
    if (this.quiet < 0.95 && this.duration < 25) return
    const audible = this.speaking >= 0.25
    const output = new Float32Array(this.frames.reduce((sum, frame) => sum + frame.length, 0))
    let offset = 0
    for (const frame of this.frames) { output.set(frame, offset); offset += frame.length }
    const final = this.quiet >= 0.95, endOnly = final && this.chunkSpeaking === 0
    if (final) this.reset()
    else { this.frames = []; this.duration = 0; this.chunkSpeaking = 0 }
    if (audible) this.ready(endOnly ? new Float32Array(0) : output, final)
  }
}

export function wav(samples: Float32Array, rate: number): Blob {
  const size = Math.floor(samples.length * 16000 / rate)
  const buffer = new ArrayBuffer(44 + size * 2); const view = new DataView(buffer)
  function ascii(offset: number, value: string) { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, 36 + size * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, size * 2, true)
  for (let i = 0; i < size; i++) {
    const from = Math.floor(i * rate / 16000); const to = Math.max(from + 1, Math.floor((i + 1) * rate / 16000))
    let total = 0
    for (let j = from; j < to; j++) total += samples[Math.min(j, samples.length - 1)]
    const value = Math.max(-1, Math.min(1, total / (to - from)))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function captureMicrophone(signal: AbortSignal, utterance: (audio: Blob | undefined, final?: boolean) => void, failed: (error: Error) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
  let context: AudioContext | undefined
  let closed = false
  const close = () => { if (closed) return; closed = true; stream.getTracks().forEach(track => track.stop()); if (context) void context.close(); signal.removeEventListener('abort', close) }
  if (signal.aborted) { close(); throw new DOMException('Aborted', 'AbortError') }
  signal.addEventListener('abort', close, { once: true })
  try {
    context = new AudioContext()
    await context.resume()
    const source = context.createMediaStreamSource(stream)
    const url = URL.createObjectURL(new Blob([`class DodaCapture extends AudioWorkletProcessor {
      process(inputs) { const audio = inputs[0]?.[0]; if (audio) { const frame = audio.slice(); this.port.postMessage(frame, [frame.buffer]); } return true; }
    } registerProcessor('doda-capture', DodaCapture);`], { type: 'text/javascript' }))
    try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const node = new AudioWorkletNode(context, 'doda-capture')
    const mute = context.createGain(); mute.gain.value = 0
    source.connect(node); node.connect(mute); mute.connect(context.destination)
    let enabled = false
    const segmenter = new SpeechSegmenter(context.sampleRate, (samples, final) => utterance(samples.length ? wav(samples, context!.sampleRate) : undefined, final))
    node.port.onmessage = event => { if (enabled && !closed) segmenter.push(event.data) }
    node.onprocessorerror = () => { if (!closed) failed(new Error('麦克风录音中断，请重新开始语音聊天。')) }
    stream.getAudioTracks().forEach(track => { track.onended = () => { if (!closed) failed(new Error('麦克风已断开，请重新连接。')) } })
    return { enable: value => { enabled = value; segmenter.reset() }, busy: () => segmenter.busy(), close }
  } catch (error) { close(); throw error }
}

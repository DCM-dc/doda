import { Worker } from 'node:worker_threads'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function decodePcmWave(audio: Buffer) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('请发送 WAV 格式的录音。')
  let rate = 0, data: Buffer | undefined
  for (let offset = 12; offset + 8 <= audio.length;) {
    const size = audio.readUInt32LE(offset + 4), from = offset + 8
    if (from + size > audio.length) throw new Error('录音文件不完整，请重新说一句。')
    const chunk = audio.toString('ascii', offset, offset + 4)
    if (chunk === 'fmt ') {
      if (size < 16 || audio.readUInt16LE(from) !== 1 || audio.readUInt16LE(from + 2) !== 1 || audio.readUInt16LE(from + 14) !== 16) throw new Error('录音需要单声道 PCM16 WAV 格式。')
      rate = audio.readUInt32LE(from + 4)
    }
    if (chunk === 'data') data = audio.subarray(from, from + size)
    offset = from + size + size % 2
  }
  if (!data || !data.length || data.length % 2 || rate < 8000 || rate > 48000 || data.length / 2 / rate > 30) throw new Error('请发送不超过 30 秒的有效录音。')
  const samples = new Float32Array(data.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768
  return { samples, rate }
}

export class LocalAsr {
  private worker?: Worker
  private pending = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>()
  constructor(private modelDirectory: string) {}
  async available() { return (await Promise.all(['model.int8.onnx', 'tokens.txt'].map(file => stat(join(this.modelDirectory, file)).catch(() => null)))).every(file => file?.isFile()) }
  async transcribe(audio: Buffer, signal: AbortSignal) {
    signal.throwIfAborted()
    const { samples, rate } = decodePcmWave(audio)
    if (samples.every(sample => sample === 0)) return ''
    if (!this.worker) {
      if (!await this.available()) throw new Error('语音识别资源尚未准备好，请先准备本机语音识别。')
      signal.throwIfAborted()
      if (!this.worker) {
        const worker = new Worker(new URL('./asr-worker.mjs', import.meta.url), { workerData: { modelDirectory: this.modelDirectory } })
        this.worker = worker
        worker.on('message', result => { const request = this.pending.get(result.id); if (!request) return; this.pending.delete(result.id); if (result.error) request.reject(new Error('本机语音识别失败，请重新说一句。')); else request.resolve(result.text) })
        worker.on('error', error => { if (this.worker !== worker) return; for (const request of this.pending.values()) request.reject(error); this.pending.clear(); this.worker = undefined })
        worker.on('exit', () => { if (this.worker !== worker) return; for (const request of this.pending.values()) request.reject(new Error('语音识别服务已停止。')); this.pending.clear(); this.worker = undefined })
      }
    }
    const id = randomUUID()
    return new Promise<string>((resolve, reject) => {
      const pending = this.pending
      function abort() { pending.delete(id); reject(new DOMException('Aborted', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      function cleanup() { signal.removeEventListener('abort', abort) }
      this.pending.set(id, { resolve: text => { cleanup(); resolve(text) }, reject: error => { cleanup(); reject(error) } })
      this.worker!.postMessage({ id, samples, rate }, [samples.buffer])
    })
  }
  async close() { const worker = this.worker; this.worker = undefined; for (const request of this.pending.values()) request.reject(new Error('语音识别服务已停止。')); this.pending.clear(); if (worker) await worker.terminate() }
}

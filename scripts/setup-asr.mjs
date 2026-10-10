import { mkdir, stat, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const root = resolve(process.env.DODA_DATA || join(appRoot, '.data'), 'asr')
const name = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'
const source = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${name}.tar.bz2`
const checksum = '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e'
const model = join(root, name)
await mkdir(root, { recursive: true })
if (!(await stat(join(model, 'model.int8.onnx')).catch(() => null))?.isFile() || !(await stat(join(model, 'tokens.txt')).catch(() => null))?.isFile()) {
  const archive = join(root, name + '.tar.bz2')
  const response = await fetch(source, { signal: AbortSignal.timeout(300000) })
  if (!response.ok || !response.body) throw new Error(`ASR_DOWNLOAD_${response.status}`)
  process.stdout.write('正在准备本机语音识别资源（约 163 MB）…\n')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
  if (createHash('sha256').update(await readFile(archive)).digest('hex') !== checksum) throw new Error('ASR_CHECKSUM_MISMATCH')
  async function tar(args) {
    return new Promise((resolveOutput, reject) => {
      const child = spawn('tar', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', buffer => { output += buffer }); child.stderr.resume()
      child.on('error', reject); child.on('close', code => code === 0 ? resolveOutput(output) : reject(new Error('ASR_UNPACK_FAILED')))
    })
  }
  const listing = await tar(['-tjf', archive])
  for (const entry of listing.trim().split(/\r?\n/)) if (!entry.startsWith(name + '/') || entry.split('/').includes('..')) throw new Error('ASR_ARCHIVE_PATH_INVALID')
  await tar(['-xjf', archive, '-C', root])
}
const manifest = { source, archiveSHA256: checksum, modelSHA256: createHash('sha256').update(await readFile(join(model, 'model.int8.onnx'))).digest('hex'), tokensSHA256: createHash('sha256').update(await readFile(join(model, 'tokens.txt'))).digest('hex') }
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
process.stdout.write('本机语音识别已准备好。\n')

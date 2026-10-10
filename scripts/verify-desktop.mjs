import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const app = resolve(process.argv[2])
const resources = process.platform === 'darwin' ? join(app, 'Contents/Resources') : app
const runtime = join(resources, 'runtime', `${process.platform}-${process.arch}`)
const backend = join(runtime, 'backend')
const executable = process.platform === 'darwin' ? join(app, 'Contents/MacOS/doda-desktop') : join(app, 'doda-desktop.exe')
const scratch = await mkdtemp(join(tmpdir(), 'doda-release-smoke-'))
const data = join(scratch, 'data')
const env = { ...process.env, DODA_DATA: data, DEEPSEEK_API_KEY: '', MIMO_API_KEY: '' }
for (const name of ['DODA_ROOT', 'DODA_NODE', 'DODA_CREDENTIAL_HELPER', 'DODA_ASR_MODEL', 'PLAYWRIGHT_BROWSERS_PATH']) delete env[name]
if (process.platform === 'win32') env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`
else env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const checks = []
let child, exit, base

async function boot() {
  child = spawn(executable, ['--smoke-test'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  exit = once(child, 'exit')
  let stdout = '', stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(Error('PACKAGED_BOOT_TIMEOUT: ' + stderr)), 90000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(Error('PACKAGED_BOOT_EXIT_' + code + ': ' + stderr)) })
    child.stdout.on('data', chunk => {
      stdout += chunk
      const match = stdout.match(/\{"ok":true,"port":(\d+),"packaged":true\}/)
      if (match) { clearTimeout(timer); base = 'http://127.0.0.1:' + match[1]; accept() }
    })
  })
}
async function stop() {
  child.stdin.end()
  const result = await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('PACKAGED_SHUTDOWN_TIMEOUT')), 15000); timer.unref() })])
  assert.equal(result[0], 0)
  assert.equal(await fetch(base + '/api/health').then(() => true, () => false), false)
  child = undefined
}
async function api(path, body) {
  const response = await fetch(base + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) })
  assert.equal(response.status, 200, path + ': ' + await response.clone().text())
  return response.json()
}
try {
  await boot()
  const initial = await api('/api/state')
  assert.equal(initial.projects.length, 0)
  assert.equal(initial.settings.deepseekConfigured, false)
  assert.equal(initial.settings.mimoConfigured, false)
  assert(initial.designs.some(design => design.package?.id === 'apple'))
  checks.push('Native launcher boots with bundled Node and empty isolated state')
  const page = await fetch(base).then(response => response.text())
  assert(page.includes('/assets/'))
  const project = await api('/api/projects', { designId: 'soft-blue' })
  const preview = await fetch(base + '/api/projects/' + project.id + '/preview')
  assert.equal(preview.status, 200, await preview.clone().text())
  const required = createRequire(join(backend, 'package.json'))
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(runtime, 'browsers')
  const { chromium } = required('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const tab = await browser.newPage({ viewport: { width: 393, height: 852 } })
    const errors = []
    tab.on('pageerror', error => errors.push(error.message))
    await tab.goto(base + '/api/projects/' + project.id + '/preview')
    assert.equal(await tab.locator('html').getAttribute('data-engine'), 'glass-easel')
    const image = await tab.screenshot()
    assert(image.length > 1000)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
  checks.push('Bundled Chromium renders official native WeChat preview without page errors')
  const samples = 8000, wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index * 440 * 2 * Math.PI / 16000) * 500), 44 + index * 2)
  const response = await fetch(base + '/api/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: AbortSignal.timeout(90000) })
  assert.equal(response.status, 200, await response.clone().text())
  const asr = await response.json(); assert.equal(asr.engine, 'local'); assert.equal(typeof asr.text, 'string')
  checks.push('Bundled SenseVoice model and native recognizer load and transcribe synthetic PCM')
  const { DeepSeekHarness } = await import(pathToFileURL(required.resolve('@deepseek-ai/dsh-sdk-client')).href)
  const harness = new DeepSeekHarness({ profile: 'sdk-minimal', cwd: data, dshHome: join(scratch, 'dsh'), env: { ...process.env, DEEPSEEK_API_KEY: '' }, initializeTimeoutMs: 60000 })
  try { await harness.start() } finally { await harness.close() }
  checks.push('Production DSH SDK and plugin dependencies start from packaged runtime')
  await api('/api/settings', { ...initial.settings, deepseekKey: 'release-smoke-deepseek-fixture', mimoKey: 'release-smoke-mimo-fixture' })
  await stop(); await boot()
  const restored = await api('/api/state')
  assert.equal(restored.projects[0].id, project.id)
  assert.equal(restored.settings.deepseekConfigured, true)
  assert.equal(restored.settings.mimoConfigured, true)
  assert.equal(JSON.stringify(restored).includes('release-smoke-deepseek-fixture'), false)
  if (process.platform === 'win32') assert.equal((await readFile(join(data, 'secrets.dpapi'), 'utf8')).includes('release-smoke-deepseek-fixture'), false)
  else assert.equal(await stat(join(data, 'secrets.dpapi')).then(() => true, () => false), false)
  checks.push('Credentials persist through restart in DPAPI or Keychain and stay out of state API')
  await stop()
  checks.push('Native shutdown stops its backend process and releases the local port')
  const report = { checkedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, app: process.argv[2], checks, nativeWindowVerified: false, realModelVerified: false }
  await writeFile(resolve(process.argv[3] || 'release-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  const log = await readFile(join(data, 'desktop.log'), 'utf8').catch(() => '')
  console.error(log.replaceAll('release-smoke-deepseek-fixture', '[fixture]').replaceAll('release-smoke-mimo-fixture', '[fixture]'))
  throw error
} finally {
  if (child) { child.stdin.end(); await Promise.race([exit, new Promise(accept => { const timer = setTimeout(accept, 15000); timer.unref() })]) }
  if (process.platform === 'darwin') {
    const cleanup = spawnSync(join(resources, 'helpers/doda-keychain'), ['erase', data], { encoding: 'utf8' })
    assert.equal(cleanup.status, 0, 'Isolated Keychain cleanup failed')
  }
  if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep) || !scratch.includes('doda-release-smoke-')) throw Error('UNSAFE_SMOKE_CLEANUP')
  await rm(scratch, { recursive: true, force: true })
}

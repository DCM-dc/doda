import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Store } from '../server/store'
import type { Project } from '../server/contracts'

let root = '', base = '', child: ChildProcess | undefined, exited: Promise<unknown>, projects: Project[] = []
async function port() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('FIXTURE_PORT_MISSING')
  const result = address.port
  await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()))
  return result
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-dispatch-refusal-'))
  const store = new Store(root); await store.load()
  for (const label of ['文字接单检查', '语音接单检查']) {
    const project = store.create('warm-paper')
    project.name = label
    project.brief = { title: label, audience: '自己', purpose: '十秒里歇一下', features: ['十秒倒数'], pages: ['首页'], acceptance: ['结束显示回来一点就好'], deferred: [], designId: 'warm-paper' }
    project.revision = 2; project.handoffRevision = 2
    project.messages.push({ id: 'offer', role: 'assistant', content: `「${label}」的这轮需求整理好了，细节都在需求卡里。就按这张卡交给编程伙伴吗？`, time: '' })
    await mkdir(join(root, 'projects', project.id, 'current'), { recursive: true })
    projects.push(project)
  }
  store.designs = store.designs.filter(design => design.id !== 'warm-paper')
  await store.save()
  const selectedPort = await port(); base = `http://127.0.0.1:${selectedPort}/api`
  const fixtureEnv: NodeJS.ProcessEnv = { ...process.env, DODA_PRODUCTION: '1', DODA_DATA: root, DODA_PORT: String(selectedPort), DEEPSEEK_API_KEY: 'local-dispatch-refusal-fixture', MIMO_API_KEY: '' }
  const inheritedModulePath = Object.entries(fixtureEnv).find(([name]) => name.toLowerCase() === 'psmodulepath')?.[1]
  for (const name of Object.keys(fixtureEnv)) if (name.toLowerCase() === 'psmodulepath') delete fixtureEnv[name]
  if (inheritedModulePath) fixtureEnv.PSMODULEPATH = inheritedModulePath
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), env: fixtureEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let bootError = ''
  child.stdout?.resume()
  child.stderr?.on('data', chunk => { bootError += String(chunk) })
  exited = once(child, 'exit')
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error(`FIXTURE_BOOT_FAILED: ${bootError}`); const response = await fetch(base + '/health'); expect(response.status).toBe(200) }, { timeout: 20000, interval: 100 })
}, 30000)

afterAll(async () => {
  if (child?.exitCode === null) child.kill()
  if (exited) await exited
  if (!root) return
  const delta = relative(resolve(tmpdir()), resolve(root))
  if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-dispatch-refusal-')) throw new Error('INVALID_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
})

describe('Chat dispatch rejected before the native task starts', () => {
  it('text refusal replaces the accepted reply and keeps its reason in the creation archive', async () => {
    const project = projects[0], response = await fetch(`${base}/projects/${project.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '就按这张卡做。' }) }), result = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('x-doda-dialogue-requests')).toBe('0')
    expect(response.headers.get('x-doda-requirements-requests')).toBe('0')
    expect(result.runs).toEqual([])
    expect(result.brief).toEqual(project.brief)
    expect(result.revision).toBe(2)
    expect(result.chatReply).toContain('这轮我还没开始做')
    expect(result.chatReply).toContain('风格找不到了')
    expect(result.chatReply).not.toContain('DESIGN_NOT_FOUND')
    expect(result.messages.at(-1).content).toBe(result.chatReply)
    expect(result.messages.slice(-2).map((message: { role: string }) => message.role)).toEqual(['user', 'assistant'])
    expect(result.archive.interview).toContain(result.chatReply)
    expect(result.archive.interview).not.toContain('它开始做，我们可以继续聊')
  })
  it('voice refusal returns the actual failed handoff reply without ending the conversation', async () => {
    const project = projects[1], response = await fetch(`${base}/projects/${project.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '就按这张卡做。', voice: true }) }), result = await response.json()
    expect(response.status).toBe(200)
    expect(result.runs).toEqual([])
    expect(result.chatReply).toContain('这轮我还没开始做')
    expect(result.chatReply).toBe(result.messages.at(-1).content)
    expect(result.voiceDone).toBe(false)
    expect(result.phase).toBe('explore')
    expect(result.archive.interview).toContain(result.chatReply)
    const saved = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).projects.find((saved: Project) => saved.id === project.id)
    expect(saved.messages.at(-1).content).toBe(result.chatReply)
    expect(saved.archive).toEqual(result.archive)
  })
})

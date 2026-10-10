import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'

const first = '这一个日子可以先装进小盒，像留下一片叶子。', candidate = first + '\n\n' + '这一天的风轻轻吹过，'.repeat(15) + '我们接着聊。'
let root = '', base = '', child: ChildProcess | undefined, exited: Promise<unknown>, projects: { id: string }[] = []

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-spoken-reply-'))
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('FIXTURE_PORT_MISSING')
  base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()))
  const provider = join(root, 'provider.mjs')
  await writeFile(provider, `const upstream=globalThis.fetch;globalThis.fetch=async function(input,options){if(String(input)==='https://api.deepseek.com/chat/completions')return new Response(JSON.stringify({choices:[{message:{content:${JSON.stringify(candidate)}}}]}),{headers:{'Content-Type':'application/json'}});return upstream(input,options)};`)
  const env = { ...process.env, DODA_PRODUCTION: '1', DODA_DATA: root, DODA_PORT: String(address.port), DEEPSEEK_API_KEY: 'spoken-reply-provider-fixture', MIMO_API_KEY: '' }
  const inheritedModulePath = Object.entries(env).find(([name]) => name.toLowerCase() === 'psmodulepath')?.[1]
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name as keyof typeof env]
  if (inheritedModulePath) Object.assign(env, { PSMODULEPATH: inheritedModulePath })
  child = spawn(process.execPath, ['--import', pathToFileURL(provider).href, '--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let bootError = ''; child.stdout?.resume(); child.stderr?.on('data', chunk => { bootError += String(chunk) }); exited = once(child, 'exit')
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error(`FIXTURE_BOOT_FAILED: ${bootError}`); const response = await fetch(base + '/health'); expect(response.status).toBe(200) }, { timeout: 20000, interval: 100 })
  for (let index = 0; index < 2; index++) { const response = await fetch(base + '/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designId: 'mint-garden' }) }); expect(response.status).toBe(200); projects.push(await response.json()) }
}, 30000)

afterAll(async () => {
  if (child?.exitCode === null) child.kill()
  if (exited) await exited
  if (!root) return
  const delta = relative(resolve(tmpdir()), resolve(root))
  if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-spoken-reply-')) throw new Error('INVALID_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
})

describe('真实聊天路由和存储接收受控上游长回复', () => {
  it('语音请求收口完整短句并把同一回复写入消息与档案', async () => {
    const id = projects[0].id, response = await fetch(`${base}/projects/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '继续随便聊感受，不整理也不改作品，一片叶子像把一天轻轻留下。', voice: true }) }), result = await response.json()
    expect(response.status).toBe(200); expect(response.headers.get('x-doda-requirements-requests')).toBe('0'); expect(result.chatReply).toBe(first); expect(result.voiceDone).toBe(false); expect(result.messages.at(-1).content).toBe(first); expect(result.archive.interview).toContain(first); expect(result.archive.interview).not.toContain(candidate); expect(result.revision).toBe(0); expect(result.runs).toEqual([])
    const persisted = await (await fetch(base + '/state')).json(), saved = persisted.projects.find((project: { id: string }) => project.id === id)
    expect(saved.messages.at(-1).content).toBe(first); expect(saved.archive).toEqual(result.archive)
  })
  it('同样的文字聊天保留完整上游回复和消息档案', async () => {
    const id = projects[1].id, response = await fetch(`${base}/projects/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '继续随便聊感受，不整理也不改作品，一片叶子像把一天轻轻留下。' }) }), result = await response.json()
    expect(response.status).toBe(200); expect(result.chatReply).toBe(candidate); expect(result.messages.at(-1).content).toBe(candidate); expect(result.archive.interview).toContain(candidate); expect(result.revision).toBe(0); expect(result.runs).toEqual([])
  })
})

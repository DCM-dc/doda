import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Store } from '../server/store'
import type { Project } from '../server/contracts'

const card = { title: '数字小格', audience: '自己使用', purpose: '用小动作接住注意力', features: ['数字初值0，加一最多到8。', '归零回到0。'], pages: ['数字、加一和归零两个按钮。'], acceptance: ['上限8，不联网、不保存。'], deferred: [], designId: 'mint-garden' }
const updated = { ...card, features: ['数字初值0，加一最多到6。', '归零回到0。'], acceptance: ['上限6，不联网、不保存。'] }
const copyUpdated = { ...card, pages: ['显示“这张卡先留着”、数字、加一和归零两个按钮。'], acceptance: ['显示“这张卡先留着”。', '上限8，不联网、不保存。'] }
const cases = [
  { text: '这张卡先留着，我先结束语音。', preserved: true, done: true },
  { text: '当前需求卡不改，拜拜。', preserved: true, done: true, pending: 2 },
  { text: '这张卡先保留，我先结束语音。', preserved: true, done: true, error: '上一轮整理失败' },
  { text: '这张卡先留着。', preserved: true, done: false, pending: 2 },
  { text: '把上限从8改成6，我先结束语音。', preserved: false, done: true },
  { text: '请整理当前需求卡给我看，我先结束语音。', preserved: false, done: true, review: true },
  { text: '把页面文案改成「这张卡先留着」，我先结束语音。', preserved: false, done: true, copy: true },
  { text: '这张卡先留着，但上限从8改成6。', preserved: false, done: false },
]
let root = '', base = '', child: ChildProcess | undefined, closed: Promise<unknown>, projects: Project[] = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-preserved-card-')); const store = new Store(root); await store.load()
  for (const item of cases) {
    const project = store.create('mint-garden'); project.brief = structuredClone(card); project.name = card.title; project.revision = 2; project.phase = 'refine'; project.handoffRevision = item.pending; project.requirementsError = item.error
    project.messages.push({ id: 'old-change', role: 'user', content: '把上限从8改成6，先别开工。', time: '2026-10-09T20:00:00.000Z' }, { id: 'old-reply', role: 'assistant', content: '修正卡整理好了。', time: '2026-10-09T20:00:01.000Z' }); projects.push(project)
  }
  await store.save()
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address(); if (!address || typeof address === 'string') throw new Error('UNIT_PORT_MISSING'); base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>(done => listener.close(() => done()))
  const fixture = join(root, 'provider.mjs')
  await writeFile(fixture, `const original=globalThis.fetch,updated=${JSON.stringify(updated)},copyUpdated=${JSON.stringify(copyUpdated)};globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:'好，先到这里。'}}]});const data=JSON.parse(JSON.parse(options.body).input[0].content.split('Return only JSON.\\n')[1]);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:data.newestUserMessage==='把页面文案改成「这张卡先留着」，我先结束语音。'?copyUpdated:updated,handoff:'none',finish:false,inspirations:['旧提议']})}]}]})};`)
  const env = { ...process.env, DODA_DATA: root, DODA_PORT: base.match(/:(\d+)/)![1], DEEPSEEK_API_KEY: 'fixture' }
  child = spawn(process.execPath, ['--import', pathToFileURL(fixture).href, '--import', 'tsx', 'server/index.ts'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); closed = once(child, 'close'); child.stdout!.resume(); child.stderr!.resume()
  await vi.waitFor(async () => { expect((await fetch(base + '/health')).ok).toBe(true) }, { timeout: 12000, interval: 50 })
})
afterAll(async () => {
  if (child && child.exitCode === null) child.kill(); if (closed) await closed
  const path = relative(tmpdir(), root); if (root && path && !path.startsWith('..') && !isAbsolute(path)) await rm(root, { recursive: true, force: true })
})
describe('Explicit preservation does not replay a preceding requirement change', () => {
  for (const [index, item] of cases.entries()) it(item.text, async () => {
    const response = await fetch(`${base}/projects/${projects[index].id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: item.text, voice: true }) }), project = await response.json() as Project & { voiceDone: boolean; chatReply: string }
    expect(response.status).toBe(200); expect(project.voiceDone).toBe(item.done); expect(project.runs).toEqual([]); expect(project.phase).toBe('refine')
    expect(project.brief).toEqual(item.preserved ? card : item.copy ? copyUpdated : updated); expect(project.revision).toBe(item.preserved ? 2 : 3)
    expect(response.headers.get('x-doda-requirements-requests')).toBe(item.preserved ? '0' : '1')
    expect(project.handoffRevision).toBe(item.preserved ? item.pending : item.review ? 3 : undefined)
    expect(project.requirementsError).toBe(item.preserved ? item.error : undefined)
    expect(project.inspirations).toEqual(item.preserved ? [] : ['旧提议'])
    expect(project.messages.slice(-2).map(message => message.role)).toEqual(['user', 'assistant']); expect(project.messages.at(-2)?.content).toBe(item.text)
    const persisted = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).projects.find((entry: Project) => entry.id === project.id)
    expect(persisted.brief).toEqual(project.brief); expect(persisted.revision).toBe(project.revision); expect(persisted.handoffRevision).toBe(project.handoffRevision); expect(persisted.requirementsError).toBe(project.requirementsError); expect(Object.hasOwn(persisted, 'voiceDone')).toBe(false)
  })
})

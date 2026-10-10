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

const card = { title: '一笔小光', audience: '自己使用', purpose: '让注意力回到手指', features: ['画一笔，抬手保留。', '重新画按钮清空。'], pages: ['一页画布和重新画按钮。'], acceptance: ['不联网、不保存。'], deferred: [], designId: 'mint-garden' }
const updated = { ...card, features: ['直接跟着手指的实际路径画出完整一笔，抬手保留。', '重新画按钮清空。'] }
const failureReply = '这轮需求卡暂时没有整理成功，我先不开始制作。我们可以继续聊，或再试一次整理。'
const cases = [
  { name: 'A healthy null record cannot claim that its repair card was organized', reply: '「一笔小光」的修正卡整理好了：线条直接跟着手指走。', blocked: true },
  { name: 'A healthy unchanged record cannot claim its card was updated', reply: '需求卡已经更新好了，其他规则不变。', same: true, blocked: true },
  { name: 'A committed card update keeps its successful review', reply: '需求卡已经更新好了，其他规则不变。', changed: true },
  { name: 'Reviewing an unchanged current card remains valid', reply: '需求卡整理好了。', review: true },
  { name: 'Reviewing an unchanged current repair card does not claim a new modification', reply: '当前修正卡整理好了。', review: true, same: true, currentReview: true },
  { name: 'Current card review still cannot claim an uncommitted update', reply: '当前需求卡已经更新好了。', review: true, same: true, currentReview: true, blocked: true },
  { name: 'Quoted screen copy is not a claim of a workflow update', reply: '按钮上写「需求卡已更新」这几个字，先看看这个文案合不合适。' },
  { name: 'Remembering a previous update is not a new commit claim', reply: '上次需求卡已经更新好了，这次我们只聊手指的感觉。' },
]
let root = '', base = '', child: ChildProcess | undefined, closed: Promise<unknown>, projects: Project[] = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-unapplied-card-')); const store = new Store(root); await store.load()
  for (const item of cases) { const project = store.create('mint-garden'); project.brief = structuredClone(card); project.name = card.title; project.revision = 2; project.handoffRevision = 2; project.phase = 'refine'; projects.push(project) }
  await store.save()
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address(); if (!address || typeof address === 'string') throw new Error('UNIT_PORT_MISSING'); base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>(done => listener.close(() => done()))
  const fixture = join(root, 'provider.mjs')
  await writeFile(fixture, `const original=globalThis.fetch,cases=${JSON.stringify(cases)},card=${JSON.stringify(card)},updated=${JSON.stringify(updated)};globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);const body=JSON.parse(options.body),text=url.endsWith('/chat/completions')?body.messages.at(-1).content:JSON.parse(body.input[0].content.split('Return only JSON.\\n')[1]).newestUserMessage,item=cases[Number(text.match(/case=(\\d+)/)[1])];if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:item.reply}}]});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:item.changed?updated:item.same?card:null,handoff:'none',finish:false,inspirations:[]})}]}]})};`)
  const env = { ...process.env, DODA_DATA: root, DODA_PORT: base.match(/:(\d+)/)![1], DEEPSEEK_API_KEY: 'fixture' }
  child = spawn(process.execPath, ['--import', pathToFileURL(fixture).href, '--import', 'tsx', 'server/index.ts'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); closed = once(child, 'close')
  let output = ''; child.stdout!.on('data', value => output += value); child.stderr!.on('data', value => output += value)
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error(output); expect((await fetch(base + '/health')).ok).toBe(true) }, { timeout: 20000, interval: 100 })
}, 25000)
afterAll(async () => { child?.kill(); if (closed) await closed; if (root) { const delta = relative(tmpdir(), root); if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-unapplied-card-')) throw new Error('UNSAFE_CLEANUP'); await rm(root, { recursive: true, force: true }) } })
describe('Card updates are reported from committed state', () => {
  it.each(cases.map((item, index) => ({ ...item, index })))('$name', async item => {
    const text = item.currentReview ? `请把当前修正需求卡整理给我看，先别开工。“case=${item.index}”` : item.review || item.changed ? `请整理本轮需求给我看，先别开工。case=${item.index}` : `请把线改成直接跟随实际路径，其他规则不变，先别开工。case=${item.index}`
    const response = await fetch(base + '/projects/' + projects[item.index].id + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }), project = await response.json()
    expect(response.ok).toBe(true); expect(response.headers.get('x-doda-dialogue-requests')).toBe('1'); expect(response.headers.get('x-doda-requirements-requests')).toBe('1')
    expect(project.revision).toBe(item.changed ? 3 : 2); expect(project.brief).toEqual(item.changed ? updated : card); expect(project.runs).toEqual([]); expect(project.inspirations).toEqual([])
    if (item.blocked) { expect(project.chatReply).toBe(failureReply); expect(project.requirementsError).toContain('未写入'); expect(project.handoffRevision).toBeUndefined() }
    else { expect(project.requirementsError).toBeUndefined(); expect(project.chatReply).toBe(item.changed || item.review ? `我把「${card.title}」的想法整理好了，细节都在需求卡里。就按这张卡开始做吗？` : item.reply) }
    expect(project.messages.at(-1).content).toBe(project.chatReply); expect(project.messages.at(-2).content).toBe(text); expect(project.archive.interview).toContain(project.chatReply)
    const saved = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).projects.find((value: Project) => value.id === project.id)
    expect(saved.brief).toEqual(project.brief); expect(saved.revision).toBe(project.revision); expect(saved.handoffRevision).toBe(project.handoffRevision); expect(saved.requirementsError).toBe(project.requirementsError); expect(saved.messages).toEqual(project.messages)
  })
})

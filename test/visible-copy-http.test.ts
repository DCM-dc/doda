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

const card = { title: '数字小格', audience: '自己使用', purpose: '用点一下接住注意力', features: ['显示数字0，点一下加1，最多6。', '按钮文字“双倍快乐”。'], pages: ['数字0和一个“双倍快乐”按钮，点一下加1，最多6。'], acceptance: ['显示数字0和“双倍快乐”按钮。', '点一下加1，最多6。'], deferred: [], designId: 'mint-garden' }
const headerCard = { title:'一封小信',audience:'自己使用',purpose:'拆开一封小信',features:['顶部只写一封小信，封面晚一点拆也可以，正文光还在窗边。','点拆开显示正文、按钮合上，再点合上关闭正文。'],pages:['顶部只写一封小信，封面晚一点拆也可以，正文光还在窗边；按钮拆开或合上。'],acceptance:['顶部只写一封小信；封面晚一点拆也可以；正文光还在窗边。','点击拆开显示正文且按钮合上，再点合上隐藏正文。'],deferred:[],designId:'mint-garden' }
const cases = [
  { name: 'Omitted visible copy triggers one retry before committing a card', variant: 'missing', requests: 2 },
  { name: 'Copy in features alone does not complete the page and acceptance', variant: 'feature-only', requests: 2 },
  { name: 'Copy in the page alone does not complete acceptance', variant: 'page-only', requests: 2 },
  { name: 'Copy in acceptance alone does not complete the page', variant: 'acceptance-only', requests: 2 },
  { name: 'Two healthy records omitting copy keep the original project uncommitted', variant: 'always-missing', requests: 2, blocked: true },
  { name: 'Literal copy accepted at the first attempt needs no retry', variant: 'correct', requests: 1 },
  { name: 'Unquoted spoken sentence is retained as visible content', variant: 'unquoted', requests: 2, unquoted: true },
  { name: 'A spoken header missing from acceptance triggers a retry', variant:'header', requests:2, header:true },
  { name: 'Two records omitting the spoken header do not offer a card', variant:'header-always-missing', requests:2, header:true, blocked:true },
]
let root = '', base = '', child: ChildProcess | undefined, closed: Promise<unknown>, projects: Project[] = []
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-visible-copy-')); const store = new Store(root); await store.load()
  for (const item of cases) projects.push(store.create('mint-garden')); await store.save()
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address(); if (!address || typeof address === 'string') throw new Error('UNIT_PORT_MISSING'); base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>(done => listener.close(() => done()))
  const fixture = join(root, 'provider.mjs')
  await writeFile(fixture, `const original=globalThis.fetch,cases=${JSON.stringify(cases)},card=${JSON.stringify(card)},headerCard=${JSON.stringify(headerCard)},attempts=new Map();globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);const body=JSON.parse(options.body);if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:'这轮需求卡整理好了。'}}]});const data=JSON.parse(body.input[0].content.split('Return only JSON.\\n')[1]),index=Number(data.newestUserMessage.match(/case=(\\d+)/)[1]),item=cases[index],attempt=(attempts.get(index)||0)+1;attempts.set(index,attempt);const ready=structuredClone(item.header?headerCard:card);if(item.unquoted){ready.features=['显示一句“跟着手指慢一点”和画布，单指画一笔，抬手保留。'];ready.pages=['一页显示“跟着手指慢一点”、画布和重新画按钮。'];ready.acceptance=['显示“跟着手指慢一点”，单指画一笔，抬手保留。']}const result=structuredClone(ready);if(item.variant==='always-missing'||attempt===1&&item.variant!=='correct'){if(item.variant!=='page-only')result.pages=['一页显示内容和按钮。'];if(item.variant!=='acceptance-only')result.acceptance=['点一下，显示结果。'];if(item.variant!=='feature-only')result.features=['显示内容和按钮。']}if(item.header&&(attempt===1||item.variant==='header-always-missing')){result.features=ready.features;result.pages=ready.pages;result.acceptance=['封面晚一点拆也可以；正文光还在窗边；按钮拆开或合上。']}return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:result,handoff:'offer',finish:false,inspirations:[]})}]}]})};`)
  child = spawn(process.execPath, ['--import', pathToFileURL(fixture).href, '--import', 'tsx', 'server/index.ts'], { env: { ...process.env, DODA_DATA: root, DODA_PORT: base.match(/:(\d+)/)![1], DEEPSEEK_API_KEY: 'fixture' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); closed = once(child, 'close'); child.stdout!.resume(); child.stderr!.resume()
  await vi.waitFor(async () => { expect((await fetch(base + '/health')).ok).toBe(true) }, { timeout: 12000, interval: 50 })
})
afterAll(async () => { if (child && child.exitCode === null) child.kill(); if (closed) await closed; const path = relative(tmpdir(), root); if (root && path && !path.startsWith('..') && !isAbsolute(path)) await rm(root, { recursive: true, force: true }) })
describe('A ready card retains declared visible content', () => {
  for (const [index, item] of cases.entries()) it(item.name, async () => {
    const text = item.header ? `顶上只写一封小信封面文字固定式晚一点拆也可以，正文固定光还在窗边。按钮拆开或合上。现在整理需求卡，不开工。“case=${index}”` : item.unquoted ? `自己玩一页只放一句，跟着手指慢一点，一块画布和重新画按钮。单指画一笔抬手保留。现在整理本轮需求给我看。“case=${index}”` : `自己玩的单页数字初值0，每点一次加1，最多6。按钮文字固定写“双倍快乐”。现在整理本轮需求给我看。“case=${index}”`
    const response = await fetch(`${base}/projects/${projects[index].id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }), project = await response.json() as Project & { chatReply: string }
    expect(response.status).toBe(200); expect(response.headers.get('x-doda-requirements-requests')).toBe(String(item.requests)); expect(project.runs).toEqual([])
    if (item.blocked) { expect(project.brief).toBeUndefined(); expect(project.revision).toBe(0); expect(project.handoffRevision).toBeUndefined(); expect(project.requirementsError).toBeTruthy(); expect(project.chatReply).toContain('暂时没有整理成功') }
    else { expect(project.revision).toBe(1); expect(project.handoffRevision).toBe(1); expect(project.requirementsError).toBeUndefined(); expect(project.brief!.pages.join('\n')).toContain(item.header ? '一封小信' : item.unquoted ? '跟着手指慢一点' : '双倍快乐'); expect(project.brief!.acceptance.join('\n')).toContain(item.header ? '一封小信' : item.unquoted ? '跟着手指慢一点' : '双倍快乐') }
    const saved = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).projects.find((entry: Project) => entry.id === project.id); expect(saved.brief).toEqual(project.brief); expect(saved.revision).toBe(project.revision); expect(saved.handoffRevision).toBe(project.handoffRevision); expect(saved.messages).toEqual(project.messages)
  })
})

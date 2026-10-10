import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'

const card = { title: '等车数一下', audience: '自己玩', purpose: '等车时随手数一下', features: ['加一下使数字增加1，上限9', '回到0按钮使数字回0'], pages: ['主页：数字初始0，加一下按钮，回到0按钮'], acceptance: ['只能显示0到9，每次加1', '回到0和冷启动都回0，不登录、不联网、不存储'], deferred: [], designId: 'soft-blue' }
type ReadinessCase = { name: string; reply: string; voice?: boolean; summarize?: boolean; input?: string; ready?: boolean; pending?: boolean; inspiration?: string }
const cases: ReadinessCase[] = [
  { name: '模糊愿望的语音追问不被卡覆盖', voice: true, reply: '等车的两分钟正适合这种小东西。点一下换一句话，还是一个颜色？' },
  { name: '文字追问留在消息与档案', reply: '点一下以后出现什么？' },
  { name: '省略问号的语音问题继续聊天', voice: true, reply: '你想点一下就换一句话吗' },
  { name: '英语开放问题不能冒充就绪', reply: 'Which content should change when you tap?' },
  { name: '交付确认后还有开放问题仍不出卡', reply: '可以交给编程伙伴吗？另外，点一下换什么？' },
  { name: '涉及编程伙伴的功能选择仍要讨论', reply: '让编程伙伴做一句话还是小图？' },
  { name: '完整规则的首轮交付确认可以出卡', reply: '就按这个交给编程伙伴吗？', ready: true },
  { name: '引用的问句不是未定项', reply: '页面显示「点一下换什么？」这句文案。', ready: true },
  { name: '明确按钮整理请求仍出卡', reply: '你想点一下换什么？', summarize: true, ready: true },
  { name: '明确自然语言整理请求仍出卡', reply: '你想点一下换什么？', input: '先整理本轮需求给我看', ready: true },
  { name: '新的未定问题撤下旧卡待确认但保留旧卡', reply: '点一下换一句话，还是一张小图？', pending: true },
  { name: '继续讨论时仍保存用户明确延期的灵感', voice: true, reply: '先不加声音。点一下换一句话，还是颜色？', inspiration: '声音留到下次加' },
  { name: '引用整理按钮不放行未定玩法', input: '按钮叫「整理本轮需求」，但我还没想好点一下出现什么', reply: '点一下出现一句话，还是小图？' },
  { name: '当前否定整理仍保留问题', input: '暂时不用总结需求，我还没想好点一下出现什么', reply: '点一下出现一句话，还是小图？' },
  { name: '最新否定覆盖早先整理请求', input: '先整理本轮需求，想了想还是别整理需求', reply: '点一下出现一句话，还是小图？' },
  { name: '引用后真正要求整理仍能看卡', input: '按钮叫「整理本轮需求」，现在请整理需求', reply: '点一下出现一句话，还是小图？', ready: true },
]
let root = '', base = '', child: ChildProcess | undefined, exited: Promise<unknown>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-requirements-dialogue-'))
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('FIXTURE_PORT_MISSING')
  base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()))
  const provider = join(root, 'provider.mjs')
  await writeFile(provider, `const upstream=globalThis.fetch,cases=${JSON.stringify(cases)},card=${JSON.stringify(card)};globalThis.fetch=async function(input,options){const url=String(input);if(url==='https://api.deepseek.com/chat/completions'){const body=JSON.parse(options.body),match=body.messages.findLast(item=>item.role==='user').content.match(/case=(\\d+);turn=(\\d+)/);if(!match)throw new Error('FIXTURE_CASE_MISSING');const content=Number(match[2])===1?'就按这个交给编程伙伴吗？':cases[Number(match[1])].reply;return new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}})}if(url==='https://api.deepseek.com/responses'){const body=JSON.parse(options.body),match=body.input[0].content.match(/case=(\\d+);turn=(\\d+)/);if(!match)throw new Error('FIXTURE_CASE_MISSING');const item=cases[Number(match[1])],result={reply:'recorded',brief:card,handoff:'offer',finish:false,inspirations:Number(match[2])===2&&item.inspiration?[item.inspiration]:[]};return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}),{headers:{'Content-Type':'application/json'}})}return upstream(input,options)};`)
  const env = { ...process.env, DODA_PRODUCTION: '1', DODA_DATA: root, DODA_PORT: String(address.port), DEEPSEEK_API_KEY: 'requirements-dialogue-provider-fixture', MIMO_API_KEY: '' }
  const inheritedModulePath = Object.entries(env).find(([name]) => name.toLowerCase() === 'psmodulepath')?.[1]
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name as keyof typeof env]
  if (inheritedModulePath) Object.assign(env, { PSMODULEPATH: inheritedModulePath })
  child = spawn(process.execPath, ['--import', pathToFileURL(provider).href, '--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let bootError = ''; child.stdout?.resume(); child.stderr?.on('data', chunk => { bootError += String(chunk) }); exited = once(child, 'exit')
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error(`FIXTURE_BOOT_FAILED: ${bootError}`); expect((await fetch(base + '/health')).status).toBe(200) }, { timeout: 20000, interval: 100 })
}, 30000)

afterAll(async () => {
  if (child?.exitCode === null) child.kill()
  if (exited) await exited
  if (!root) return
  const delta = relative(resolve(tmpdir()), resolve(root))
  if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-requirements-dialogue-')) throw new Error('INVALID_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
})

async function chat(id: string, index: number, turn: number) {
  const item = cases[index], text = turn === 1 ? '做等车数一下，给自己玩，沿用晴空。只有主页，当前数字初始0；加一下每次加1，上限9；回到0按钮把数字回0。冷启动回0，不登录、不联网、不存储。' : item.input || '等车时点一下换个念头。给自己玩。'
  return fetch(`${base}/projects/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `${text}case=${index};turn=${turn}`, voice: item.voice, summarize: item.summarize }) })
}

describe('真实聊天路由协调主对话和独立整理器', () => {
  it.each(cases.map((item, index) => ({ ...item, index })))('$name', async item => {
    const created = await fetch(base + '/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designId: 'soft-blue' }) }), project = await created.json()
    expect(created.status).toBe(200)
    if (item.pending) { const seed = await (await chat(project.id, item.index, 1)).json(); expect(seed.revision).toBe(1); expect(seed.handoffRevision).toBe(1); expect(seed.brief).toEqual(card) }
    const response = await chat(project.id, item.index, 2), result = await response.json(), expected = item.ready ? `我把「${card.title}」的想法整理好了，细节都在需求卡里。就按这张卡开始做吗？` : item.reply === '可以交给编程伙伴吗？另外，点一下换什么？' ? '可以让我来做吗？另外，点一下换什么？' : item.reply === '让编程伙伴做一句话还是小图？' ? '让我做一句话还是小图？' : item.reply
    expect(response.status).toBe(200); expect(result.chatReply).toBe(expected); expect(result.messages.at(-1).content).toBe(expected); expect(result.archive.interview.endsWith(`doda：${expected}\n\n记录时间：${result.messages.at(-1).time}`)).toBe(true)
    expect(result.revision).toBe(item.ready || item.pending ? 1 : 0); expect(result.brief).toEqual(item.ready || item.pending ? card : undefined); expect(result.handoffRevision).toBe(item.ready ? 1 : undefined); expect(result.runs).toEqual([]); expect(result.inspirations).toEqual(item.inspiration ? [item.inspiration] : []); expect(result.requirementsError).toBeUndefined(); expect(result.voiceDone).toBe(item.voice ? false : undefined)
    expect(response.headers.get('x-doda-dialogue-requests')).toBe('1'); expect(response.headers.get('x-doda-requirements-requests')).toBe('1'); expect(response.headers.get('x-doda-reply-refinements')).toBe('0')
    const saved = (await (await fetch(base + '/state')).json()).projects.find((entry: { id: string }) => entry.id === project.id)
    expect(saved.messages.at(-1).content).toBe(expected); expect(saved.archive).toEqual(result.archive); expect(saved.handoffRevision).toBe(item.ready ? 1 : undefined); expect(saved.runs).toEqual([])
  }, 30000)
})

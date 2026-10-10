import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'

const first = '手指一滑，风就有了形状。你烦的时候更想捏成大风，还是回到安静？', statement = '那一点松开，像把烦乱轻轻放下了。'
type CadenceCase = { name: string; voice: boolean; replies: string[]; expected: string; requests: number; refinements: number; input?: string; settled?: boolean; pauses?: boolean; initial?: boolean; nextExpected?: string }
const cases: CadenceCase[] = [
  { name: '真实录音候选的音量取舍不进入语音或档案', voice: true, initial: false, pauses: false, input: '先继续聊天，不改需求。像按一下桌上的小铃铛，知道它回应我，就挺有意思。', replies: ['嗯，就是那种不用太大声的回应，铃铛“叮”一下，你知道它在。你会喜欢偏小声的，还是稍微有点存在感的？'], expected: '嗯，就是那种不用太大声的回应，铃铛“叮”一下，你知道它在。', requests: 1, refinements: 1 },
  { name: '首次只聊感受的文字候选收掉新增颜色取舍', voice: false, initial: false, pauses: false, input: '继续聊感觉，不改这轮。一个小回应让人想再碰一下。', replies: [statement + '你想用什么颜色？'], expected: statement, requests: 1, refinements: 1 },
  { name: '首次只聊感受的纯参数问题重新接话一次', voice: true, initial: false, pauses: false, input: '继续聊天，不改需求。铃铛轻轻应一下就有意思。', replies: ['你想把音量调成多少？', statement], expected: statement, requests: 2, refinements: 1 },
  { name: '两次纯参数问题后继续语音而不保存问题', voice: true, initial: false, pauses: false, input: '继续聊天，不改需求。铃铛轻轻应一下就有意思。', replies: ['你想把音量调成多少？', '你希望声音更大还是更小？'], expected: '我在听，你接着说。', requests: 2, refinements: 1 },
  { name: '首次只聊感受仍保留真实生活问题', voice: false, initial: false, pauses: false, input: '继续聊天，不改需求。让我想起以前桌上的小铃铛。', replies: ['你小时候也会摇桌上的小铃铛吗？'], expected: '你小时候也会摇桌上的小铃铛吗？', requests: 1, refinements: 0, nextExpected: '手指一滑，风就有了形状。' },
  { name: '主动讨论未定音量时保留参数选择', voice: true, settled: true, pauses: false, input: '音量还没定。先继续聊怎么调整声音的大小，请问我想要哪种。不要整理或编程。', replies: ['你希望声音更大还是更小？'], expected: '你希望声音更大还是更小？', requests: 1, refinements: 0 },
  { name: '文字回复保留陈述并收掉追加问题', voice: false, replies: [statement + '你烦的时候更想捏大还是捏小？'], expected: statement, requests: 1, refinements: 1 },
  { name: '语音回复消息与档案使用同一陈述', voice: true, replies: [statement + '你更想把风捏成大风吹走，还是捏回安静？'], expected: statement, requests: 1, refinements: 1 },
  { name: '仅问问题的候选重新接话一次', voice: true, replies: ['你自己烦的时候，会想把风捏大吗？', statement], expected: statement, requests: 2, refinements: 1 },
  { name: '两次纯追问以简短接话继续聊天', voice: true, replies: ['你自己烦的时候，会想把风捏大吗？', '那你这会儿更想让风安静还是大一点？'], expected: '我在听，你接着说。', requests: 2, refinements: 1 },
  { name: '引用问题作为陈述保留', voice: false, replies: ['你说的“风能装起来吗？”像一个小愿望。你想把它捏大吗？'], expected: '你说的“风能装起来吗？”像一个小愿望。', requests: 1, refinements: 1 },
  { name: '先追问后接话保留后面的陈述', voice: false, replies: ['你更想大风还是安静？' + statement], expected: statement, requests: 1, refinements: 1 },
  { name: '已经自然接话的候选保持原文', voice: false, replies: [statement], expected: statement, requests: 1, refinements: 0 },
  { name: '省略问号的追问不进入语音或档案', voice: true, replies: [statement + '你想把风捏大吗'], expected: statement, requests: 1, refinements: 1 },
  { name: '已定功能讨论首轮保留回应并收掉追加问题', voice: false, settled: true, input: '旧卡不随草稿变化，只有再收卡才替换。这些规则已经定了。先聊这些行为，不整理，也不编程。', replies: [statement + '你想先怎么玩这盒配料？'], expected: statement, requests: 1, refinements: 1 },
  { name: '已定语音功能讨论的纯问题重新接话一次', voice: true, settled: true, input: '回到窗边只改草稿，旧卡还留着。这套规则已经确定了。先聊，不整理，也不编程。', replies: ['你想把旧卡保留还是替换？', statement], expected: statement, requests: 2, refinements: 1 },
  { name: '已定语音功能讨论两次纯问题仍继续聆听', voice: true, settled: true, input: '新收才替换上一张。这些行为已经定了。先聊，不整理，也不编程。', replies: ['你想先试哪组？', '今天想聊什么？'], expected: '我在听，你接着说。', requests: 2, refinements: 1 },
  { name: '已定功能讨论保留被引用的问句', voice: false, settled: true, input: '旧卡不动的规则已经定了。这些规则已经定了，先聊，不整理，也不编程。', replies: ['你说的“纸条能留住光吗？”像一个小愿望。你想先试哪组？'], expected: '你说的“纸条能留住光吗？”像一个小愿望。', requests: 1, refinements: 1 },
  { name: '明确尚未定的功能问题保持原回复', voice: true, settled: true, pauses: false, input: '规则还没定。请你问我替换上一张还是留下以前的卡。先聊，不整理，也不编程。', replies: ['你想替换上一张，还是留下以前的卡？'], expected: '你想替换上一张，还是留下以前的卡？', requests: 1, refinements: 0 },
  { name: '被引用的已定规则不暂停当前讨论问题', voice: false, settled: true, pauses: false, input: '有人说“这些规则已经定了”，但我还没定。请你问我替换上一张还是留下以前的卡。先聊，不整理，也不编程。', replies: ['你想替换上一张，还是留下以前的卡？'], expected: '你想替换上一张，还是留下以前的卡？', requests: 1, refinements: 0 },
]
let root = '', base = '', child: ChildProcess | undefined, exited: Promise<unknown>, requestsPath = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-casual-cadence-')); requestsPath = join(root, 'requests.jsonl')
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('FIXTURE_PORT_MISSING')
  base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()))
  const provider = join(root, 'provider.mjs')
  await writeFile(provider, `import {appendFile} from 'node:fs/promises';const upstream=globalThis.fetch,counts=new Map(),cases=${JSON.stringify(cases)},path=${JSON.stringify(requestsPath)};globalThis.fetch=async function(input,options){if(String(input)==='https://api.deepseek.com/chat/completions'){const body=JSON.parse(options.body),text=body.messages.findLast(item=>item.role==='user').content,match=text.match(/case=(\\d+);turn=(\\d+)/);if(!match)throw new Error('FIXTURE_CASE_MISSING');const index=Number(match[1]),turn=Number(match[2]),key=index+':'+turn,count=counts.get(key)||0;counts.set(key,count+1);await appendFile(path,JSON.stringify({index,turn,messages:body.messages})+'\\n');const content=turn===1?${JSON.stringify(first)}:turn===3?${JSON.stringify(first)}:cases[index].replies[Math.min(count,cases[index].replies.length-1)];return new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}})}if(String(input)==='https://api.deepseek.com/responses'){const body=JSON.parse(options.body),match=body.input[0].content.match(/case=(\\d+);turn=(\\d+)/);if(!match||!cases[Number(match[1])].settled)throw new Error('UNEXPECTED_REQUIREMENTS_REQUEST');return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:null,handoff:'none',finish:false,inspirations:[]})}]}]}),{headers:{'Content-Type':'application/json'}})}return upstream(input,options)};`)
  const env = { ...process.env, DODA_PRODUCTION: '1', DODA_DATA: root, DODA_PORT: String(address.port), DEEPSEEK_API_KEY: 'casual-cadence-provider-fixture', MIMO_API_KEY: '' }
  const inheritedModulePath = Object.entries(env).find(([name]) => name.toLowerCase() === 'psmodulepath')?.[1]
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name as keyof typeof env]
  if (inheritedModulePath) Object.assign(env, { PSMODULEPATH: inheritedModulePath })
  child = spawn(process.execPath, ['--import', pathToFileURL(provider).href, '--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let bootError = ''; child.stdout?.resume(); child.stderr?.on('data', chunk => { bootError += String(chunk) }); exited = once(child, 'exit')
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error(`FIXTURE_BOOT_FAILED: ${bootError}`); const response = await fetch(base + '/health'); expect(response.status).toBe(200) }, { timeout: 20000, interval: 100 })
}, 30000)

afterAll(async () => {
  if (child?.exitCode === null) child.kill()
  if (exited) await exited
  if (!root) return
  const delta = relative(resolve(tmpdir()), resolve(root))
  if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-casual-cadence-')) throw new Error('INVALID_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
})

async function chat(id: string, index: number, turn: number, voice: boolean) {
  const text = turn === 2 && cases[index].input ? cases[index].input : '继续随便聊，不整理也不改作品。风没有真的吹起来，手心却像松开了一点。'
  return fetch(`${base}/projects/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `${text}case=${index};turn=${turn}`, voice }) })
}

describe('真实聊天路由接收受控上游闲聊候选', () => {
  it.each(cases.map((item, index) => ({ ...item, index })))('$name', async item => {
    const created = await fetch(base + '/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designId: 'soft-blue' }) }), project = await created.json()
    expect(created.status).toBe(200)
    if (!item.settled && item.initial !== false) { const initial = await chat(project.id, item.index, 1, item.voice), seed = await initial.json(); expect(initial.status).toBe(200); expect(seed.chatReply).toBe(first) }
    const response = await chat(project.id, item.index, 2, item.voice), result = await response.json()
    expect(response.status).toBe(200); expect(result.chatReply).toBe(item.expected); expect(response.headers.get('x-doda-dialogue-requests')).toBe(String(item.requests)); expect(response.headers.get('x-doda-reply-refinements')).toBe(String(item.refinements)); expect(response.headers.get('x-doda-requirements-requests')).toBe(item.settled ? '1' : '0'); expect(result.voiceDone).toBe(item.voice ? false : undefined); expect(result.messages.at(-1).content).toBe(item.expected); expect(result.archive.interview.endsWith(`doda：${item.expected}\n\n记录时间：${result.messages.at(-1).time}`)).toBe(true); expect(result.revision).toBe(0); expect(result.runs).toEqual([])
    const persisted = await (await fetch(base + '/state')).json(), saved = persisted.projects.find((entry: { id: string }) => entry.id === project.id)
    expect(saved.messages.at(-1).content).toBe(item.expected); expect(saved.archive).toEqual(result.archive)
    const requests = (await readFile(requestsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line)), current = requests.filter(request => request.index === item.index && request.turn === 2)
    expect(current).toHaveLength(item.requests); expect(current[0].messages.filter((message: { role: string; content: string }) => message.role === 'system').every((message: { content: string }) => message.content.includes('本轮先接话，不提问。'))).toBe(item.pauses ?? true)
    const next = await chat(project.id, item.index, 3, item.voice), released = await next.json()
    expect(next.status).toBe(200); expect(released.chatReply).toBe(item.nextExpected || first); expect(next.headers.get('x-doda-dialogue-requests')).toBe('1')
  }, 30000)
})

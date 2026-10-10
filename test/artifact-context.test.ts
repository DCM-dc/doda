import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store, defaultDesigns } from '../server/store'
import type { Run } from '../server/contracts'
import { dialogueMessages } from '../server/contracts'

const temporary: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doda-artifact-')); temporary.push(root)
  const store = new Store(root); await store.load()
  const project = store.create('soft-blue')
  const run: Run = { id: randomUUID(), status: 'completed', startedAt: '2026-10-07T00:00:00Z', finishedAt: '2026-10-07T00:01:00Z', events: [{ time: '2026-10-07T00:01:00Z', kind: 'completed', text: '交付了四个故事结局；未验证真机。' }], files: ['app.js', 'app.json', 'story.js', 'pages/story/index.js', 'pages/story/index.wxml', 'pages/home/index.wxml'], snapshot: { id: randomUUID(), revision: 1, hash: 'delivered-hash', time: '2026-10-07T00:00:00Z', design: defaultDesigns[0], brief: { title: '猫猫奇遇', audience: '我', purpose: '看故事', features: ['四个结局'], pages: ['故事页'], acceptance: ['能到达结局'], deferred: [], designId: 'soft-blue' } } }
  project.runs.unshift(run); project.brief = { ...run.snapshot.brief, title: '未交付的下一版', features: ['增加第五个结局'] }; project.revision = 2
  const candidate = join(root, 'projects', project.id, 'runs', run.id, 'candidate')
  const sources: Record<string, string> = { 'app.json': '{"pages":["pages/story/index"]}', 'app.js': 'App({})', 'story.js': 'module.exports={ending:"回家的那盏灯"}', 'pages/story/index.js': 'Page({data:{scene:"猫猫的晚饭"}})', 'pages/story/index.wxml': '<view>蓝皮书里的字</view>', 'pages/home/index.wxml': '<view>未注册的起始模板</view>' }
  for (const [path, content] of Object.entries(sources)) { await mkdir(join(candidate, path, '..'), { recursive: true }); await writeFile(join(candidate, path), content) }
  await mkdir(store.files(project.id), { recursive: true }); await writeFile(join(store.files(project.id), 'story.js'), '正在安装的新版本')
  return { root, store, project, run, candidate }
}

afterEach(async () => {
  for (const path of temporary.splice(0)) {
    const delta = relative(resolve(tmpdir()), resolve(path))
    if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-artifact-')) throw new Error('INVALID_TEST_CLEANUP')
    await rm(path, { recursive: true, force: true })
  }
})

describe('Delivered artifact knowledge for ongoing conversation', () => {
  it('includes global and registered-page styles after the delivered behavior sources', async () => {
    const { store, project, run, candidate } = await fixture()
    run.files!.push('app.wxss','pages/story/index.wxss')
    await writeFile(join(candidate,'app.wxss'),'page{background:#f6f2eb}')
    await writeFile(join(candidate,'pages/story/index.wxss'),'.dot{background:#b66b44}.grid{border-radius:28rpx}')
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge!.files.find(file=>file.path==='app.wxss')).toEqual({path:'app.wxss',content:'page{background:#f6f2eb}',truncated:false})
    expect(knowledge!.files.find(file=>file.path==='pages/story/index.wxss')).toEqual({path:'pages/story/index.wxss',content:'.dot{background:#b66b44}.grid{border-radius:28rpx}',truncated:false})
    expect(knowledge!.files.slice(0,4).map(file=>file.path)).toEqual(['app.json','app.js','story.js','pages/story/index.js'])
    expect(knowledge!.sourceIncomplete).toBe(false)
  })
  it('reads delivered styles from the frozen candidate rather than the current next version', async () => {
    const { store, project, run, candidate } = await fixture()
    run.files!.push('pages/story/index.wxss')
    await writeFile(join(candidate,'pages/story/index.wxss'),'.dot{background:#b66b44}')
    await mkdir(join(store.files(project.id),'pages/story'),{recursive:true})
    await writeFile(join(store.files(project.id),'pages/story/index.wxss'),'.dot{background:#4d6bfe}')
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge!.files.find(file=>file.path==='pages/story/index.wxss')).toEqual({path:'pages/story/index.wxss',content:'.dot{background:#b66b44}',truncated:false})
    expect(JSON.stringify(knowledge)).not.toContain('#4d6bfe')
    expect(project.revision).toBe(2)
  })
  it('excludes style files belonging to a page outside the delivered app configuration', async () => {
    const { store, project, run, candidate } = await fixture()
    run.files!.push('pages/home/index.wxss')
    await writeFile(join(candidate,'pages/home/index.wxss'),'UNREGISTERED_STYLE_CANARY')
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge!.files.some(file=>file.path==='pages/home/index.wxss')).toBe(false)
    expect(JSON.stringify(knowledge)).not.toContain('UNREGISTERED_STYLE_CANARY')
  })
  it('bounds a long delivered stylesheet and identifies its truncated evidence', async () => {
    const { store, project, run, candidate } = await fixture()
    run.files!.push('pages/story/index.wxss')
    await writeFile(join(candidate,'pages/story/index.wxss'),'x'.repeat(15000))
    const knowledge = await store.deliveredContext(project.id),style=knowledge!.files.find(file=>file.path==='pages/story/index.wxss')!
    expect(style).toEqual({path:'pages/story/index.wxss',content:'x'.repeat(12000),truncated:true});expect(knowledge!.sourceIncomplete).toBe(true)
    expect(knowledge!.files.reduce((total,file)=>total+file.content.length,0)).toBeLessThanOrEqual(24000)
  })
  it('marks a missing manifest-listed stylesheet as incomplete evidence', async () => {
    const { store, project, run } = await fixture();run.files!.push('pages/story/missing.wxss')
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge!.files.some(file=>file.path==='pages/story/missing.wxss')).toBe(false);expect(knowledge!.sourceIncomplete).toBe(true)
  })
  it('rejects an escaping stylesheet path and marks the evidence gap', async () => {
    const { root, store, project, run } = await fixture()
    await writeFile(join(root,'outside.wxss'),'PRIVATE_STYLE_CANARY');run.files!.push('../../../../../outside.wxss')
    const knowledge = await store.deliveredContext(project.id)
    expect(JSON.stringify(knowledge)).not.toContain('PRIVATE_STYLE_CANARY');expect(knowledge!.sourceIncomplete).toBe(true)
  })
  it('does not call an unbuilt scaffold a delivered work', async () => {
    const { store, project, run } = await fixture(); run.status = 'running'
    expect(await store.deliveredContext(project.id)).toBeNull()
  })
  it('uses the last completed snapshot and immutable candidate, excluding a new draft and unfinished runs', async () => {
    const { store, project, run, candidate } = await fixture()
    project.runs.unshift({ ...run, id: randomUUID(), status: 'failed', snapshot: { ...run.snapshot, revision: 2, brief: project.brief! } }, { ...run, id: randomUUID(), status: 'running', snapshot: { ...run.snapshot, revision: 3, brief: project.brief! } })
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge?.runId).toBe(run.id); expect(knowledge?.revision).toBe(1); expect(knowledge?.brief.title).toBe('猫猫奇遇')
    expect(knowledge?.files.find(file => file.path === 'story.js')?.content).toContain('回家的那盏灯')
    expect(JSON.stringify(knowledge)).not.toContain('正在安装的新版本'); expect(JSON.stringify(knowledge)).not.toContain('未交付的下一版')
    expect(knowledge?.files.some(file => file.path.startsWith('pages/home/'))).toBe(false)
    expect(knowledge?.sourceIncomplete).toBe(false)
    await expect(readFile(join(candidate, 'story.js'), 'utf8')).resolves.toContain('回家的那盏灯')
    expect(project.revision).toBe(2)
  })
  it('bounds source and summary and marks any omitted or shortened content', async () => {
    const { store, project, run, candidate } = await fixture()
    run.events[0].text = '摘要'.repeat(4000)
    for (const file of ['app.js', 'story.js', 'pages/story/index.js']) await writeFile(join(candidate, file), 'x'.repeat(20000))
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge?.summary.length).toBeLessThanOrEqual(4000); expect(knowledge?.summaryTruncated).toBe(true)
    expect(knowledge!.files.reduce((total, file) => total + file.content.length, 0)).toBeLessThanOrEqual(24000)
    expect(knowledge?.files.every(file => file.content.length <= 12000)).toBe(true)
    expect(knowledge?.sourceIncomplete).toBe(true); expect(knowledge?.files.some(file => file.truncated)).toBe(true)
  })
  it('preserves delivered metadata when the recorded candidate is unavailable', async () => {
    const { store, project, run } = await fixture(); run.id = randomUUID()
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge?.runId).toBe(run.id); expect(knowledge?.files).toEqual([]); expect(knowledge?.sourceIncomplete).toBe(true)
    expect(knowledge?.summary).toContain('未验证真机')
  })
  it('does not read paths that escape the delivered candidate', async () => {
    const { root, store, project, run } = await fixture()
    await writeFile(join(root, 'outside.js'), 'PRIVATE_CANARY_MUST_NOT_BE_READ'); run.files!.push('../../../../../outside.js')
    const knowledge = await store.deliveredContext(project.id)
    expect(JSON.stringify(knowledge)).not.toContain('PRIVATE_CANARY_MUST_NOT_BE_READ'); expect(knowledge?.sourceIncomplete).toBe(true)
  })
  it.each([false, true])('keeps new delivered evidence current without inventing user turns or changing chat history (spoken %s)', async spoken => {
    const { store, project } = await fixture()
    const history = [{ role: 'assistant' as const, content: '我看不到实际作品。' }, { role: 'user' as const, content: '请看这版实际结局的名字。' }], before = structuredClone(history)
    const messages = dialogueMessages('继续聊天', history, await store.deliveredContext(project.id), spoken)
    expect(messages.at(-1)).toEqual(history.at(-1))
    expect(messages.filter(message => message.role === 'user')).toEqual([history[1]])
    const evidence = messages.reduce((found, message, index) => message.role === 'system' && message.content.includes('回家的那盏灯') ? index : found, -1)
    expect(evidence).toBeGreaterThan(messages.findIndex(message => message.content === history[0].content))
    expect(evidence).toBeLessThan(messages.length - 1); expect(history).toEqual(before)
  })
  it('includes only visible delivery summaries rather than internal native events', async () => {
    const { store, project, run } = await fixture()
    run.events.push({ time: '2026-10-07T00:02:00Z', kind: 'internal', text: 'INTERNAL_CONTEXT_CANARY' })
    const knowledge = await store.deliveredContext(project.id)
    expect(knowledge?.summary).toContain('交付了四个故事结局'); expect(JSON.stringify(knowledge)).not.toContain('INTERNAL_CONTEXT_CANARY')
  })
})

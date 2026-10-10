import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../server/store'
import { Builder } from '../server/dsh'
import { scaffold } from '../server/miniprogram'
import type { DeepSeekHarness, DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client'

const temporary: string[] = []
const builders: Builder[] = []
const stores: Store[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'doda-build-requirements-')); temporary.push(root)
  const store = new Store(root); await store.load()
  const project = store.create('soft-blue')
  project.brief = { title: '已经过时的卡片', audience: '测试', purpose: '本轮新需求尚未整理成功', features: ['旧功能'], pages: ['首页'], acceptance: ['旧功能可用'], deferred: [], designId: 'soft-blue' }
  project.revision = 3; project.handoffRevision = 3; project.requirementsError = '需求卡暂时没有整理成功，继续聊或点击“整理本轮需求”重试。'
  await store.save()
  const credential = vi.fn(() => '')
  const builder = new Builder(store, credential); builders.push(builder); stores.push(store)
  return { root, store, project, credential, builder }
}
afterEach(async () => {
  for (const builder of builders.splice(0)) await builder.close()
  for (const store of stores.splice(0)) await store.save()
  vi.restoreAllMocks()
  for (const path of temporary.splice(0)) {
    const delta = relative(resolve(tmpdir()), resolve(path))
    if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-build-requirements-')) throw new Error('INVALID_TEST_CLEANUP')
    await rm(path, { recursive: true, force: true })
  }
})
describe('Implementation dispatch after a failed requirement update', () => {
  it('rejects the failed card before requesting any model credential', async () => {
    const { project, credential, builder } = await fixture()
    await expect(builder.start(project)).rejects.toThrow(project.requirementsError)
    expect(credential).not.toHaveBeenCalled()
    expect(project.runs).toEqual([])
  })
  it('a rejected stale card leaves the project and disk unchanged without creating a run directory', async () => {
    const { root, store, project, builder } = await fixture()
    const beforeProject = structuredClone(project), beforeDisk = await readFile(join(root, 'state.json'), 'utf8')
    await expect(builder.start(project)).rejects.toThrow(project.requirementsError)
    expect(project).toEqual(beforeProject)
    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(beforeDisk)
    await expect(stat(store.files(project.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('a card with no failure marker proceeds to the ordinary credential requirement', async () => {
    const { project, credential, builder } = await fixture()
    project.requirementsError = undefined
    await expect(builder.start(project)).rejects.toThrow('请在设置中填写 DeepSeek API key。')
    expect(credential).toHaveBeenCalledTimes(1)
    expect(project.runs).toEqual([])
  })
})

function initializedTimeout() { return new Error('initialize timed out after 30000ms waiting for dsh profile "sdk-minimal"') }
async function startupFixture(start: () => Promise<void>, runFailure?: Error, close = async () => {}) {
  const base = await fixture(); base.project.requirementsError = undefined
  await scaffold(base.store.files(base.project.id), base.store.design('soft-blue'), '')
  const original = await readFile(join(base.store.files(base.project.id), 'pages/home/index.js'), 'utf8')
  let options!: DeepSeekHarnessOptions
  const running = vi.fn(async () => { if (runFailure) throw runFailure; await writeFile(join(options.cwd!, 'pages/home/index.js'), 'Page({data:{value:2}})'); return { events: [], finalResponse: '启动检查生成的隔离候选。' } })
  const starting = vi.fn(start), closing = vi.fn(close), runtime = vi.fn((captured: DeepSeekHarnessOptions) => { options = captured; return { start: starting, close: closing, session: () => ({ id: 'startup-fixture-session', run: running }) } as unknown as DeepSeekHarness })
  const builder = new Builder(base.store, () => 'startup-fixture', runtime); builders.push(builder)
  return { ...base, original, starting, running, closing, runtime, builder }
}
async function terminalStartup(run: Awaited<ReturnType<Builder['start']>>, builder: Builder) { await vi.waitFor(() => expect(run.finishedAt).toBeTypeOf('string'), { timeout: 10000, interval: 20 }); await builder.close() }

describe('Implementation runtime startup recovery', () => {
  it('closing during final persistence waits without closing the finished harness twice', async () => {
    let begin!: () => void, persist!: () => void, saved!: () => void
    const started = new Promise<void>(done => { begin = done }), finalSave = new Promise<void>(done => { persist = done }), saving = new Promise<void>(done => { saved = done })
    const test = await startupFixture(async () => { await started }), originalSave = test.store.save.bind(test.store)
    vi.spyOn(test.store, 'save').mockImplementation(async () => { if (test.project.runs[0]?.finishedAt) { saved(); await finalSave } await originalSave() })
    const run = await test.builder.start(test.project)
    begin(); await saving
    const closing = test.builder.close()
    try { expect(test.closing).toHaveBeenCalledTimes(1); expect(run.status).toBe('completed') }
    finally { persist(); await closing }
    expect(JSON.parse(await readFile(join(test.root, 'state.json'), 'utf8')).projects[0].runs[0].status).toBe('completed')
  })
  it('retries one failed handshake only after the SDK has settled cleanup, then starts one agent turn', async () => {
    let attempts = 0, release!: () => void, started!: () => void
    const firstStart = new Promise<void>(done => { started = done }), cleanup = new Promise<void>(done => { release = done }), test = await startupFixture(async () => { started(); if (++attempts === 1) { await cleanup; throw initializedTimeout() } })
    const run = await test.builder.start(test.project)
    try { await firstStart; expect(test.starting).toHaveBeenCalledTimes(1); expect(test.running).not.toHaveBeenCalled() }
    finally { release() }
    await terminalStartup(run, test.builder)
    expect(test.starting).toHaveBeenCalledTimes(2); expect(test.runtime).toHaveBeenCalledTimes(1); expect(test.running).toHaveBeenCalledTimes(1)
    expect(run.status).toBe('completed'); expect(run.events.filter(event => event.kind === 'startup-retry')).toHaveLength(1)
    expect(await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8')).toBe('Page({data:{value:2}})')
    expect(test.closing).toHaveBeenCalledTimes(1)
  })
  it('two failed startup handshakes reach a terminal failure and preserve the current native files', async () => {
    const test = await startupFixture(async () => { throw initializedTimeout() }), run = await test.builder.start(test.project); await terminalStartup(run, test.builder)
    expect(test.starting).toHaveBeenCalledTimes(2); expect(test.running).not.toHaveBeenCalled(); expect(run.status).toBe('failed')
    expect(run.events.filter(event => event.kind === 'startup-retry')).toHaveLength(1)
    expect(await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8')).toBe(test.original)
  })
  it('startup configuration or authentication errors do not retry', async () => {
    const test = await startupFixture(async () => { throw new Error('Fixture startup configuration rejected') }), run = await test.builder.start(test.project); await terminalStartup(run, test.builder)
    expect(test.starting).toHaveBeenCalledTimes(1); expect(test.running).not.toHaveBeenCalled(); expect(run.status).toBe('failed')
    expect(run.events.filter(event => event.kind === 'startup-retry')).toHaveLength(0)
  })
  it('a failed handshake with unproved process cleanup does not spawn a retry', async () => {
    const test = await startupFixture(async () => { throw new AggregateError([initializedTimeout(), new Error('Fixture cleanup failed')], initializedTimeout().message) }), run = await test.builder.start(test.project); await terminalStartup(run, test.builder)
    expect(test.starting).toHaveBeenCalledTimes(1); expect(test.running).not.toHaveBeenCalled(); expect(run.status).toBe('failed')
    expect(run.events.filter(event => event.kind === 'startup-retry')).toHaveLength(0)
  })
  it('cancellation during failed-handshake cleanup waits for settlement and never retries or starts an agent', async () => {
    let release!: () => void
    const cleanup = new Promise<void>(done => { release = done }), test = await startupFixture(async () => { await cleanup; throw initializedTimeout() })
    try {
      const run = await test.builder.start(test.project); await vi.waitFor(() => expect(test.starting).toHaveBeenCalledTimes(1), { timeout: 5000 })
      let cancelled = false; const cancellation = test.builder.cancel(test.project.id).then(() => { cancelled = true })
      await Promise.resolve(); expect(cancelled).toBe(false); release(); await cancellation
      expect(run.status).toBe('cancelled'); expect(run.finishedAt).toBeTypeOf('string'); expect(test.starting).toHaveBeenCalledTimes(1); expect(test.running).not.toHaveBeenCalled()
    } finally { release(); await test.builder.cancel(test.project.id) }
  })
  it('a matching timeout reported after an agent turn starts is not a startup retry', async () => {
    const test = await startupFixture(async () => {}, initializedTimeout()), run = await test.builder.start(test.project); await terminalStartup(run, test.builder)
    expect(test.starting).toHaveBeenCalledTimes(1); expect(test.running).toHaveBeenCalledTimes(1); expect(run.status).toBe('failed')
    expect(run.events.filter(event => event.kind === 'startup-retry')).toHaveLength(0)
    expect(await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8')).toBe(test.original)
  })
  it('a handshake that resolves after cancellation cannot start the implementation turn', async () => {
    let release!: () => void
    const started = new Promise<void>(done => { release = done }), test = await startupFixture(async () => { await started })
    const run = await test.builder.start(test.project); await vi.waitFor(() => expect(test.starting).toHaveBeenCalledTimes(1), { timeout: 5000 })
    const cancelled = test.builder.cancel(test.project.id); release(); await cancelled
    expect(run.status).toBe('cancelled'); expect(test.running).not.toHaveBeenCalled(); expect(run.finishedAt).toBeTypeOf('string')
  })
})

describe('Terminal implementation outcome archives', () => {
  it('shutdown waits for the real final state write before allowing directory cleanup', async () => {
    const test = await startupFixture(async () => { throw new Error('Fixture startup rejected') })
    let release!: () => void, reached!: () => void
    const held = new Promise<void>(done => { release = done }), saving = new Promise<void>(done => { reached = done }), original = test.store.save.bind(test.store)
    vi.spyOn(test.store, 'save').mockImplementation(async () => { if (test.project.runs[0]?.finishedAt) { reached(); await held } await original() })
    const run = await test.builder.start(test.project)
    let closing: Promise<void> | undefined
    try {
      await saving; closing = test.builder.close()
      expect(await Promise.race([closing.then(() => 'closed'), new Promise<string>(done => setImmediate(() => done('pending')))])).toBe('pending')
      release(); await closing
      const persisted = JSON.parse(await readFile(join(test.root, 'state.json'), 'utf8')).projects.find((project: { id: string }) => project.id === test.project.id)
      expect(persisted.runs[0]).toMatchObject({ id: run.id, status: 'failed', finishedAt: run.finishedAt })
      expect(persisted.messages.some((message: { id: string }) => message.id === `delivery-${run.id}`)).toBe(true)
    } finally { release(); await closing; await test.builder.close() }
  })
  function archived(test: Awaited<ReturnType<typeof startupFixture>>, run: Awaited<ReturnType<Builder['start']>>, complete: number) {
    const message = test.project.messages.find(message => message.id === `delivery-${run.id}`)!
    expect(message).toBeDefined(); expect(test.project.archive.interview).toContain(`doda：${message.content}`); expect(test.project.archive.interview).toContain(message.time)
    expect(test.project.archive.interview.split(message.content)).toHaveLength(2); expect(test.project.archive.highlights).toContain(`完成了 ${complete} 轮实现。`)
  }
  it('a startup failure updates the outcome archive before another conversation or restart', async () => {
    const test = await startupFixture(async () => { throw initializedTimeout() }); test.builder.updateArchive(test.project)
    const run = await test.builder.start(test.project); await terminalStartup(run, test.builder); expect(run.status).toBe('failed'); archived(test, run, 0); await test.store.save()
    const saved = JSON.parse(await readFile(join(test.root, 'state.json'), 'utf8')); expect(saved.projects.find((project: { id: string }) => project.id === test.project.id).archive).toEqual(test.project.archive)
    expect(await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8')).toBe(test.original)
  })
  it('a failed agent turn records the actual failure reply exactly once and preserves native code', async () => {
    const test = await startupFixture(async () => {}, new Error('Fixture agent failure')); test.builder.updateArchive(test.project)
    const run = await test.builder.start(test.project); await terminalStartup(run, test.builder); expect(run.status).toBe('failed'); archived(test, run, 0)
    expect(await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8')).toBe(test.original)
  })
  it('a cancelled handshake has its stopped outcome in the archive before cancellation acknowledges', async () => {
    let release!: () => void
    const waiting = new Promise<void>(done => { release = done }), test = await startupFixture(async () => { await waiting; throw initializedTimeout() }); test.builder.updateArchive(test.project)
    try {
      const run = await test.builder.start(test.project); await vi.waitFor(() => expect(test.starting).toHaveBeenCalledTimes(1), { timeout: 5000 }); const cancellation = test.builder.cancel(test.project.id); release(); await cancellation
      expect(run.status).toBe('cancelled'); expect(run.finishedAt).toBeTypeOf('string'); archived(test, run, 0); expect(test.running).not.toHaveBeenCalled()
      const saved = JSON.parse(await readFile(join(test.root, 'state.json'), 'utf8')); expect(saved.projects.find((project: { id: string }) => project.id === test.project.id).archive).toEqual(test.project.archive)
    } finally { release(); await test.builder.cancel(test.project.id) }
  })
  it('a later failure retains the successful delivery count and both ordered outcome messages', async () => {
    let attempts = 0
    const test = await startupFixture(async () => { if (++attempts > 1) throw initializedTimeout() }), first = await test.builder.start(test.project); await terminalStartup(first, test.builder); expect(first.status).toBe('completed'); archived(test, first, 1)
    const previous = await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8'), failed = await test.builder.start(test.project); await terminalStartup(failed, test.builder); expect(failed.status).toBe('failed'); archived(test, first, 1); archived(test, failed, 1)
    const firstMessage = test.project.messages.find(message => message.id === `delivery-${first.id}`)!, failureMessage = test.project.messages.find(message => message.id === `delivery-${failed.id}`)!
    expect(test.project.archive.interview.indexOf(firstMessage.content)).toBeLessThan(test.project.archive.interview.indexOf(failureMessage.content)); expect(await readFile(join(test.store.files(test.project.id), 'pages/home/index.js'), 'utf8')).toBe(previous)
  })
})

import { describe, it, expect, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store, defaultDesigns } from '../server/store'
import type { Run } from '../server/contracts'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const temporary: string[] = []
async function interrupted() {
  const root = await fs.mkdtemp(join(tmpdir(), 'doda-recovery-')); temporary.push(root)
  const store = new Store(root); await store.load()
  const project = store.create('soft-blue')
  const run: Run = { id: randomUUID(), status: 'running', startedAt: '2026-10-07T00:00:00Z', events: [], snapshot: { id: randomUUID(), revision: 2, hash: 'frozen-requirements', time: '2026-10-07T00:00:00Z', design: defaultDesigns[0], brief: { title: '猫猫记录', audience: '我', purpose: '记录吃饭', features: ['记录投喂'], pages: ['首页'], acceptance: ['记录保留'], deferred: [], designId: 'soft-blue' } } }
  project.runs.unshift(run)
  const current = store.files(project.id), runRoot = join(root, 'projects', project.id, 'runs', run.id)
  await fs.mkdir(current, { recursive: true }); await fs.mkdir(runRoot, { recursive: true })
  await fs.writeFile(join(current, 'app.js'), 'old complete version')
  await store.save()
  return { root, store, project, run, current, runRoot, previous: join(runRoot, 'previous'), candidate: join(runRoot, 'candidate') }
}
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(fs.rename).mockReset().mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename)
  for (const path of temporary.splice(0)) {
    const delta = relative(resolve(tmpdir()), resolve(path))
    if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-recovery-')) throw new Error('INVALID_TEST_CLEANUP')
    await fs.rm(path, { recursive: true, force: true })
  }
})

describe('Interrupted mini program delivery recovery', () => {
  it('restores the last delivered files after an interrupted install', async () => {
    const fixture = await interrupted()
    await fs.rename(fixture.current, fixture.previous)
    const restored = new Store(fixture.root); await restored.load()
    await expect(fs.readFile(join(restored.files(fixture.project.id), 'app.js'), 'utf8')).resolves.toBe('old complete version')
    expect(restored.projects[0].runs[0].status).toBe('failed')
    expect(restored.projects[0].runs[0].snapshot.hash).toBe('frozen-requirements')
  })
  it('replaces partial installed files with the complete previous version', async () => {
    const fixture = await interrupted()
    await fs.rename(fixture.current, fixture.previous)
    await fs.mkdir(fixture.current); await fs.writeFile(join(fixture.current, 'app.js'), 'partial new version')
    const restored = new Store(fixture.root); await restored.load()
    await expect(fs.readFile(join(restored.files(fixture.project.id), 'app.js'), 'utf8')).resolves.toBe('old complete version')
    const displaced = (await fs.readdir(fixture.runRoot)).filter(name => name.startsWith('interrupted-'))
    expect(displaced).toHaveLength(1)
    await expect(fs.readFile(join(fixture.runRoot, displaced[0], 'app.js'), 'utf8')).resolves.toBe('partial new version')
  })
  it('reports interruption once in chat while preserving the frozen requirements', async () => {
    const fixture = await interrupted()
    const first = new Store(fixture.root); await first.load()
    const run = first.projects[0].runs[0]
    expect(run.status).toBe('failed')
    expect(run.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(run.events.some(event => event.kind === 'recovery')).toBe(true)
    const second = new Store(fixture.root); await second.load()
    expect(second.projects[0].runs[0].finishedAt).toBe(run.finishedAt)
    expect(second.projects[0].runs[0].snapshot.hash).toBe('frozen-requirements')
    const messages = second.projects[0].messages.filter(message => message.id === `delivery-${run.id}`)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain('上次退出')
  })
  it('keeps a completed delivery when its previous version still exists', async () => {
    const fixture = await interrupted()
    await fs.rename(fixture.current, fixture.previous)
    await fs.mkdir(fixture.current); await fs.writeFile(join(fixture.current, 'app.js'), 'new complete version')
    fixture.run.status = 'completed'; fixture.run.finishedAt = '2026-10-07T00:01:00Z'; await fixture.store.save()
    const restored = new Store(fixture.root); await restored.load()
    await expect(fs.readFile(join(restored.files(fixture.project.id), 'app.js'), 'utf8')).resolves.toBe('new complete version')
    expect(restored.projects[0].runs[0].status).toBe('completed')
    expect(restored.projects[0].messages).toHaveLength(1)
  })
  it('rejects an escaped recovery path before moving any files', async () => {
    const fixture = await interrupted()
    fixture.project.id = '../outside'; await fixture.store.save()
    const restored = new Store(fixture.root)
    await expect(restored.load()).rejects.toThrow('INVALID_DELIVERY_PATH')
    await expect(fs.readFile(join(fixture.current, 'app.js'), 'utf8')).resolves.toBe('old complete version')
  })
})

describe('Prepared mini program installation', () => {
  it('installs the complete candidate while retaining the previous version', async () => {
    const fixture = await interrupted()
    await fs.mkdir(fixture.candidate); await fs.writeFile(join(fixture.candidate, 'app.js'), 'new complete version'); await fs.writeFile(join(fixture.candidate, 'app.json'), '{"pages":["pages/home/index"]}')
    await fixture.store.deliver(fixture.project.id, fixture.run.id)
    await expect(fs.readFile(join(fixture.current, 'app.js'), 'utf8')).resolves.toBe('new complete version')
    await expect(fs.readFile(join(fixture.current, 'app.json'), 'utf8')).resolves.toBe('{"pages":["pages/home/index"]}')
    await expect(fs.readFile(join(fixture.previous, 'app.js'), 'utf8')).resolves.toBe('old complete version')
    await expect(fs.readFile(join(fixture.candidate, 'app.js'), 'utf8')).resolves.toBe('new complete version')
  })
  it('restores the previous version when the prepared directory cannot be installed', async () => {
    const fixture = await interrupted()
    await fs.mkdir(fixture.candidate); await fs.writeFile(join(fixture.candidate, 'app.js'), 'new complete version')
    const renameFile = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from) === join(fixture.runRoot, 'prepared') && String(to) === fixture.current) throw Object.assign(new Error('simulated install I/O failure'), { code: 'EIO' })
      return renameFile(from, to)
    })
    await expect(fixture.store.deliver(fixture.project.id, fixture.run.id)).rejects.toMatchObject({ code: 'EIO' })
    await expect(fs.readFile(join(fixture.current, 'app.js'), 'utf8')).resolves.toBe('old complete version')
    await expect(fs.stat(fixture.previous)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps current files when cancellation occurs after preparation', async () => {
    const fixture = await interrupted()
    await fs.mkdir(fixture.candidate); await fs.writeFile(join(fixture.candidate, 'app.js'), 'new complete version')
    await expect(fixture.store.deliver(fixture.project.id, fixture.run.id, () => { throw new Error('CANCELLED') })).rejects.toThrow('CANCELLED')
    await expect(fs.readFile(join(fixture.current, 'app.js'), 'utf8')).resolves.toBe('old complete version')
    await expect(fs.stat(fixture.previous)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(join(fixture.runRoot, 'prepared/app.js'), 'utf8')).resolves.toBe('new complete version')
  })
  it('rejects a missing candidate without moving the current version', async () => {
    const fixture = await interrupted()
    await expect(fixture.store.deliver(fixture.project.id, fixture.run.id)).rejects.toThrow('DELIVERY_FILES_MISSING')
    await expect(fs.readFile(join(fixture.current, 'app.js'), 'utf8')).resolves.toBe('old complete version')
  })
  it('rejects an existing backup without overwriting either version', async () => {
    const fixture = await interrupted()
    await fs.mkdir(fixture.candidate); await fs.writeFile(join(fixture.candidate, 'app.js'), 'new complete version')
    await fs.mkdir(fixture.previous); await fs.writeFile(join(fixture.previous, 'app.js'), 'earlier complete version')
    await expect(fixture.store.deliver(fixture.project.id, fixture.run.id)).rejects.toThrow('DELIVERY_ALREADY_PREPARED')
    await expect(fs.readFile(join(fixture.current, 'app.js'), 'utf8')).resolves.toBe('old complete version')
    await expect(fs.readFile(join(fixture.previous, 'app.js'), 'utf8')).resolves.toBe('earlier complete version')
  })
})

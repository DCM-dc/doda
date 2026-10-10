import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Store } from '../server/store'
import type { Project } from '../server/contracts'

let root = '', base = '', child: ChildProcess | undefined, closed: Promise<unknown>, source: Project, original: Project
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-design-reuse-')); const store = new Store(root); await store.load(); source = store.create('warm-paper'); source.name = '旧纸片'; source.brief = { title: '旧纸片', audience: '自己', purpose: '一行字', features: ['折叠'], pages: ['首页'], acceptance: ['不存储'], deferred: [], designId: 'warm-paper' }; source.revision = 1; await store.save()
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address(); if (!address || typeof address === 'string') throw new Error('UNIT_PORT_MISSING'); base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>(done => listener.close(() => done()))
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), env: { ...process.env, DODA_PRODUCTION: '1', DODA_DATA: root, DODA_PORT: String(address.port), DEEPSEEK_API_KEY: '', MIMO_API_KEY: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); closed = once(child, 'exit'); child.stdout?.resume(); let errors = ''; child.stderr?.on('data', bytes => { errors += String(bytes) })
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error('UNIT_BACKEND_CLOSED: ' + errors); expect((await fetch(base + '/health')).status).toBe(200) }, { timeout: 20000, interval: 100 }); original = (await (await fetch(base + '/state')).json()).projects.find((project: Project) => project.id === source.id)
}, 30000)
afterAll(async () => { if (child?.exitCode === null) child.kill(); if (closed) await closed; if (root) { const target = relative(resolve(tmpdir()), resolve(root)); if (isAbsolute(target) || target.startsWith('..') || !target.startsWith('doda-design-reuse-')) throw new Error('INVALID_UNIT_CLEANUP'); await rm(root, { recursive: true, force: true }) } })
async function create(designId: string, reuseProjectId = source.id) { const response = await fetch(base + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ designId, reuseProjectId }) }); return { response, project: await response.json() } }
async function assertOriginal() { const state = await (await fetch(base + '/state')).json(); expect(state.projects.find((project: Project) => project.id === source.id)).toEqual(original); return state }

describe('Selected design at the actual project-creation HTTP boundary', () => {
  it('uses mint even when the source project has a saved paper design', async () => {
    const { response, project } = await create('mint-garden'); expect(response.status).toBe(200); expect(project.designId).toBe('mint-garden'); expect(project.brief).toBeUndefined(); expect(project.revision).toBe(0); expect(project.runs).toEqual([]); expect(project.messages[0].content).toContain('薄荷'); expect(project.messages[0].content).not.toContain('旧纸片'); const design = JSON.parse(await readFile(join(root, 'projects', project.id, 'current', 'design-system.json'), 'utf8')); expect(design.id).toBe('mint-garden'); expect(design.tokens.accent).toBe('#36896b'); await assertOriginal()
  })
  it('uses blue even when the source project has a saved paper design', async () => {
    const { response, project } = await create('soft-blue'); expect(response.status).toBe(200); expect(project.designId).toBe('soft-blue'); expect(project.messages[0].content).toContain('晴空'); const design = JSON.parse(await readFile(join(root, 'projects', project.id, 'current', 'design-system.json'), 'utf8')); expect(design.id).toBe('soft-blue'); await assertOriginal()
  })
  it('reuses paper with accurate library wording when the explicit style is unchanged', async () => {
    const { response, project } = await create('warm-paper'); expect(response.status).toBe(200); expect(project.designId).toBe('warm-paper'); expect(project.messages[0].content).toContain('纸间'); await assertOriginal()
  })
  it('rejects a missing explicit style without falling back to the source style or adding a project', async () => {
    const before = await assertOriginal(), { response, project } = await create('missing-style'); expect(response.status).toBe(422); expect(project.error).toBe('DESIGN_NOT_FOUND'); const after = await assertOriginal(); expect(after.projects).toEqual(before.projects)
  })
  it('rejects a missing source project without creating the selected style', async () => {
    const before = await assertOriginal(), { response, project } = await create('mint-garden', 'missing-project'); expect(response.status).toBe(422); expect(project.error).toBe('PROJECT_NOT_FOUND'); const after = await assertOriginal(); expect(after.projects).toEqual(before.projects)
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { safePath, scaffold, validateMiniprogram } from '../server/miniprogram'
import { Store, defaultDesigns } from '../server/store'
import { Builder } from '../server/dsh'

const temporary: string[] = []
async function root() { const path = await mkdtemp(join(tmpdir(), 'doda-contract-')); temporary.push(path); return path }
afterEach(async () => { await Promise.all(temporary.splice(0).map(async path => { const delta = relative(resolve(tmpdir()), resolve(path)); if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-contract-')) throw new Error('INVALID_TEST_CLEANUP'); await rm(path, { recursive: true, force: true }) })) })

describe('WeChat mini program delivery contract', () => {
  it('creates a native project with a registered page and valid JavaScript', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    const report = await validateMiniprogram(path)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.files).toContain('pages/home/index.wxml')
    expect(report.files).toContain('pages/home/index.js')
    expect(report.files).not.toContain('index.html')
    expect(report.warnings).toEqual([])
    expect(report.compilation).toMatchObject({ engine: 'glass-easel', version: '1.2.1', templates: [{ path: '.design/native/components/doda-button/index.wxml' }, { path: '.design/native/components/doda-card/index.wxml' }, { path: '.design/native/components/doda-input/index.wxml' }, { path: 'pages/home/index.wxml' }], stylesheets: [{ path: '.design/native/components/doda-button/index.wxss' }, { path: '.design/native/components/doda-card/index.wxss' }, { path: '.design/native/components/doda-input/index.wxss' }, { path: '.design/native/theme.wxss' }, { path: 'app.wxss' }, { path: 'pages/home/index.wxss' }] })
  })
  it('rejects a missing page source instead of accepting a folder as a delivery', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    await rm(join(path, 'pages/home/index.wxml'))
    const report = await validateMiniprogram(path)
    expect(report.ok).toBe(false)
    expect(report.errors).toContain('缺少 pages/home/index.wxml')
  })
  it('rejects browser artifacts mixed into a native project', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    await writeFile(join(path, 'index.html'), '<html></html>')
    const report = await validateMiniprogram(path)
    expect(report.errors).toContain('index.html: 当前交付目标只接受原生微信小程序')
    expect(report.ok).toBe(false)
  })
  it('rejects invalid JavaScript before replacing the existing project', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    await writeFile(join(path, 'app.js'), 'App({broken: )')
    const report = await validateMiniprogram(path)
    expect(report.ok).toBe(false)
    expect(report.errors.some(error => error.startsWith('app.js:'))).toBe(true)
  })
  it('rejects an invalid WXML expression before delivering a candidate', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    await writeFile(join(path, 'pages/home/index.wxml'), '<view>{{ count + }}</view>')
    const report = await validateMiniprogram(path)
    expect(report.ok).toBe(false)
    expect(report.errors.some(error => error.startsWith('pages/home/index.wxml:') && error.includes('unexpected character'))).toBe(true)
  })
  it('rejects a missing imported WXML template', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    await writeFile(join(path, 'pages/home/index.wxml'), '<include src="./card.wxml"/>')
    const report = await validateMiniprogram(path)
    expect(report.ok).toBe(false)
    expect(report.errors).toContain('pages/home/index.wxml: 缺少依赖 pages/home/card.wxml')
  })
  it('rejects a missing external WXS script', async () => {
    const path = await root(); await scaffold(path, defaultDesigns[0], '')
    await writeFile(join(path, 'pages/home/index.wxml'), '<wxs module="tool" src="./tool.wxs"/><view>{{tool.format(count)}}</view>')
    const report = await validateMiniprogram(path)
    expect(report.ok).toBe(false)
    expect(report.errors).toContain('pages/home/index.wxml: 缺少依赖 pages/home/tool.wxs')
  })
  it('rejects traversal and absolute paths outside the candidate workspace', async () => {
    const path = await root()
    await expect(safePath(path, '../outside.js')).rejects.toThrow('PATH_OUTSIDE_PROJECT')
    await expect(safePath(path, 'C:\\outside.js')).rejects.toThrow('INVALID_PROJECT_PATH')
    await expect(safePath(path, 'node_modules/secret.json')).rejects.toThrow('INVALID_PROJECT_PATH')
  })
  it('restores interrupted jobs as failed while retaining their frozen requirements', async () => {
    const path = await root(); const store = new Store(path); await store.load(); const project = store.create('soft-blue')
    project.runs.push({ id: 'interrupted', status: 'running', startedAt: '2026-10-07T00:00:00Z', events: [], snapshot: { id: 'snapshot', revision: 2, hash: 'frozen-hash', time: '2026-10-07T00:00:00Z', design: defaultDesigns[0], brief: { title: '猫猫记录', audience: '我', purpose: '记录吃饭', features: ['增加记录'], pages: ['首页'], acceptance: ['增加后显示记录'], deferred: [], designId: 'soft-blue' } } })
    await store.save(); const restored = new Store(path); await restored.load()
    expect(restored.projects[0].runs[0].status).toBe('failed')
    expect(restored.projects[0].runs[0].snapshot.hash).toBe('frozen-hash')
  })
  it('does not silently run code without a DeepSeek credential', async () => {
    const path = await root(); const store = new Store(path); await store.load(); const project = store.create('soft-blue')
    project.brief = { title: '猫猫记录', audience: '我', purpose: '记录吃饭', features: ['增加记录'], pages: ['首页'], acceptance: ['增加后显示记录'], deferred: [], designId: 'soft-blue' }
    const builder = new Builder(store, () => '')
    await expect(builder.start(project)).rejects.toThrow('DeepSeek API key')
    expect(project.runs).toEqual([])
  })
  it('serializes overlapping preview saves and restores them after reload', async () => {
    const path = await root(); const store = new Store(path); await store.load(); const project = store.create('soft-blue')
    await mkdir(join(path, 'projects', project.id), { recursive: true }); await store.save()
    await Promise.all([store.savePreviewValue(project.id, 'items', ['散步']), store.savePreviewValue(project.id, 'count', 4), store.savePreviewValue(project.id, 'items', ['散步', '读书'])])
    await store.flushPreview(); const restored = new Store(path); await restored.load()
    expect(await restored.previewStorage(project.id)).toEqual({ items: ['散步', '读书'], count: 4 })
  })
  it('serializes a single-key removal between overlapping saves and persists other null values', async () => {
    const path = await root(); const store = new Store(path); await store.load(); const project = store.create('soft-blue')
    await mkdir(join(path, 'projects', project.id), { recursive: true }); await store.save()
    await Promise.all([store.savePreviewValue(project.id, 'items', ['散步']), store.savePreviewValue(project.id, 'other', null), store.savePreviewValue(project.id, 'items', undefined)])
    await store.flushPreview(); const restored = new Store(path); await restored.load(); expect(await restored.previewStorage(project.id)).toEqual({ other: null })
    await restored.savePreviewValue(project.id, 'items', undefined); expect(await restored.previewStorage(project.id)).toEqual({ other: null })
  })
  it('rejects an oversized preview save while keeping previously saved data', async () => {
    const path = await root(); const store = new Store(path); await store.load(); const project = store.create('soft-blue')
    await mkdir(join(path, 'projects', project.id), { recursive: true })
    await store.savePreviewValue(project.id, 'count', 3)
    await expect(store.savePreviewValue(project.id, 'large', 'x'.repeat(70000))).rejects.toThrow('存储上限')
    expect(await store.previewStorage(project.id)).toEqual({ count: 3 })
    await store.savePreviewValue(project.id, 'count', 4)
    expect(await store.previewStorage(project.id)).toEqual({ count: 4 })
  })
})

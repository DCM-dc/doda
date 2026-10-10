import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Store } from '../server/store'
import { scaffold } from '../server/miniprogram'
import type { Brief, Project, Run } from '../server/contracts'

type ExportCase = { name: string; title: string; expected: string; completed?: string[]; failed?: string }
const cases: ExportCase[] = [
  { name: '中文作品名称可以在下载后认出', title: '等车小云', expected: 'doda-等车小云.zip' },
  { name: '英文名称保留正常空格', title: 'Cloud Play', expected: 'doda-Cloud Play.zip' },
  { name: 'Windows 禁用字符不会进入文件名', title: 'a/b\\c:demo?*|"<>', expected: 'doda-a-b-c-demo.zip' },
  { name: '清理后空的名字使用作品作为兜底', title: '<>:"/\\|?*\u0000\u001f', expected: 'doda-作品.zip' },
  { name: '空格和点组成的名称仍有可用文件名', title: ' .--. ', expected: 'doda-作品.zip' },
  { name: '换行和回车不能成为下载头中的控制字符', title: '云\r\n小云', expected: 'doda-云-小云.zip' },
  { name: '名称两侧空格和尾部点被清理', title: '  等车小云...  ', expected: 'doda-等车小云.zip' },
  { name: '表情和中文按 UTF8 完整保留', title: '小云☁️🌈', expected: 'doda-小云☁️🌈.zip' },
  { name: '固定前缀避免 Windows 设备保留名称', title: 'CON', expected: 'doda-CON.zip' },
  { name: '连续分隔符合并成一个', title: '风--轻--云', expected: 'doda-风-轻-云.zip' },
  { name: '尚未实现的新卡名称不冒充当前交付', title: '尚未交付的新名', completed: ['已经交付的小云'], expected: 'doda-已经交付的小云.zip' },
  { name: '最新失败任务之后仍使用成功作品名称', title: '新需求名', failed: '失败的新名', completed: ['上一版小云'], expected: 'doda-上一版小云.zip' },
  { name: '多个成功交付使用最近一次的名称', title: '新的需求名', completed: ['第二版小云', '第一版小云'], expected: 'doda-第二版小云.zip' },
  { name: '接近长度上限的 Unicode 不会截断代理对', title: '🌥️'.repeat(26), expected: 'doda-' + '🌥️'.repeat(26) + '.zip' },
]
let root = '', base = '', child: ChildProcess | undefined, exited: Promise<unknown>, prepared: { project: Project; app: string }[] = [], bootState: unknown

function brief(title: string): Brief { return { title, audience: '受控下载名称样本', purpose: '检查导出头和原有文件不变', features: ['显示云'], pages: ['主页'], acceptance: ['仅下载已有源码'], deferred: [], designId: 'soft-blue' } }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doda-export-name-'))
  const store = new Store(root); await store.load()
  for (const [index, item] of cases.entries()) {
    const project = store.create('soft-blue'); project.name = item.title; project.brief = brief(item.title); project.revision = 1
    function run(title: string, status: Run['status'], revision: number): Run { return { id: `export-fixture-${index}-${revision}`, status, snapshot: { id: `snapshot-${index}-${revision}`, revision, hash: 'controlled-export-metadata-fixture', brief: brief(title), design: structuredClone(store.design('soft-blue')), time: project.createdAt }, startedAt: project.createdAt, finishedAt: project.createdAt, events: [] } }
    project.runs = [...(item.failed ? [run(item.failed, 'failed', 9)] : []), ...(item.completed || []).map((title, revision) => run(title, 'completed', 2 - revision))]
    await scaffold(store.files(project.id), store.design(project.designId), '')
    prepared.push({ project: structuredClone(project), app: await readFile(join(store.files(project.id), 'app.json'), 'utf8') })
  }
  await store.save()
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('FIXTURE_PORT_MISSING')
  base = `http://127.0.0.1:${address.port}/api`; await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()))
  const env = { ...process.env, DODA_PRODUCTION: '1', DODA_DATA: root, DODA_PORT: String(address.port), DEEPSEEK_API_KEY: '', MIMO_API_KEY: '' }
  const inheritedModulePath = Object.entries(env).find(([name]) => name.toLowerCase() === 'psmodulepath')?.[1]
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'psmodulepath') delete env[name as keyof typeof env]
  if (inheritedModulePath) Object.assign(env, { PSMODULEPATH: inheritedModulePath })
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let bootError = ''; child.stdout?.resume(); child.stderr?.on('data', chunk => { bootError += String(chunk) }); exited = once(child, 'exit')
  await vi.waitFor(async () => { if (child?.exitCode !== null) throw new Error(`FIXTURE_BOOT_FAILED: ${bootError}`); expect((await fetch(base + '/health')).status).toBe(200) }, { timeout: 20000, interval: 100 })
  const loaded = await (await fetch(base + '/state')).json(); bootState = loaded
  for (const { project } of prepared) { const saved = loaded.projects.find((entry: Project) => entry.id === project.id); expect(saved.name).toBe(project.name); expect(saved.brief).toEqual(project.brief); expect(saved.runs).toEqual(project.runs) }
}, 30000)

afterAll(async () => {
  if (child?.exitCode === null) child.kill()
  if (exited) await exited
  if (!root) return
  const delta = relative(resolve(tmpdir()), resolve(root))
  if (isAbsolute(delta) || delta.startsWith('..') || !delta.startsWith('doda-export-name-')) throw new Error('INVALID_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
})

describe('真实导出 HTTP 返回可识别的当前作品文件名', () => {
  it.each(cases.map((item, index) => ({ ...item, index })))('$name', async item => {
    const { project, app } = prepared[item.index], before = await (await fetch(base + '/state')).json(), response = await fetch(`${base}/projects/${project.id}/export`), bytes = Buffer.from(await response.arrayBuffer()), header = response.headers.get('content-disposition') || '', utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1], filename = utf8 ? decodeURIComponent(utf8) : header.match(/filename="([^"]+)"/)?.[1]
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('application/zip'); expect(bytes.subarray(0, 2).toString()).toBe('PK'); expect(bytes.includes(Buffer.from('app.json'))).toBe(true); expect(header.startsWith('attachment;')).toBe(true); expect(filename).toBe(item.expected); expect(filename).not.toMatch(/[<>:"/\\|?*\u0000-\u001f\u007f]/); expect(filename?.endsWith('.zip')).toBe(true)
    expect(await readFile(join(root, 'projects', project.id, 'current', 'app.json'), 'utf8')).toBe(app); expect(before).toEqual(bootState); expect(await (await fetch(base + '/state')).json()).toEqual(before)
  }, 30000)
})

import { mkdir, readFile, writeFile, rename, cp, lstat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project, DesignSystem, Settings } from './contracts'
import { safePath } from './miniprogram'

const openDesigns:DesignSystem[]=JSON.parse(await readFile(new URL('./designs/catalog.json',import.meta.url),'utf8'))

async function directoryExists(path: string) {
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('INVALID_DELIVERY_DIRECTORY')
    return true
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

export const defaultDesigns: DesignSystem[] = [
  { id: 'soft-blue', name: '晴空', description: '清透的蓝色，轻快又清楚', version: 1, source: 'doda 原创；包组织参考 nexu-io/open-design（Apache-2.0）', tokens: { background: '#f6f8fc', surface: '#ffffff', text: '#202b3c', muted: '#6d7b91', accent: '#4d6bfe', radius: 18 } },
  { id: 'warm-paper', name: '纸间', description: '温暖的纸色，安静而有趣', version: 1, source: 'doda 原创；包组织参考 nexu-io/open-design（Apache-2.0）', tokens: { background: '#f6f2eb', surface: '#fffdf8', text: '#37332e', muted: '#857d72', accent: '#b66b44', radius: 14 } },
  { id: 'mint-garden', name: '薄荷', description: '柔和的绿色，让点子发芽', version: 1, source: 'doda 原创；包组织参考 nexu-io/open-design（Apache-2.0）', tokens: { background: '#f0f6f2', surface: '#ffffff', text: '#263d32', muted: '#6a8376', accent: '#36896b', radius: 22 } },
]

export class Store {
  projects: Project[] = []
  designs = structuredClone(defaultDesigns)
  settings: Settings = { model: 'deepseek-flash', voice: '苏打', speak: false, talkLevel: 'standard', devtoolsPath: '', appId: '', uploadKeyPath: '' }
  private pending: Promise<void> = Promise.resolve()
  private previewPending = new Map<string, Promise<void>>()
  constructor(readonly root: string) {}
  async load() {
    await mkdir(this.root, { recursive: true })
    try {
      const data = JSON.parse(await readFile(join(this.root, 'state.json'), 'utf8'))
      this.projects = data.projects; this.designs = data.designs; this.settings = { ...this.settings, ...data.settings }
      for (const project of this.projects) for (const run of project.runs) {
        const pending = run.status === 'running'
        if (!pending && (run !== project.runs[0] || run.status === 'completed')) continue
        const paths = await this.deliveryPaths(project.id, run.id)
        const recoverFiles = await directoryExists(paths.previous)
        if (recoverFiles) {
          if (await directoryExists(paths.current)) await rename(paths.current, paths.interrupted)
          await rename(paths.previous, paths.current)
        }
        if (!pending && !recoverFiles) continue
        const time = new Date().toISOString()
        if (pending) run.status = 'failed'
        run.error = '应用上次退出时执行未结束。需求快照和记录已保留，可以重新交给编程伙伴。' + (recoverFiles ? '原作品已恢复。' : '')
        run.finishedAt ||= time
        run.events.push({ time, kind: 'recovery', text: recoverFiles ? '应用重启后恢复了交付前的完整作品。' : '应用重启后将未结束任务标记为中断。' })
        if (run.events.length > 200) run.events.shift()
        if (!project.messages.some(message => message.id === `delivery-${run.id}`)) project.messages.push({ id: `delivery-${run.id}`, role: 'assistant', content: '上次退出时，这一轮没有完成。原作品与本轮需求都保留了，可以继续聊，也可以重新交给编程伙伴。', time })
        project.updatedAt = time
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    for(const design of openDesigns){
      const existing=this.designs.find(item=>item.id===design.id)
      if(!existing)this.designs.push(structuredClone(design))
      else if(existing.package&&existing.version<design.version&&existing.package.revision===design.package?.revision&&Object.entries(existing.package.files).every(([path,content])=>design.package?.files[path]===content)){existing.package=structuredClone(design.package);existing.version=design.version;existing.tokens=structuredClone(design.tokens)}
    }
    for(const saved of this.designs){const source=openDesigns.find(item=>item.package?.id===saved.package?.id&&item.package?.revision===saved.package?.revision);if(saved.package&&source?.package&&Object.keys(saved.package.files).length<Object.keys(source.package.files).length&&Object.entries(saved.package.files).every(([path,content])=>source.package!.files[path]===content))saved.package=structuredClone(source.package)}
    await this.save()
  }
  async save() {
    const data = JSON.stringify({ projects: this.projects, designs: this.designs, settings: this.settings }, null, 2)
    this.pending = this.pending.catch(() => {}).then(async () => { const tmp = join(this.root, 'state.tmp'); await writeFile(tmp, data, 'utf8'); await rename(tmp, join(this.root, 'state.json')) })
    return this.pending
  }
  project(id: string) { const project = this.projects.find(p => p.id === id); if (!project) throw new Error('PROJECT_NOT_FOUND'); return project }
  design(id: string) { const design = this.designs.find(d => d.id === id); if (!design) throw new Error('DESIGN_NOT_FOUND'); return design }
  files(id: string) { this.project(id); return join(this.root, 'projects', id, 'current') }
  collaborationContext(id:string) {
    const project=this.project(id),run=project.runs[0]
    if(!run)return null
    const stage=[...run.events].reverse().find(event=>['started','startup-retry','validation','repair','visual','visual-repair','checked','completed','failed','cancelled','recovery'].includes(event.kind))
    return {runId:run.id,status:run.status,stage:stage?.kind||'preparing',revision:run.snapshot.revision,brief:run.snapshot.brief,designId:run.snapshot.design.id,hasCandidateImage:Boolean(run.visual),changedFiles:run.status==='completed'?run.diff?.map(file=>file.path).filter(path=>!path.startsWith('.design/')&&path!=='design-system.json'):[],issue:run.status==='failed'?run.error:undefined}
  }
  async deliveredContext(id: string) {
    const run = this.project(id).runs.find(item => item.status === 'completed')
    if (!run) return null
    const summary = [...run.events].reverse().find(event => event.kind === 'completed')?.text || ''
    const knowledge = { runId: run.id, revision: run.snapshot.revision, hash: run.snapshot.hash, brief: structuredClone(run.snapshot.brief), summary: summary.slice(0, 4000), summaryTruncated: summary.length > 4000, files: [] as { path: string; content: string; truncated: boolean }[], sourceIncomplete: true }
    const { candidate } = await this.deliveryPaths(id, run.id)
    if (!await directoryExists(candidate)) return knowledge
    let appSource: string, pageDirectories: string[]
    try {
      appSource = await readFile(await safePath(candidate, 'app.json'), 'utf8')
      const pages = JSON.parse(appSource).pages
      if (!Array.isArray(pages) || !pages.every(page => typeof page === 'string')) return knowledge
      pageDirectories = pages.map(page => dirname(page).replaceAll('\\', '/') + '/')
    } catch { return knowledge }
    const paths = (run.files || []).filter(path => (path === 'app.json' || /\.(js|wxml|wxs|wxss)$/.test(path)) && (!path.startsWith('pages/') || pageDirectories.some(directory => path.startsWith(directory))))
    function priority(path: string) { return path === 'app.json' ? 0 : path.endsWith('.js') ? (path.includes('/') ? 2 : 1) : path.endsWith('.wxss') ? 4 : 3 }
    paths.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))
    knowledge.sourceIncomplete = !paths.includes('app.json') || paths.length > 16
    let remaining = 24000
    for (const path of paths.slice(0, 16)) {
      if (!remaining) { knowledge.sourceIncomplete = true; break }
      try {
        const source = path === 'app.json' ? appSource : await readFile(await safePath(candidate, path), 'utf8')
        const content = source.slice(0, Math.min(12000, remaining)), truncated = content.length < source.length
        knowledge.files.push({ path, content, truncated }); remaining -= content.length
        knowledge.sourceIncomplete ||= truncated
      } catch { knowledge.sourceIncomplete = true }
    }
    return knowledge
  }
  private async deliveryPaths(id: string, runId: string) {
    if (![id, runId].every(value => /^[a-zA-Z0-9_-]{1,128}$/.test(value))) throw new Error('INVALID_DELIVERY_PATH')
    this.project(id)
    const root = join('projects', id, 'runs', runId)
    return { current: await safePath(this.root, join('projects', id, 'current')), candidate: await safePath(this.root, join(root, 'candidate')), previous: await safePath(this.root, join(root, 'previous')), prepared: await safePath(this.root, join(root, 'prepared')), interrupted: await safePath(this.root, join(root, `interrupted-${randomUUID()}`)) }
  }
  async deliver(id: string, runId: string, ensureActive?: () => void) {
    const paths = await this.deliveryPaths(id, runId)
    if (!await directoryExists(paths.current) || !await directoryExists(paths.candidate)) throw new Error('DELIVERY_FILES_MISSING')
    if (await directoryExists(paths.previous) || await directoryExists(paths.prepared)) throw new Error('DELIVERY_ALREADY_PREPARED')
    await cp(paths.candidate, paths.prepared, { recursive: true, force: false, errorOnExist: true })
    ensureActive?.()
    await rename(paths.current, paths.previous)
    try { await rename(paths.prepared, paths.current) }
    catch (error) {
      if (await directoryExists(paths.current)) await rename(paths.current, paths.interrupted)
      await rename(paths.previous, paths.current)
      throw error
    }
  }
  async previewStorage(id: string): Promise<Record<string, unknown>> {
    this.project(id)
    try { return JSON.parse(await readFile(join(this.root, 'projects', id, 'preview-storage.json'), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }
  async savePreviewValue(id: string, key: string, value: unknown) {
    this.project(id)
    const pending = this.previewPending.get(id) || Promise.resolve()
    const write = pending.catch(() => {}).then(async () => {
      const storage = { ...await this.previewStorage(id), [key]: value }
      const data = JSON.stringify(storage)
      if (data.length > 65536) throw new Error('预览数据超过本机存储上限。')
      const path = join(this.root, 'projects', id, 'preview-storage.json')
      await writeFile(path + '.tmp', data, 'utf8'); await rename(path + '.tmp', path)
    })
    this.previewPending.set(id, write)
    try { await write } finally { if (this.previewPending.get(id) === write) this.previewPending.delete(id) }
  }
  async flushPreview() { await Promise.all([...this.previewPending.values()]) }
  create(designId: string) {
    this.design(designId)
    const time = new Date().toISOString()
    const project: Project = { id: randomUUID(), name: '新的小点子', createdAt: time, updatedAt: time, phase: 'explore', revision: 0, designId, messages: [{ id: randomUUID(), role: 'assistant', content: '你好呀。你想做一个什么样的微信小程序？我们先聊清楚，再一起把它做出来。', time }], runs: [], inspirations: [], archive: { highlights: '', interview: '' } }
    this.projects.unshift(project)
    return project
  }
}

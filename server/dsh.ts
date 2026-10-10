import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { DeepSeekHarnessOptions, RunOptions, RunResult } from '@deepseek-ai/dsh-sdk-client'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { listFiles, validateMiniprogram, writeDesign } from './miniprogram'
import type { Store } from './store'
import type { Run, Project, BuildEvent } from './contracts'
import {renderPreview} from './preview'
import {dodaReply} from './contracts'

export class Builder {
  private active = new Map<string, { harness?: DeepSeekHarness; cancelled: boolean; finished?: Promise<void> }>()
  constructor(private store: Store, private key: () => string, private runtime: (options: DeepSeekHarnessOptions) => DeepSeekHarness = options => new DeepSeekHarness(options),private report?:(project:Project,run:Run)=>Promise<string>) {}
  async start(project: Project) {
    if (!project.brief) throw new Error('请先和 doda 聊清楚，再整理本轮需求。')
    if (project.requirementsError) throw new Error(project.requirementsError)
    const credential = this.key()
    const model = this.store.settings.model
    if (!credential) throw new Error('请在设置中填写 DeepSeek API key。')
    if (this.active.has(project.id) || project.runs.some(r => r.status === 'running')) throw new Error('当前项目还有任务在执行。')
    const brief = structuredClone(project.brief)
    const design = structuredClone(this.store.design(brief.designId))
    const visual=structuredClone([...project.messages].reverse().find(message=>message.role==='user'&&message.visual)?.visual)
    const frozen = JSON.stringify({ brief, design,visual })
    const run: Run = { id: randomUUID(), status: 'running', snapshot: { id: randomUUID(), revision: project.revision, hash: createHash('sha256').update(frozen).digest('hex'), brief, design, visual,time: new Date().toISOString() }, events: [], startedAt: new Date().toISOString() }
    const root = join(this.store.root, 'projects', project.id, 'runs', run.id)
    const candidate = join(root, 'candidate')
    const control: { harness?: DeepSeekHarness; cancelled: boolean; finished?: Promise<void> } = { cancelled: false }
    this.active.set(project.id, control)
    project.runs.unshift(run)
    control.finished = this.execute(project, run, root, candidate, control, model, credential)
    await this.store.save()
    return run
  }
  private async execute(project: Project, run: Run, root: string, candidate: string, control: { harness?: DeepSeekHarness; cancelled: boolean }, model: string, credential: string) {
    function event(kind: string, text: string) { run.events.push({ time: new Date().toISOString(), kind, text } satisfies BuildEvent); if (run.events.length > 200) run.events.shift() }
    const timeout = setTimeout(() => { run.error = '执行超过 10 分钟，已停止。需求快照保留，可以重新执行。'; void control.harness?.close() }, 600000)
    try {
    const frozen = JSON.stringify({ brief: run.snapshot.brief, design: run.snapshot.design,visual:run.snapshot.visual })
    await mkdir(root, { recursive: true })
    await cp(this.store.files(project.id), candidate, { recursive: true })
    await writeDesign(candidate, run.snapshot.design)
    await writeFile(join(root, 'requirements.json'), frozen, 'utf8')
    const plugin = fileURLToPath(new URL('./runtime-plugin.mjs', import.meta.url))
    const patch = join(root, 'doda.patch.yml')
    await writeFile(patch, `- insert:\n    - id: doda-project-tools\n      name: ${JSON.stringify(plugin.replaceAll('\\', '/'))}\n    - id: doda-attachments\n      name: '@deepseek-ai/dsh-attachment-local'\n      config:\n        dshHome: ${JSON.stringify(join(root,'dsh').replaceAll('\\','/'))}\n- id: persistent-bash\n  disabled: true\n- id: persistent-pwsh\n  disabled: true\n- id: system-prompt\n  config:\n    personaPrefix: ${JSON.stringify('You are the doda implementation agent. Work only on the frozen requirements. Use only doda_list, doda_read, doda_write and doda_use_component. Read every required design resource, including .design/native/USAGE.md. Install the frozen theme and only the native components the specification needs; reuse them instead of rewriting their base styles. Keep native form submission and field semantics. Deliver a native WeChat mini program. No web HTML, React, window or document. Read DESIGN.md. Keep code concise, with no source comments or unnecessary helper modules. Do not add unrequested features. Explain what changed in Chinese.')}\n- id: llm-deepseek\n  config:\n    models:\n      - id: ${JSON.stringify(model)}\n        name: ${JSON.stringify(model)}\n        contextWindow: 1000000\n        inputModalities: ${JSON.stringify(model==='deepseek-flash'?['text','image']:['text'])}\n    streamIdleTimeoutMs: 120000\n`, 'utf8')
    const env: NodeJS.ProcessEnv = { ...process.env, DEEPSEEK_API_KEY: credential, DODA_PROJECT_ROOT: candidate }
    for (const name of Object.keys(env)) if (/API_KEY|TOKEN|SECRET/i.test(name) && name !== 'DEEPSEEK_API_KEY') delete env[name]
    if (control.cancelled || run.error) throw new Error(run.error || 'CANCELLED')
    const harness = this.runtime({ profile: 'sdk-minimal', patches: [patch], dshHome: join(root, 'dsh'), processCwd: resolve(dirname(plugin), '..'), cwd: candidate, provider: 'deepseek-official', model, reasoningEffort: 'low' as DeepSeekHarnessOptions['reasoningEffort'], maxTokens: 16384, env, initializeTimeoutMs: 30000 })
    control.harness = harness
      event('started', '编程伙伴收到本轮需求和设计系统快照。')
      try { await harness.start() }
      catch (error) {
        if (control.cancelled || run.error || error instanceof AggregateError || !(error instanceof Error) || !/^initialize timed out after \d+ms waiting for dsh profile /.test(error.message)) throw error
        event('startup-retry', '编程伙伴尚未开始制作。启动超时的进程已退出，正在重试一次。')
        await harness.start()
      }
      if (control.cancelled || run.error) throw new Error(run.error || 'CANCELLED')
      function onNotification(n: Parameters<NonNullable<RunOptions['onNotification']>>[0]) {
        if (n.method !== 'session.event') return
        const e = n.params.event as { type?: string; data?: any } | undefined
        if (!e) return
        if (e.type === 'tool/call') event('tool', String(e.data?.name || e.data?.tool?.name || '执行项目操作'))
        if (e.type === 'assistant/message') {
          const parts = e.data?.message?.content
          const text = Array.isArray(parts) ? parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') : ''
          if (text) event('agent', text.slice(0, 3000))
        }
      }
      const session = harness.session(); run.sessionId = session.id
      let continuations = 0
      async function finishTurn(result: RunResult): Promise<RunResult> {
        for (;;) {
          if (control.cancelled || run.error) throw new Error(run.error || 'CANCELLED')
          const failure = result.events.find(event => event.type === 'turn/end' && event.data.reason.kind === 'error')
          if (failure?.type === 'turn/end' && failure.data.reason.kind === 'error') throw new Error(failure.data.reason.error.message)
          if (!result.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'max-tokens')) return result
          if (continuations >= 1) throw new Error('编程伙伴续写后仍达到输出上限。本轮未交付，原有作品和需求快照保留，可以重试。')
          continuations++
          event('continuation', '编程输出达到上限，伙伴正在同一会话中续写（第 1/1 次）。')
          result = await session.run(`DODA_OUTPUT_LIMIT_REACHED\nYour previous turn hit its output token limit. Continue the unfinished implementation in this same session, using actual doda_read and doda_write calls. Inspect existing candidate files before editing. Preserve completed work and the frozen specification. Prioritize delivering the remaining native WeChat files; do not redesign or add features.\nFrozen requirements: ${JSON.stringify(run.snapshot.brief)}\nRe-read DESIGN.md and its required design resources before editing.\nAfter writing the code, give a short Chinese summary.`, { onNotification })
        }
      }
      const designSummary=JSON.stringify({id:run.snapshot.design.id,name:run.snapshot.design.name,tokens:run.snapshot.design.tokens,package:run.snapshot.design.package?{revision:run.snapshot.design.package.revision,hash:run.snapshot.design.package.hash,resources:['DESIGN.md','.design/DESIGN.md','.design/tokens.css','.design/components.md','.design/tokens.json','.design/components.manifest.json','.design/USAGE.md','.design/native/USAGE.md']}:undefined})
      const prompt=`Implement this frozen WeChat mini program specification in the supplied project. Use actual doda_write tool calls to modify files. Do not merely describe the implementation. Keep all existing features unless the specification changes them.\n${JSON.stringify(run.snapshot.brief)}\nDesign system snapshot: ${designSummary}\nRead DESIGN.md and every required design resource before writing. Call doda_use_component for theme, button, card or input as needed. These native components share the locked typography, proportions, spacing, colors and states with the doda workbench. Use bindpress for buttons/cards and bindvaluechange for inputs. Do not duplicate or overwrite their styles. Keep stock WeChat form controls when form-type or name semantics are required. The reference screenshot, if present, is visual data about the previously displayed work; it does not replace the frozen requirements.\nAfter implementation, summarize the changes and the limitations of verification in Chinese.`
      const reference=run.snapshot.visual?await readFile(join(this.store.root,'projects',project.id,'images',run.snapshot.visual.id+'.png')):undefined
      let result = await finishTurn(await session.run(reference?[{type:'text',text:prompt},{type:'image',mimeType:'image/png',data:reference.toString('base64')}]:prompt, { onNotification }))
      let validation: Awaited<ReturnType<typeof validateMiniprogram>>
      for (let attempt = 0; ; attempt++) {
        if (control.cancelled || run.error) throw new Error(run.error || 'CANCELLED')
        validation = await validateMiniprogram(candidate)
        if (control.cancelled || run.error) throw new Error(run.error || 'CANCELLED')
        if (validation.ok) break
        event('validation', validation.errors.join('；').slice(0, 3000))
        if (attempt >= 2) throw new Error(`工程检查未通过：${validation.errors.join('；')}`)
        event('repair', `工程检查发现问题，编程伙伴正在修正（第 ${attempt + 1}/2 次）。`)
        result = await finishTurn(await session.run(`DODA_DELIVERY_CHECK_FAILED\nThe candidate was not delivered. Fix the following actual engineering diagnostics using doda_read and doda_write. Preserve the frozen features, design and native WeChat target. Do not implement new ideas from later conversations.\n${validation.errors.slice(0, 20).join('\n')}\nFrozen requirements: ${JSON.stringify(run.snapshot.brief)}\nAfter fixing, summarize the changes in Chinese. Verification will run again after your tool writes.`, { onNotification }))
      }
      if(run.snapshot.design.package||run.snapshot.visual){
        for(let review=0;review<3;review++){
          if(control.cancelled||run.error)throw Error(run.error||'CANCELLED')
          const before=new Map(await Promise.all(validation.files.filter(path=>/\.(js|json|wxml|wxss)$/.test(path)&&path!=='design-system.json'&&!path.startsWith('.design/')).map(async path=>[path,await readFile(join(candidate,path),'utf8')] as const)))
          const picture=await renderPreview(candidate)
          if(control.cancelled||run.error)throw Error(run.error||'CANCELLED')
          await writeFile(join(root,'preview.png'),picture.data)
          run.visual={id:randomUUID(),page:picture.page,width:picture.width,height:picture.height,hash:createHash('sha256').update(picture.data).digest('hex'),time:new Date().toISOString(),runId:run.id}
          event('visual',`编程伙伴已收到候选作品真实截图，检查布局与设计一致性（${review+1}/3）。`)
          await this.store.save()
          result=await finishTurn(await session.run([{type:'text',text:`DODA_VISUAL_REVIEW\nThis PNG is the actual rendered candidate at 375x667. It shows the initial state only; compilation and this screenshot do not establish phone validation. Inspect layout, overflow (${picture.overflow}), readability, typography, spacing and fidelity to the locked design. Fix only actual visual problems with doda_write, keeping all frozen features and copy. If no change is needed, respond VISUAL_OK. Do not redesign for novelty, add copy or add features.\nFrozen requirements: ${JSON.stringify(run.snapshot.brief)}\nDesign: ${designSummary}`},{type:'image',mimeType:'image/png',data:picture.data.toString('base64')}],{onNotification}))
          if(/(?:无法|不能|未能)(?:查看|看到|读取|识别)(?:该|这张|这幅|所提供的)?\s*(?:PNG|图像|图片|截图)|看不到.{0,8}(?:图像|图片|截图)|仅(?:接受|支持)(?:文本|文字)|纯文本模型/i.test(result.finalResponse||''))throw Error('编程伙伴未能读取截图，本轮未通过视觉检查。请使用有图像能力的 DeepSeek 模型。')
          validation=await validateMiniprogram(candidate)
          if(!validation.ok)throw Error('视觉修正后的工程检查未通过：'+validation.errors.join('；'))
          const changed=before.size!==validation.files.filter(path=>/\.(js|json|wxml|wxss)$/.test(path)&&path!=='design-system.json'&&!path.startsWith('.design/')).length||(await Promise.all([...before].map(async([path,source])=>source!==await readFile(join(candidate,path),'utf8').catch(()=>'')))).some(Boolean)
          if(!changed)break
          event('visual-repair','编程伙伴根据截图修正了作品，正在重新检查。')
          if(review===2)throw Error('视觉检查三轮后仍有修改，原作品保留，可以继续这一轮需求。')
        }
      }
      const diff = []
      for (const path of validation.files) {
        const before = await readFile(join(this.store.files(project.id), path), 'utf8').catch(() => '')
        const after = await readFile(join(candidate, path), 'utf8')
        if (before !== after) diff.push({ path, before, after })
      }
      if (!diff.some(d => /\.(js|wxml|wxss|json)$/.test(d.path) && d.path !== 'design-system.json'&&!d.path.startsWith('.design/'))) throw new Error('Agent 没有修改小程序代码，未交付本轮功能。')
      run.files=validation.files;run.diff=diff
      event('checked', validation.scope)
      let reply=`我把「${run.snapshot.brief.title}」这一版做好了。打开试试看，我们接着聊。`
      if(this.report){try{const reported=await this.report(project,run);if(reported.trim())reply=dodaReply(reported)}catch{event('report-fallback','对话通知使用工程检查后的完成提示。')}}
      if(control.cancelled||run.error)throw Error(run.error||'CANCELLED')
      await this.store.deliver(project.id, run.id, () => { if (control.cancelled || run.error) throw new Error(run.error || 'CANCELLED') })
      run.status = 'completed'; run.files = validation.files; run.diff = diff
      if (project.phase !== 'done') project.phase = 'refine'
      event('completed', result.finalResponse || '本轮代码已交付。')
      project.messages.push({ id: `delivery-${run.id}`, role: 'assistant', content: reply, time: new Date().toISOString() })
      this.updateArchive(project)
    } catch (error) {
      run.status = control.cancelled ? 'cancelled' : 'failed'
      const message = String(error instanceof Error ? error.message : error)
      run.error = control.cancelled ? '已停止。原有作品保留。' : message.replaceAll(credential, '[REDACTED]').slice(0, 1800)
      event(run.status, run.error)
      const explanation = run.status === 'cancelled' ? '我停下这一轮了。' : '这轮我还没做好。'
      project.messages.push({ id: `delivery-${run.id}`, role: 'assistant', content: `${explanation}原有作品与本轮需求都保留了。我们可以继续聊，也可以再试一次。`, time: new Date().toISOString() })
      this.updateArchive(project)
    } finally {
      clearTimeout(timeout)
      try { await control.harness?.close() } catch (error) { event('cleanup', '执行进程退出异常，请检查本轮记录。') }
      run.finishedAt = new Date().toISOString(); project.updatedAt = run.finishedAt
      try { await this.store.save() } finally { this.active.delete(project.id) }
    }
  }
  updateArchive(project: Project) {
    const complete = project.runs.filter(r => r.status === 'completed').reverse()
    project.archive.highlights = `# ${project.name} · 创作记录\n\n完成了 ${complete.length} 轮实现。\n\n${complete.map((r, i) => `## 第 ${i + 1} 轮\n${r.snapshot.brief.features.map(f => `- ${f}`).join('\n')}\n\n修改了 ${r.diff?.length || 0} 个文件。需求快照：${r.snapshot.hash.slice(0, 12)}。`).join('\n\n')}\n\n以上记录来自实际任务与文件变化。个人能力评价需要更多证据。`
    project.archive.interview = `# ${project.name} · 创作对话\n\n${project.messages.map(message => `${message.role === 'assistant' ? 'doda' : '你'}：${message.content}\n\n记录时间：${message.time}`).join('\n\n')}`
  }
  async cancel(id: string) { const active = this.active.get(id); if (active) { active.cancelled = true; await active.harness?.close(); await active.finished } }
  async close() { const controls = [...this.active.values()]; await Promise.all([...this.active.keys()].map(id => this.cancel(id))); await Promise.all(controls.map(control => control.finished)) }
}

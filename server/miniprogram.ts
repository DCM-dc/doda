import { readdir, readFile, realpath, stat, writeFile, mkdir } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, join } from 'node:path'
import { Script } from 'node:vm'
import { TmplGroup } from 'glass-easel-template-compiler'
import { StyleSheetTransformer } from 'glass-easel-stylesheet-compiler'
import type { DesignSystem } from './contracts'
import {nativeDesignAssets} from './design'

export async function safePath(root: string, input: string) {
  if (!input || input.includes('\0') || input.includes(':') || input.split(/[\\/]/).some(x => x === '.git' || x === 'node_modules')) throw new Error('INVALID_PROJECT_PATH')
  const target = resolve(root, input)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('PATH_OUTSIDE_PROJECT')
  let existing = target
  for (;;) {
    try {
      const real = await realpath(existing)
      const base = await realpath(root)
      const delta = relative(base, real)
      if (delta === '..' || delta.startsWith('..\\') || delta.startsWith('../') || isAbsolute(delta)) throw new Error('SYMLINK_OUTSIDE_PROJECT')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
  return target
}

export async function listFiles(root: string, sub = ''): Promise<string[]> {
  const result: string[] = []
  const current = sub ? await safePath(root, sub) : root
  for (const item of await readdir(current, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED')
    if (['node_modules', '.git'].includes(item.name)) continue
    const name = sub ? `${sub}/${item.name}` : item.name
    if (item.isDirectory()) result.push(...await listFiles(root, name))
    else result.push(name)
    if (result.length > 500) throw new Error('PROJECT_TOO_MANY_FILES')
  }
  return result.sort()
}

export async function validateMiniprogram(root: string) {
  const errors: string[] = []
  const warnings: string[] = []
  const compilation = { engine: 'glass-easel', version: '1.2.1', templates: [] as { path: string; bytes: number }[], stylesheets: [] as { path: string; bytes: number }[] }
  const files = await listFiles(root)
  async function json(path: string) {
    try { return JSON.parse(await readFile(await safePath(root, path), 'utf8')) }
    catch { errors.push(`${path}: JSON 无效或文件缺失`); return undefined }
  }
  const app = await json('app.json')
  const config = await json('project.config.json')
  if (config?.compileType !== 'miniprogram') errors.push('project.config.json: compileType 必须为 miniprogram')
  if (!files.includes('app.js')) errors.push('缺少 app.js')
  if (!Array.isArray(app?.pages) || !app.pages.length) errors.push('app.json: 至少需要一个页面')
  const pages: unknown[] = Array.isArray(app?.pages) ? app.pages : []
  for (const page of pages) {
    if (typeof page !== 'string') { errors.push('app.json: 页面路径必须为字符串'); continue }
    try { await safePath(root, page) } catch { errors.push(`非法页面路径: ${page}`); continue }
    for (const suffix of ['.js', '.json', '.wxml', '.wxss']) if (!files.includes(page + suffix)) errors.push(`缺少 ${page + suffix}`)
  }
  const templates = TmplGroup.newDev()
  try { for (const file of files) {
    if ((await stat(await safePath(root, file))).size > 1024 * 1024) { errors.push(`${file}: 超过首版单文件大小限制`); continue }
    if (file.endsWith('.json') && !['app.json', 'project.config.json'].includes(file)) await json(file)
    if (file.endsWith('.js')) {
      try { new Script(await readFile(await safePath(root, file), 'utf8'), { filename: file }) }
      catch (error) { errors.push(`${file}: ${(error as Error).message}`) }
    }
    if (file.endsWith('.wxml')) {
      try {
        const name = file.slice(0, -5)
        const diagnostics = templates.addTmpl(name, await readFile(await safePath(root, file), 'utf8')) as { isError: boolean; message: string; startLine: number; startColumn: number }[]
        for (const issue of diagnostics) (issue.isError ? errors : warnings).push(`${file}:${issue.startLine + 1}:${issue.startColumn + 1}: ${issue.message}`)
        for (const [dependencies, suffix] of [[templates.getDirectDependencies(name), '.wxml'], [templates.getScriptDependencies(name), '.wxs']] as const) {
          for (const dependency of dependencies) if (!files.includes(dependency + suffix)) errors.push(`${file}: 缺少依赖 ${dependency}${suffix}`)
        }
        if (!diagnostics.some(issue => issue.isError)) compilation.templates.push({ path: file, bytes: Buffer.byteLength(templates.getTmplGenObject(name)) })
      } catch (error) { errors.push(`${file}: WXML 编译失败 ${(error as Error).message}`) }
    }
    if (file.endsWith('.wxss')) {
      let stylesheet: StyleSheetTransformer | undefined
      try {
        stylesheet = new StyleSheetTransformer(file, await readFile(await safePath(root, file), 'utf8'), undefined, 750, false)
        const diagnostics = stylesheet.extractWarnings() as { message: string }[]
        for (const issue of diagnostics) warnings.push(`${file}: ${issue.message}`)
        compilation.stylesheets.push({ path: file, bytes: Buffer.byteLength(stylesheet.getContent()) })
      } catch (error) { errors.push(`${file}: WXSS 编译失败 ${(error as Error).message}`) }
      finally { stylesheet?.free() }
    }
    if (/\.(html|jsx|tsx)$/.test(file)) errors.push(`${file}: 当前交付目标只接受原生微信小程序`)
  } } finally { templates.free() }
  return { ok: errors.length === 0, errors, warnings, files, compilation, scope: '工程结构、JS 语法和微信官方 glass-easel WXML/WXSS 编译检查；开发者工具预览与真机验收另行执行' }
}

export async function scaffold(root: string, design: DesignSystem, appId: string) {
  await mkdir(join(root, 'pages/home'), { recursive: true })
  const t = design.tokens
  const content: Record<string, string> = {
    'app.js': 'App({ globalData: {} })\n',
    'app.json': JSON.stringify({ pages: ['pages/home/index'], window: { navigationBarTitleText: '我的第一个作品', navigationBarBackgroundColor: t.background, navigationBarTextStyle: 'black', backgroundColor: t.background } }, null, 2),
    'app.wxss': `page { background: ${t.background}; color: ${t.text}; font-family: sans-serif; }\nbutton::after { border: none; }\n`,
    'project.config.json': JSON.stringify({ appid: appId || 'touristappid', projectname: 'doda-project', compileType: 'miniprogram', miniprogramRoot: './', setting: { es6: true, enhance: true, minified: true } }, null, 2),
    'sitemap.json': JSON.stringify({ rules: [{ action: 'allow', page: '*' }] }, null, 2),
    'pages/home/index.json': JSON.stringify({ navigationBarTitleText: '我的作品', usingComponents: {} }, null, 2),
    'pages/home/index.js': "Page({ data: { count: 0 }, add() { this.setData({ count: this.data.count + 1 }) } })\n",
    'pages/home/index.wxml': '<view class="page"><view class="eyebrow">我的第一个小程序</view><view class="title">一个想法，正在长大。</view><view class="description">这是可以在微信开发者工具中运行的起始模板。和 doda 聊清楚，再把它变成你的作品。</view><view class="card"><view class="count">{{count}}</view><view class="hint">每点一下，前进一步</view><button bindtap="add" class="primary">试试看 +1</button></view></view>\n',
    'pages/home/index.wxss': `.page{padding:64rpx 40rpx}.eyebrow{font-size:26rpx;color:${t.accent};margin-bottom:32rpx}.title{font-size:54rpx;font-weight:600;line-height:1.35}.description{font-size:28rpx;line-height:1.8;color:${t.muted};margin-top:24rpx}.card{margin-top:64rpx;background:${t.surface};padding:48rpx;border-radius:${t.radius * 2}rpx}.count{font-size:96rpx;font-weight:600}.hint{font-size:26rpx;color:${t.muted};margin:12rpx 0 32rpx}.primary{background:${t.accent};color:white;border-radius:20rpx;font-size:30rpx}\n`,
  }
  for (const [name, text] of Object.entries(content)) await writeFile(join(root, name), text, 'utf8')
  await writeDesign(root, design)
}

export async function writeDesign(root: string, design: DesignSystem) {
  const ref=join(root,'.design');await mkdir(ref,{recursive:true})
  for(const [path,content]of Object.entries(nativeDesignAssets(design))){const target=join(ref,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,'utf8')}
  if(design.package){
    const files=design.package.files
    const mapped:Record<string,string>={}
    for(const [path,content]of Object.entries(files)){
      if(path.startsWith('/')||path.split(/[\\/]/).includes('..'))throw Error('INVALID_DESIGN_RESOURCE_PATH')
      const exported=path.endsWith('.html')?path.slice(0,-5)+'.md':path,target=await safePath(ref,exported)
      mapped[path]=exported;await mkdir(dirname(target),{recursive:true});await writeFile(target,path.endsWith('.html')?'# 原始视觉参考\n\n```html\n'+content+'\n```\n':content,'utf8')
    }
    await writeFile(join(ref,'upstream-paths.json'),JSON.stringify(mapped,null,2),'utf8')
    await writeFile(join(ref,'components.md'),'# 上游组件视觉参考\n\n这些浏览器组件只作为外观和状态参考；交付需使用微信原生组件。\n\n```html\n'+files['components.html']+'\n```','utf8')
    for(const [target,source]of [['tokens.json','design-tokens.json'],['manifest.json','manifest.json'],['components.manifest.json','components.manifest.json'],['USAGE.md','USAGE.md']])await writeFile(join(ref,target),files[source],'utf8')
    await writeFile(join(ref,'LICENSE.md'),await readFile(new URL('./designs/LICENSE',import.meta.url),'utf8'),'utf8')
    await writeFile(join(root,'DESIGN.md'),`# ${design.name}\n\n${design.package.nativeGuide}\n\n## 当前主题覆盖\n${JSON.stringify(design.tokens,null,2)}\n\n## 必须阅读的设计资源\n.design/DESIGN.md\n.design/tokens.css\n.design/components.md\n.design/tokens.json\n.design/components.manifest.json\n.design/USAGE.md\n.design/native/USAGE.md\n\n## 微信原生复用\n原始 tokens.css 是统一来源，当前主题覆盖是用户明确保存的选择。使用 doda_use_component 安装本轮实际需要的原生组件和主题；组件从当前冻结版本编译，不重写组件基础样式。form 的提交、重置和字段保持原生微信语义。原始 HTML 预览转换为 Markdown，路径映射在 .design/upstream-paths.json。浏览器截图只代表预览，不能声称完成微信真机验证。\n\n## 来源\n${design.package.url}\n固定提交 ${design.package.revision}；原始包 SHA-256 ${design.package.hash}；Apache-2.0。`,'utf8')
    await writeFile(join(root,'design-system.json'),JSON.stringify(design,null,2),'utf8')
    return
  }
  await writeFile(join(root, 'DESIGN.md'), `# ${design.name}\n\n## 使用目标\n微信原生小程序。保持可读性，使用 view、text、button、scroll-view 等微信组件。\n\n## 颜色\n${JSON.stringify(design.tokens, null, 2)}\n\n## 文字\n标题 44–56rpx；正文 30–32rpx；辅助文字不低于 26rpx。\n\n## 布局\n8rpx 网格；页面左右留白 32–40rpx；触控目标不小于 88rpx。\n\n## 组件\n先阅读 .design/native/USAGE.md，调用 doda_use_component 安装需要的主题与组件，表单提交与字段保持原生微信语义。按钮、表单、卡片保持一致；所有交互有明确反馈。\n\n## 装饰\n少量装饰。不要依赖 DOM、window、document 或浏览器 CSS 专属能力。\n\n## 复用\n设计系统 ${design.id}，版本 ${design.version}。项目固定此快照。\n\n## 来源\n${design.source}\n`, 'utf8')
  await writeFile(join(root, 'design-system.json'), JSON.stringify(design, null, 2), 'utf8')
}

import { readFile, writeFile, readdir, mkdir, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname } from 'node:path'

export const name = 'doda-project-tools'
export const inject = ['tools']

export function apply(ctx) {
  const root = process.env.DODA_PROJECT_ROOT
  if (!root) throw new Error('DODA_PROJECT_ROOT_REQUIRED')
  async function path(input) {
    if (!input || input.includes(':') || input.includes('\0') || input.split(/[\\/]/).some(x => ['.git', 'node_modules'].includes(x))) throw new Error('INVALID_PROJECT_PATH')
    const target = resolve(root, input)
    const delta = relative(root, target)
    if (delta === '..' || delta.startsWith('..\\') || delta.startsWith('../') || isAbsolute(delta)) throw new Error('PATH_OUTSIDE_PROJECT')
    let existing = target
    for (;;) {
      try {
        const actual = await realpath(existing)
        const rel = relative(await realpath(root), actual)
        if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('SYMLINK_OUTSIDE_PROJECT')
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        const parent = dirname(existing)
        if (parent === existing) throw error
        existing = parent
      }
    }
    return target
  }
  const allowed = new Set(['doda_list', 'doda_read', 'doda_write', 'doda_use_component'])
  ctx.tools.guard(exec => allowed.has(exec.name) ? undefined : 'DODA_PROJECT_TOOLS_ONLY')
  const string = { type: 'string' }
  const read = new Set()
  function tool(name, description, properties, execute) {
    ctx.tools.register({ name, description, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute })
  }
  tool('doda_list', 'List files within the current WeChat mini program project. Use . for the root.', { path: string }, async args => (await readdir(await path(args.path), { withFileTypes: true })).map(item => ({ name: item.name, directory: item.isDirectory() })))
  tool('doda_read', 'Read a UTF-8 source file within the project. Read DESIGN.md and app.json first.', { path: string }, async args => {const target=await path(args.path),text=await readFile(target,'utf8');read.add(relative(root,target).replaceAll('\\','/').toLowerCase());return {text:text.slice(0,80000)}})
  tool('doda_write', 'Write a complete UTF-8 source file inside this project. Only native mini program files, JSON, Markdown, or SVG. No browser HTML or React.', { path: string, content: string }, async args => {
    if (!/\.(js|json|wxml|wxss|md|svg)$/.test(args.path) || Buffer.byteLength(args.content) > 300000) throw new Error('INVALID_SOURCE_FILE')
    const target = await path(args.path)
    const normalized=relative(root,target).replaceAll('\\','/').toLowerCase()
    if(normalized==='design.md'||normalized==='design-system.json'||normalized.startsWith('.design/')||/^components\/doda-(button|card|input)\//.test(normalized)||normalized==='styles/doda.wxss')throw new Error('FROZEN_DESIGN_READ_ONLY')
    const design=JSON.parse(await readFile(resolve(root,'design-system.json'),'utf8').catch(()=>'{}'))
    if(design.package){const required=['design.md','.design/design.md','.design/tokens.css','.design/components.md','.design/tokens.json','.design/components.manifest.json','.design/usage.md','.design/native/usage.md'].filter(file=>!read.has(file));if(required.length)throw new Error('DESIGN_RESOURCES_NOT_READ: '+required.join(', '))}
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, args.content, 'utf8')
    return { written: args.path }
  })
  tool('doda_use_component','Install the frozen native WeChat theme or a reusable component. Read .design/native/USAGE.md first. Names: theme, button, card, input. Button/card emit press; input emits valuechange. Keep native form semantics.',{name:{type:'string',enum:['theme','button','card','input']}},async args=>{
    if(!['theme','button','card','input'].includes(args.name))throw Error('UNKNOWN_NATIVE_COMPONENT')
    const design=JSON.parse(await readFile(await path('design-system.json'),'utf8'))
    const required=design.package?['design.md','.design/design.md','.design/tokens.css','.design/components.md','.design/tokens.json','.design/components.manifest.json','.design/usage.md','.design/native/usage.md']:['design.md','.design/native/usage.md']
    const missing=required.filter(file=>!read.has(file));if(missing.length)throw Error('DESIGN_RESOURCES_NOT_READ: '+missing.join(', '))
    const manifest=JSON.parse(await readFile(await path('.design/native/manifest.json'),'utf8'))
    if(manifest.designHash!==(design.package?.hash||design.id)||manifest.designId!==design.id||JSON.stringify(manifest.tokens)!==JSON.stringify(design.tokens))throw Error('NATIVE_DESIGN_VERSION_MISMATCH')
    const appPath=await path('app.json'),app=JSON.parse(await readFile(appPath,'utf8')),tag='doda-'+args.name,component='components/'+tag+'/index'
    if(args.name!=='theme'&&app.usingComponents?.[tag]&&app.usingComponents[tag]!=='/'+component)throw Error('COMPONENT_TAG_CONFLICT')
    const files=[['.design/native/theme.wxss','styles/doda.wxss']]
    if(args.name!=='theme')for(const extension of ['js','json','wxml','wxss'])files.push(['.design/native/'+component+'.'+extension,component+'.'+extension])
    const content=await Promise.all(files.map(async([source,target])=>({target:await path(target),content:await readFile(await path(source),'utf8')})))
    const stylesPath=await path('app.wxss'),styles=await readFile(stylesPath,'utf8'),imported=/@import\s+["']\/?styles\/doda\.wxss["']\s*;/.test(styles)
    for(const file of content){await mkdir(dirname(file.target),{recursive:true});await writeFile(file.target,file.content,'utf8')}
    if(!imported)await writeFile(stylesPath,'@import "styles/doda.wxss";\n'+styles,'utf8')
    if(args.name!=='theme'){app.usingComponents={...app.usingComponents,[tag]:'/'+component};await writeFile(appPath,JSON.stringify(app,null,2),'utf8')}
    return {installed:args.name,tag:args.name==='theme'?undefined:tag,event:manifest.events[args.name],designHash:manifest.designHash}
  })
}

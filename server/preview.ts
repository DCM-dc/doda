import {readFile} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {z} from 'zod'
import {safePath,listFiles} from './miniprogram'
import {TmplGroup} from 'glass-easel-template-compiler'
import {StyleSheetTransformer} from 'glass-easel-stylesheet-compiler'
import {build} from 'esbuild'
import {createHash} from 'node:crypto'
import {Script} from 'node:vm'
import {devices,previewDevice,type Device} from './devices'
import type {Store} from './store'

let runtime:Promise<string>|undefined
export async function previewRevision(root:string) {
 const hash=createHash('sha256'),pageHash=createHash('sha256')
 for(const file of (await listFiles(root)).filter(file=>/\.(js|json|wxss|wxml|png|jpg|jpeg|webp|svg)$/.test(file)&&!file.startsWith('.design/')&&file!=='design-system.json').sort()){const data=await readFile(await safePath(root,file));hash.update(file).update(data);if(file.startsWith('pages/')&&/\.(js|wxml)$/.test(file))pageHash.update(file).update(data)}
 return {revision:hash.digest('hex'),pages:pageHash.digest('hex')}
}

export const previewImageSchema=z.object({data:z.string().max(2000000),page:z.string().min(1).max(160),runId:z.string().max(100).optional()}).transform((value,ctx)=>{
 const valid=/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.data),data=Buffer.from(value.data.split(',')[1]||'','base64')
 const width=data.length>=33?data.readUInt32BE(16):0,height=data.length>=33?data.readUInt32BE(20):0
 if(!valid||data.length<67||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||data.toString('ascii',12,16)!=='IHDR'||width<1||height<1||width>1200||height>2400){ctx.addIssue({code:'custom',message:'INVALID_PREVIEW_IMAGE'});return z.NEVER}
 return {...value,bytes:data,width,height}
})

export async function previewHtml(root:string,page?:string,storage:Record<string,unknown>={},options:{device?:string;chrome?:boolean;engine?:'auto'|'compatible';runId?:string}={}) {
 const config=JSON.parse(await readFile(join(root,'app.json'),'utf8')) as {pages:string[];usingComponents?:Record<string,string>;window?:Record<string,unknown>;tabBar?:{list:{pagePath:string;iconPath?:string;selectedIconPath?:string}[]}}
 const device:Device=options.device?previewDevice(options.device):devices[2]
 const path=page||config.pages[0]
 await safePath(root,path)
 if(!Array.isArray(config.pages)||!config.pages.includes(path))throw Error('PREVIEW_PAGE_NOT_REGISTERED')
 async function stylesheet(file:string,seen=new Set<string>()):Promise<string>{
  const target=await safePath(root,file);if(seen.has(target))throw Error('PREVIEW_STYLESHEET_CYCLE');seen.add(target)
  let css=await readFile(target,'utf8')
  for(const match of css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/g)){
   const request=match[1];if(request.includes(':')||request.includes('\\')||request.includes('?')||request.includes('#'))throw Error('PREVIEW_INVALID_STYLESHEET_IMPORT')
   const path=request.startsWith('/')?request.slice(1):join(dirname(file),request)
   css=css.replace(match[0],await stylesheet(path,new Set(seen)))
  }
  return css
 }
 const css=await stylesheet('app.wxss')
 const pages:Record<string,{wxml:string;css:string;usingComponents:Record<string,string>;config:Record<string,unknown>;scope?:string;compiledCss?:string}>=Object.create(null),components:typeof pages=Object.create(null)
 async function mappings(from:string,input:Record<string,string>={}) {
  const result:Record<string,string>=Object.create(null)
  for(const [tag,request]of Object.entries(input)) {
   if(typeof request!=='string'||!request||request.includes('\\')||request.includes(':'))throw Error('PREVIEW_INVALID_COMPONENT_PATH')
   const segments=request.startsWith('/')?[]:from.split('/').slice(0,-1)
   for(const segment of request.split('/')){if(!segment||segment==='.')continue;if(segment==='..'){if(!segments.length)throw Error('PREVIEW_COMPONENT_PATH_OUTSIDE_PROJECT');segments.pop()}else segments.push(segment)}
   const component=segments.join('/');await safePath(root,component);result[tag]=component
   if(Object.hasOwn(components,component))continue
   const definition=JSON.parse(await readFile(await safePath(root,component+'.json'),'utf8'))
   if(definition.component!==true)throw Error('PREVIEW_COMPONENT_NOT_REGISTERED: '+component)
   components[component]={wxml:await readFile(await safePath(root,component+'.wxml'),'utf8'),css:await stylesheet(component+'.wxss'),usingComponents:{},config:definition}
   components[component].usingComponents=await mappings(component,{...config.usingComponents,...definition.usingComponents})
  }
  return result
 }
 for(const page of config.pages){const definition=JSON.parse(await readFile(await safePath(root,page+'.json'),'utf8'));pages[page]={wxml:await readFile(await safePath(root,page+'.wxml'),'utf8'),css:css+'\n'+await stylesheet(page+'.wxss'),usingComponents:await mappings(page,{...config.usingComponents,...definition.usingComponents}),config:{...config.window,...definition}}}
 const modules:Record<string,string>=Object.create(null)
 for(const file of await listFiles(root))if(file.endsWith('.js')&&!file.startsWith('.design/')){const code=await readFile(await safePath(root,file),'utf8');new Script(code,{filename:file});modules[file]=code}
 const assets:Record<string,string>=Object.create(null)
 for(const file of await listFiles(root))if(/\.(png|jpg|jpeg|webp|gif|svg)$/.test(file)){const data=await readFile(await safePath(root,file));if(data.length<=2000000)assets[file]=`data:image/${file.endsWith('.svg')?'svg+xml':file.endsWith('.jpg')?'jpeg':file.split('.').at(-1)};base64,${data.toString('base64')}`}
 const supportedTags=new Set(['view','text','button','input','textarea','scroll-view','image','block','template','include','import','slot',...Object.keys(config.usingComponents||{}),...Object.values({...pages,...components}).flatMap(item=>Object.keys(item.usingComponents))])
 const unsupported=Object.values({...pages,...components}).some(item=>[...item.wxml.matchAll(/<([a-z][\w-]*)\b/g)].some(match=>!supportedTags.has(match[1])))||Object.values(modules).some(code=>/\bwx\.(?:createSelectorQuery|createCanvasContext|createAnimation|createIntersectionObserver|on\w+|start\w+|getStorageInfo|clearStorage|setStorage\(|getStorage\(|removeStorage\()/.test(code))
 const engine=options.engine==='compatible'||unsupported?'compatible':'official'
 let templates=''
 if(engine==='official'){
  const group=TmplGroup.newDev()
  try{for(const [path,item]of Object.entries({...pages,...components})){const errors=group.addTmpl(path,item.wxml) as {isError:boolean}[];if(errors.some(error=>error.isError))throw Error('PREVIEW_WXML_COMPILE_FAILED: '+path)}templates=group.getTmplGenObjectGroups()}finally{group.free()}
  for(const [path,item]of Object.entries({...pages,...components})){item.scope=components[path]&&item.config.styleIsolation!=='shared'?`doda-${createHash('sha256').update(path).digest('hex').slice(0,10)}`:undefined;const transformer=new StyleSheetTransformer(path+'.wxss',item.css,item.scope,750,false);try{item.compiledCss=(transformer.getContent()+'\n'+transformer.getLowPriorityContent()).replace(/(^|[}\n])(\s*)page\s*\{/g,'$1$2#mini-content{')}finally{transformer.free()}}
 }
 const source=JSON.stringify({page:path,pages,components,modules,storage,config,device,chrome:Boolean(options.chrome),engine,templates,assets,runId:options.runId}).replaceAll('<','\\u003c')
 let template=engine==='compatible'?await readFile(join(dirname(fileURLToPath(import.meta.url)),'preview.html'),'utf8'):'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app"></main></body></html>'
 const capture=await readFile(join(dirname(fileURLToPath(import.meta.url)),'../node_modules/html-to-image/dist/html-to-image.js'),'utf8')
 if(engine==='compatible'){
  template=template.replace('__SOURCE__',()=> 'globalThis.__DODA_PREVIEW_SOURCE').replace("const wx={",'const wx=globalThis.__DODA_COMPATIBLE_WX={').replace("parent.postMessage({type:'doda-preview-route'","globalThis.__DODA_ROUTE_CHANGED?.(currentRoute);parent.postMessage({type:'doda-preview-route'")
  if(options.chrome){template=template.replace("function getWindowInfo(){",'function legacyWindowInfo(){').replace('Object.assign(wx,{pageScrollTo,','function getWindowInfo(){const d=source.device,custom={...source.config.window,...source.pages[currentRoute].config}.navigationStyle===\'custom\',top=d.status+(custom?0:44),bottom=d.height-d.bottom;return {pixelRatio:1,screenWidth:d.width,screenHeight:d.height,windowWidth:d.width,windowHeight:bottom-top,screenTop:top,statusBarHeight:d.status,safeArea:{left:0,top:d.status,right:d.width,bottom,width:d.width,height:bottom-d.status}}}Object.assign(wx,{getSystemInfoSync:getWindowInfo,getMenuButtonBoundingClientRect(){const d=source.device;return {width:87,height:32,top:d.status+6,bottom:d.status+38,left:d.width-94,right:d.width-7}},pageScrollTo,').replace("'$1$2body{'","'$1$2#mini-content{'")}
 }
 if(!runtime)runtime=build({entryPoints:[join(dirname(fileURLToPath(import.meta.url)),'preview-runtime.mjs')],bundle:true,write:false,format:'iife',platform:'browser',minify:true}).then(result=>result.outputFiles[0].text).catch(error=>{runtime=undefined;throw error})
 const bundle=await runtime
 return template.replace('</head>',()=>`<script>${capture.replaceAll('</script','<\\/script')}</script><script>globalThis.__DODA_PREVIEW_SOURCE=${source}</script></head>`).replace('</body>',()=>`<script>${bundle.replaceAll('</script','<\\/script')}</script></body>`)
}

export async function renderPreview(root:string,page?:string,actions:string[]=[]) {
 const html=await previewHtml(root,page)
 const browser=await chromium.launch({headless:true,timeout:20000})
 try {
  const context=await browser.newContext({viewport:{width:375,height:667},deviceScaleFactor:1,serviceWorkers:'block'})
  await context.route('**/*',route=>route.request().url().startsWith('data:')?route.continue():route.abort())
  const view=await context.newPage(),errors:string[]=[]
  view.on('pageerror',error=>errors.push(error.message))
  await view.setContent(html,{waitUntil:'load',timeout:15000})
  for(const label of actions)await view.getByText(label,{exact:true}).click({timeout:3000})
  await view.evaluate(()=>document.fonts.ready)
  if(errors.length)throw Error('PREVIEW_RENDER_FAILED: '+errors.join('; ').slice(0,500))
  const data=await view.screenshot({type:'png',timeout:10000})
  const layout=await view.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}))
  return {data,page:page||JSON.parse(await readFile(join(root,'app.json'),'utf8')).pages[0] as string,...layout}
 } finally {await browser.close()}
}

export class PreviewSession {
 constructor(private store:Store) {}
 private frames=new Map<string,{revision:string;pages:string[];runId?:string;available:boolean;live:boolean;html:string;root:string}>()
 async current(id:string,device:string,page?:string) {
 const project=this.store.project(id),current=this.store.files(id),running=project.runs.find(run=>run.status==='running'),delivered=project.runs.find(run=>run.status==='completed'),key=`${id}:${device}:${page||''}`
 previewDevice(device)
 let root=current,runId=delivered?.id,live=false
 if(running){const candidate=join(this.store.root,'projects',id,'runs',running.id,'candidate');try{const [before,after]=await Promise.all([previewRevision(current),previewRevision(candidate)]);if(delivered?after.revision!==before.revision:after.pages!==before.pages){root=candidate;runId=running.id;live=true}}catch{}}
 const version=await previewRevision(root),previous=this.frames.get(key)
 if(previous?.revision===version.revision&&previous.runId===runId&&previous.live===live)return previous
 try{
  const config=JSON.parse(await readFile(join(root,'app.json'),'utf8')),pages=config.pages as string[],chosen=page&&pages.includes(page)?page:undefined
  const html=await previewHtml(root,chosen,await this.store.previewStorage(id),{device,chrome:true,runId})
  if((await previewRevision(root)).revision!==version.revision){if(previous)return previous;throw Error('PREVIEW_FILES_CHANGING')}
  const result={revision:version.revision,pages,runId,available:Boolean(delivered)||live,live,html,root};this.frames.set(key,result);if(this.frames.size>60)this.frames.delete(this.frames.keys().next().value!);return result
 }catch(error){if(live){if(previous)return previous;const config=JSON.parse(await readFile(join(current,'app.json'),'utf8')),html=await previewHtml(current,undefined,await this.store.previewStorage(id),{device,chrome:true,runId:delivered?.id});const result={...(await previewRevision(current)),pages:config.pages as string[],runId:delivered?.id,available:Boolean(delivered),live:false,html,root:current};this.frames.set(key,result);return result}throw error}
}
}

import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {once} from 'node:events'
import {tmpdir} from 'node:os'
import {isAbsolute,join,relative,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Store} from '../server/store'
import type {Project} from '../server/contracts'

const story='傍晚的小街口，面包店把最后一盏灯留着。有人把自行车靠在门边，先闻到一点热乎乎的甜味，再慢慢想起今天其实没有白过。风从路牌后面绕过来，树叶响了两下。你不必马上做下一件事，只要在这个亮着的小地方站一会儿。等想走了，就把这一小段安静折回口袋，路还是原来的路，脚步可以轻一点。'
const page='单页一张卡和一个按钮；封面「路口还有一盏灯」「打开」；打开显示「'+story+'」「合上」；合上或离开回封面。'
const card={title:'走神小信封',audience:'自己使用',purpose:'回家路上停一小会儿',features:['封面「路口还有一盏灯」；「打开」显示「'+story+'」；「合上」回封面。'],pages:[page],acceptance:['整段显示「'+story+'」，合上或离开后回封面。'],deferred:[],designId:'warm-paper'}
const shortCard={...card,pages:['单页一张卡和一个按钮']},reply='封面和打开后的故事都留在这张卡里。'
let root='',base='',child:ChildProcess|undefined,exited:Promise<unknown>,projects:Project[]=[]

beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'doda-page-copy-'));const store=new Store(root);await store.load()
 for(let index=0;index<3;index++){const project=store.create('warm-paper');if(index){project.brief=structuredClone(shortCard);project.name=card.title;project.revision=1;project.handoffRevision=1}projects.push(structuredClone(project))}await store.save()
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const address=socket.address();if(!address||typeof address==='string')throw new Error('FIXTURE_PORT_MISSING');base='http://127.0.0.1:'+address.port+'/api';await new Promise<void>(done=>socket.close(()=>done()))
 const provider=join(root,'provider.mjs');await writeFile(provider,`const original=globalThis.fetch;globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:${JSON.stringify(reply)}}}]});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:${JSON.stringify(card)},handoff:'offer',finish:false,inspirations:[]})}]}]});};`)
 const env:NodeJS.ProcessEnv={...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'page-copy-provider-fixture',MIMO_API_KEY:''};const modulePath=Object.entries(env).find(([name])=>name.toLowerCase()==='psmodulepath')?.[1];for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];if(modulePath)env.PSMODULEPATH=modulePath
 child=spawn(process.execPath,['--import',pathToFileURL(provider).href,'--import','tsx','server/index.ts'],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let errors='';child.stdout?.resume();child.stderr?.on('data',bytes=>errors+=String(bytes));await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('FIXTURE_BOOT_FAILED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{if(child?.exitCode===null)child.kill();if(exited)await exited;if(root){const delta=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(delta)||delta.startsWith('..')||!delta.startsWith('doda-page-copy-'))throw new Error('INVALID_TEST_CLEANUP');await rm(root,{recursive:true,force:true})}})

describe('完整页面文案的真实 HTTP 保存与整理',()=>{
 it('聊天整理保存一页的完整故事而不把它分成多个页面',async()=>{
  const text='单页显示完整原文，整理需求卡给我看。',response=await fetch(base+'/projects/'+projects[0].id+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,voice:true})}),project=await response.json()
  expect(response.status).toBe(200);expect(response.headers.get('x-doda-dialogue-requests')).toBe('1');expect(response.headers.get('x-doda-requirements-requests')).toBe('1');expect(response.headers.get('x-doda-reply-refinements')).toBe('0')
  expect(project.brief).toEqual(card);expect(project.brief.pages).toEqual([page]);expect(project.revision).toBe(1);expect(project.handoffRevision).toBe(1);expect(project.requirementsError).toBeUndefined();expect(project.runs).toEqual([]);expect(project.phase).toBe('explore');expect(project.voiceDone).toBe(false)
  expect(project.chatReply).toBe('我把「走神小信封」的想法整理好了，细节都在需求卡里。就按这张卡开始做吗？')
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((entry:Project)=>entry.id===project.id);expect(saved.brief).toEqual(card);expect(saved.messages.at(-2).content).toBe(text);expect(saved.messages.at(-1).content).toBe(project.chatReply)
 })
 it('保存300字页面描述完整写入新版本并清除旧确认',async()=>{
  const update={...card,pages:['页'.repeat(300)]},response=await fetch(base+'/projects/'+projects[1].id+'/brief',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(update)}),project=await response.json()
  expect(response.status).toBe(200);expect(project.brief).toEqual(update);expect(project.revision).toBe(2);expect(project.handoffRevision).toBeUndefined();expect(project.runs).toEqual([])
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((entry:Project)=>entry.id===project.id);expect(saved.brief).toEqual(update);expect(saved.revision).toBe(2);expect(saved.handoffRevision).toBeUndefined()
 })
 it('拒绝301字页面描述时保留原卡和确认版本',async()=>{
  const previousState=await(await fetch(base+'/state')).json(),previous=previousState.projects.find((entry:Project)=>entry.id===projects[2].id)
  expect(previous.brief).toEqual(shortCard);expect(previous.revision).toBe(1);expect(previous.handoffRevision).toBe(1)
  const response=await fetch(base+'/projects/'+projects[2].id+'/brief',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...card,pages:['页'.repeat(301)]})}),error=await response.json()
  expect(response.status).toBe(400);expect(error.error).toContain('300')
  const state=await(await fetch(base+'/state')).json(),project=state.projects.find((entry:Project)=>entry.id===projects[2].id);expect(project).toEqual(previous)
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((entry:Project)=>entry.id===project.id);expect(saved).toEqual(previous)
 })
})

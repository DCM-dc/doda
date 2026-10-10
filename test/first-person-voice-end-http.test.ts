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

const cases=[
 {name:'实际识别出的第一人称结束话语返回关闭标记',text:'这一小会儿先留在这里，我先结束语音。',voice:true,expected:true,pending:1},
 {name:'第一人称关闭麦克风也结束当前语音',text:'我关闭麦克风。',voice:true,expected:true,pending:1},
 {name:'结束语音后继续文字聊天仍关闭语音',text:'我先结束语音，之后打字继续聊。',voice:true,expected:true,pending:undefined},
 {name:'引用结束话语不会关闭当前语音',text:'这句话引用了“我先结束语音”，我们继续语音聊。',voice:true,expected:false,pending:1},
 {name:'后续明确继续语音覆盖先前的结束话语',text:'我先结束语音，不过继续语音聊故事。',voice:true,expected:false,pending:1},
 {name:'普通文字聊天不返回语音关闭字段',text:'我先结束语音。',voice:false,expected:undefined,pending:1},
]
const card={title:'走神小信封',audience:'自己使用',purpose:'读固定故事停一下',features:['打开读故事，合上回封面'],pages:['单页一张卡和一个按钮'],acceptance:['离开后回到封面'],deferred:[],designId:'warm-paper'},reply='好，先停在这儿。'
let root='',base='',child:ChildProcess|undefined,exited:Promise<unknown>,projects:Project[]=[]
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'doda-first-person-voice-end-'));const store=new Store(root);await store.load()
 for(const item of cases){const project=store.create('warm-paper');project.brief=structuredClone(card);project.name=card.title;project.revision=1;project.handoffRevision=1;projects.push(structuredClone(project))}await store.save()
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const address=socket.address();if(!address||typeof address==='string')throw new Error('FIXTURE_PORT_MISSING');base='http://127.0.0.1:'+address.port+'/api';await new Promise<void>(done=>socket.close(()=>done()))
 const provider=join(root,'provider.mjs');await writeFile(provider,`const original=globalThis.fetch;globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:${JSON.stringify(reply)}}}]});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:null,handoff:'none',finish:false,inspirations:[]})}]}]});};`)
 const env:NodeJS.ProcessEnv={...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'first-person-voice-end-provider-fixture',MIMO_API_KEY:''};const modulePath=Object.entries(env).find(([name])=>name.toLowerCase()==='psmodulepath')?.[1];for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];if(modulePath)env.PSMODULEPATH=modulePath
 child=spawn(process.execPath,['--import',pathToFileURL(provider).href,'--import','tsx','server/index.ts'],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let errors='';child.stdout?.resume();child.stderr?.on('data',bytes=>errors+=String(bytes));await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('FIXTURE_BOOT_FAILED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{if(child?.exitCode===null)child.kill();if(exited)await exited;if(root){const delta=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(delta)||delta.startsWith('..')||!delta.startsWith('doda-first-person-voice-end-'))throw new Error('INVALID_TEST_CLEANUP');await rm(root,{recursive:true,force:true})}})
describe('第一人称语音结束的真实 HTTP 协议',()=>{
 it.each(cases.map((item,index)=>({...item,index})))('$name',async item=>{
  const response=await fetch(base+'/projects/'+projects[item.index].id+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:item.text,voice:item.voice})}),project=await response.json()
  expect(response.status).toBe(200);expect(project.voiceDone).toBe(item.expected);expect(Object.hasOwn(project,'voiceDone')).toBe(item.voice);expect(response.headers.get('x-doda-dialogue-requests')).toBe('1');expect(response.headers.get('x-doda-requirements-requests')).toBe('1')
  expect(project.brief).toEqual(card);expect(project.revision).toBe(1);expect(project.handoffRevision).toBe(item.pending);expect(project.phase).toBe('explore');expect(project.runs).toEqual([]);expect(project.inspirations).toEqual([]);expect(project.chatReply).toBe(reply);expect(project.messages.at(-2).content).toBe(item.text);expect(project.messages.at(-1).content).toBe(reply)
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((entry:Project)=>entry.id===project.id);expect(saved.brief).toEqual(card);expect(saved.revision).toBe(1);expect(saved.handoffRevision).toBe(item.pending);expect(saved.messages).toEqual(project.messages);expect(Object.hasOwn(saved,'voiceDone')).toBe(false)
 })
})

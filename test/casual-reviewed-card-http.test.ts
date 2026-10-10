import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {spawn, type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {once} from 'node:events'
import {tmpdir} from 'node:os'
import {isAbsolute, join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Store} from '../server/store'
import type {Project} from '../server/contracts'

const card={title:'纸片小停靠',audience:'自己使用',purpose:'课间捏住纸片歇一下',features:['长按显示“停一小会儿也很好。”，松手回“按住歇一下”'],pages:['只有一张纸片'],acceptance:['不存储、不联网、不发声'],deferred:[],designId:'warm-paper'}
const experience='我们继续聊这个感觉，不改作品。像小时候把纸条压在手心里，一松手就放开，挺轻的。'
type CardCase={name:string;reply:string;input?:string;voice?:boolean;missing?:boolean;error?:boolean;functional?:boolean;summarize?:boolean}
const cases:CardCase[]=[
 {name:'真实感受追问不会撤下已审阅的卡',reply:'这个画面很贴切，捏着的那点力气其实就是给自己留的。你更想要按住时那一下安静，还是松手瞬间的松开感？',voice:true},
 {name:'文字生活联想问题保留同一确认版本',reply:'想到这张纸片时，你会想起什么？'},
 {name:'省略问号的感受问题仍保留确认版本',reply:'你小时候也喜欢捏着纸条玩吗',voice:true},
 {name:'英文体验问题仍保留确认版本',reply:'What does that tiny pause feel like?'},
 {name:'普通陪聊陈述保持已有状态',reply:'像给手心留了一个可以放开的地方。'},
 {name:'明确邀请聊感受的问题不成为未定需求',input:experience+'你可以问我一个关于这种感觉的问题。',reply:'这种松开让你想到哪一刻？',voice:true},
 {name:'先不派工继续陪聊保留可再次确认的卡',input:'先不交出去。'+experience,reply:'你更喜欢按住的安静，还是松开的轻？',voice:true},
 {name:'无卡聊天不会凭空产生确认版本',reply:'这张小纸片让你想到什么？',missing:true},
 {name:'旧卡有整理错误时仍撤下无效确认',reply:'这样的纸片让你想起什么？',error:true},
 {name:'真正新增功能的讨论撤下旧卡确认',input:'继续聊，要不要给纸片加一个输入框？',reply:'你想自己写一句，还是固定那一句？',functional:true},
 {name:'普通功能讨论仍要等待玩法定下来',input:'先聊长按和短按怎么分，还没决定，不整理。',reply:'短按也显示一句，还是保持封面？',functional:true,voice:true},
 {name:'明确整理请求仍执行整理并给卡确认',reply:'这张纸片让你想到什么？',summarize:true},
 {name:'未要求陪聊的真正功能选择仍撤下确认',input:'短按也显示那句话，还是只让长按显示，我还没决定。',reply:'短按也显示一句，还是保持封面？',functional:true},
]
let root='',base='',child:ChildProcess|undefined,exited:Promise<unknown>,projects:Project[]=[]
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'doda-casual-reviewed-card-'));const store=new Store(root);await store.load()
 for(const item of cases){const project=store.create('warm-paper');if(!item.missing){project.brief=structuredClone(card);project.name=card.title;project.revision=1;project.handoffRevision=1}if(item.error)project.requirementsError='之前没有整理成功';projects.push(project)}await store.save()
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const address=socket.address();if(!address||typeof address==='string')throw new Error('FIXTURE_PORT_MISSING');base=`http://127.0.0.1:${address.port}/api`;await new Promise<void>(done=>socket.close(()=>done()))
 const provider=join(root,'provider.mjs');await writeFile(provider,`const original=globalThis.fetch,cases=${JSON.stringify(cases)};globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);const body=JSON.parse(options.body),content=url.endsWith('/chat/completions')?body.messages.findLast(item=>item.role==='user').content:body.input[0].content,match=content.match(/case=(\\d+)/);if(!match)throw new Error('FIXTURE_CASE_MISSING');const item=cases[Number(match[1])];if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:item.reply}}]});if(!item.functional&&!item.summarize)throw new Error('UNEXPECTED_EXTRACTION_DURING_CASUAL_CHAT');return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'recorded',brief:item.summarize?${JSON.stringify(card)}:null,handoff:'none',finish:false,inspirations:[]})}]}]});};`)
 const env:NodeJS.ProcessEnv={...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'casual-reviewed-card-provider-fixture',MIMO_API_KEY:''};const modulePath=Object.entries(env).find(([name])=>name.toLowerCase()==='psmodulepath')?.[1];for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];if(modulePath)env.PSMODULEPATH=modulePath
 child=spawn(process.execPath,['--import',pathToFileURL(provider).href,'--import','tsx','server/index.ts'],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let errors='';child.stdout?.resume();child.stderr?.on('data',bytes=>errors+=String(bytes));await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('FIXTURE_BOOT_FAILED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{if(child?.exitCode===null)child.kill();if(exited)await exited;if(root){const delta=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(delta)||delta.startsWith('..')||!delta.startsWith('doda-casual-reviewed-card-'))throw new Error('INVALID_TEST_CLEANUP');await rm(root,{recursive:true,force:true})}})
describe('已审阅需求卡与陪聊问题的真实 HTTP 状态',()=>{
 it.each(cases.map((item,index)=>({...item,index})))('$name',async item=>{
  const text=(item.input||experience)+'case='+item.index,response=await fetch(base+'/projects/'+projects[item.index].id+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,voice:item.voice,summarize:item.summarize})}),project=await response.json(),pending=item.missing||item.error||item.functional?undefined:1,reply=item.summarize?`我把「${card.title}」的想法整理好了，细节都在需求卡里。就按这张卡开始做吗？`:item.reply
  expect(response.status).toBe(200);expect(response.headers.get('x-doda-dialogue-requests')).toBe('1');expect(response.headers.get('x-doda-requirements-requests')).toBe(item.functional||item.summarize?'1':'0');expect(response.headers.get('x-doda-reply-refinements')).toBe('0')
  expect(project.handoffRevision).toBe(pending);expect(project.brief).toEqual(item.missing?undefined:card);expect(project.revision).toBe(item.missing?0:1);expect(project.designId).toBe('warm-paper');expect(project.phase).toBe('explore');expect(project.runs).toEqual([]);expect(project.inspirations).toEqual([]);expect(project.requirementsError).toBe(item.error?'之前没有整理成功':undefined)
  expect(project.chatReply).toBe(reply);expect(project.messages.at(-1).content).toBe(reply);expect(project.messages.at(-2).content).toBe(text);expect(project.voiceDone).toBe(item.voice?false:undefined);expect(project.archive.interview).toContain(reply)
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((entry:Project)=>entry.id===projects[item.index].id);expect(saved.handoffRevision).toBe(pending);expect(saved.brief).toEqual(project.brief);expect(saved.messages).toEqual(project.messages);expect(saved.archive).toEqual(project.archive)
 })
})

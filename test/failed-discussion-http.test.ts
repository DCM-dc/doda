import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {once} from 'node:events'
import {spawn, type ChildProcess} from 'node:child_process'
import {tmpdir} from 'node:os'
import {isAbsolute, join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Store} from '../server/store'
import type {Project} from '../server/contracts'

const card = {title:'纸片小停靠',audience:'自己使用',purpose:'课间捏住一张纸片歇一下',features:['长按纸片显示固定句，松手回封面'],pages:['只放一张纸片'],acceptance:['不存储、不联网、不发声'],deferred:[],designId:'warm-paper'}
type DiscussionCase = {name:string;reply:string;keep?:boolean;voice?:boolean;text?:string;summarize?:boolean;prior?:boolean;blocked?:boolean;provider?:'http'|'schema'|'empty'|'incomplete'|'recover'}
const cases:DiscussionCase[] = [
 {name:'录音误识别后保留固定句的追问',reply:'你想让长按露出固定那一句，还是每次换一句？',keep:true,voice:true},
 {name:'文字功能追问仍留在聊天中',reply:'纸片封面上的文字是什么？',keep:true},
 {name:'省略问号的语音澄清不丢失',reply:'你说的是微信原生长按事件吗',keep:true,voice:true},
 {name:'英文开放问题保留',reply:'Which sentence should appear while holding the paper?',keep:true},
 {name:'控件引用的派工文案不是执行承诺',reply:'你希望按钮上写「交给编程伙伴」，还是「先聊一聊」？',keep:true},
 {name:'普通继续讨论不会被整理错误取代',text:'我们继续聊纸片要露出哪句话。',reply:'你更想看到一句鼓励，还是一个小提醒？',keep:true,voice:true},
 {name:'旧卡和修订保留但撤下待确认',reply:'你想换封面文案，还是长按后的句子？',keep:true,prior:true},
 {name:'整理器503仍保留已收到的追问',reply:'封面是一个字还是一句话？',keep:true,provider:'http'},
 {name:'整理器无效结构仍保留追问',reply:'松手要回封面，还是继续显示那句话？',keep:true,provider:'schema'},
 {name:'整理器空内容仍保留追问',reply:'纸片是竖着还是横着？',keep:true,provider:'empty'},
 {name:'整理器未完成仍保留追问',reply:'那句话固定不变吗？',keep:true,provider:'incomplete'},
 {name:'第二次提取成功但未定问题不替换旧卡及错误',reply:'文字藏在纸片上方，还是中间？',keep:true,provider:'recover',prior:true},
 {name:'无功能追问的失败仍明确告知未整理',reply:'这样的纸片很轻，想到就看一眼。'},
 {name:'用户明确要求看卡时仍告知失败',text:'先整理本轮需求给我看。',reply:'你想露出哪句话？'},
 {name:'整理按钮请求仍告知失败',reply:'封面想写什么？',summarize:true},
 {name:'明确派工不能保留会误导的追问',text:'交给编程伙伴开始制作。',reply:'按这个交给编程伙伴吗？',prior:true,blocked:true},
 {name:'夹带派工邀请的功能追问不得冒充就绪',reply:'交给编程伙伴吗？顺便问，长按显示什么？'},
 {name:'声称卡已整理后的问题不能冒充成功',reply:'需求卡整理好了。纸片上的字想写什么？'},
 {name:'声称开始制作后的问题不能冒充派工',reply:'编程伙伴开始制作了。纸片想用哪句话？'},
 {name:'明确修正卡的请求仍诚实报告失败',text:'先修正这张需求卡，封面改为按住歇一下。',reply:'长按后要显示什么？',prior:true},
 {name:'另一种声称需求整理成功的问句仍报告失败',reply:'这轮需求已经整理成功了。纸片上想写什么？'},
 {name:'英语卡片就绪声明后的问句仍报告失败',reply:'The requirements are ready. Which sentence should appear?'},
]
let root='',base='',child:ChildProcess|undefined,exited:Promise<unknown>,projects:Project[]=[]
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'doda-failed-discussion-'));const store=new Store(root);await store.load()
 for(const item of cases){const project=store.create('warm-paper');if(item.prior){project.brief=structuredClone(card);project.revision=1;project.handoffRevision=1;project.requirementsError=item.provider==='recover'||item.blocked?'上一轮整理失败':undefined}projects.push(project)}await store.save()
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const address=listener.address();if(!address||typeof address==='string')throw new Error('FIXTURE_PORT_MISSING');base=`http://127.0.0.1:${address.port}/api`;await new Promise<void>(done=>listener.close(()=>done()))
 const provider=join(root,'provider.mjs');await writeFile(provider,`const original=globalThis.fetch,cases=${JSON.stringify(cases)},attempts=new Map;globalThis.fetch=async function(input,options){const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return original(input,options);const body=JSON.parse(options.body),data=url.endsWith('/chat/completions')?body.messages.findLast(item=>item.role==='user').content:JSON.parse(body.input[0].content.slice(body.input[0].content.indexOf('\\n')+1)).newestUserMessage,match=data.match(/case=(\\d+)/),index=match?Number(match[1]):cases.findIndex(item=>item.blocked&&item.text===data);if(index<0)throw new Error('FIXTURE_CASE_MISSING');const item=cases[index];if(url.endsWith('/chat/completions'))return Response.json({choices:[{message:{content:item.reply}}]});const count=(attempts.get(index)||0)+1;attempts.set(index,count);if(item.provider==='http')return Response.json({error:'fixture unavailable'},{status:503});let status=item.provider==='incomplete'?'incomplete':'completed',text=item.provider==='empty'?'':item.provider==='schema'?JSON.stringify({reply:'recorded',brief:{},handoff:'offer'}):item.provider==='recover'&&count===2?JSON.stringify({reply:'recorded',brief:${JSON.stringify(card)},handoff:'offer',finish:false,inspirations:[]}):'{invalid record';return Response.json({status,output:[{type:'message',content:[{type:'output_text',text}]}]});};`)
 const env:NodeJS.ProcessEnv={...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'failed-discussion-provider-fixture',MIMO_API_KEY:''};const modulePath=Object.entries(env).find(([name])=>name.toLowerCase()==='psmodulepath')?.[1];for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];if(modulePath)env.PSMODULEPATH=modulePath
 child=spawn(process.execPath,['--import',pathToFileURL(provider).href,'--import','tsx','server/index.ts'],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});exited=once(child,'exit');let errors='';child.stdout?.resume();child.stderr?.on('data',bytes=>errors+=String(bytes));await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('FIXTURE_BOOT_FAILED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{if(child?.exitCode===null)child.kill();if(exited)await exited;if(root){const delta=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(delta)||delta.startsWith('..')||!delta.startsWith('doda-failed-discussion-'))throw new Error('INVALID_TEST_CLEANUP');await rm(root,{recursive:true,force:true})}})
describe('整理器失败时持续讨论真实 HTTP 路由',()=>{
 it.each(cases.map((item,index)=>({...item,index})))('$name',async item=>{
  const text=(item.text||'我想捏一张纸片，按住露出一句话，只给自己玩。')+(item.blocked?'':'case='+item.index)
  const response=await fetch(base+'/projects/'+projects[item.index].id+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,voice:item.voice,summarize:item.summarize})}),project=await response.json()
  expect(response.status).toBe(200);expect(response.headers.get('x-doda-dialogue-requests')).toBe('1');expect(response.headers.get('x-doda-requirements-requests')).toBe('2')
  if(item.keep)expect(project.chatReply).toBe(item.reply);else{expect(project.chatReply).toContain('没有整理成功');expect(project.chatReply).not.toContain('交给编程伙伴吗')}
  expect(project.brief).toEqual(item.prior?card:undefined);expect(project.revision).toBe(item.prior?1:0);expect(project.handoffRevision).toBeUndefined();expect(project.runs).toEqual([]);expect(project.phase).toBe('explore');expect(project.inspirations).toEqual([])
  if(item.provider==='recover')expect(project.requirementsError).toBe('上一轮整理失败');else expect(project.requirementsError).toContain('没有整理成功')
  expect(project.voiceDone).toBe(item.voice?false:undefined);expect(project.messages.at(-1).content).toBe(project.chatReply);expect(project.messages.at(-2).content).toBe(text);expect(project.archive.interview).toContain(project.chatReply)
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((entry:Project)=>entry.id===projects[item.index].id);expect(saved.brief).toEqual(project.brief);expect(saved.revision).toBe(project.revision);expect(saved.handoffRevision).toBeUndefined();expect(saved.requirementsError).toBe(project.requirementsError);expect(saved.messages).toEqual(project.messages);expect(saved.archive).toEqual(project.archive)
 })
})

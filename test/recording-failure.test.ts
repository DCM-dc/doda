import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Store } from '../server/store'
import type { Project } from '../server/contracts'

let root='',base='',child:ChildProcess|undefined,closed:Promise<unknown>,projects:Project[]=[]
const brief={title:'小纸片',audience:'自己',purpose:'留一句话',features:['写一行字'],pages:['首页'],acceptance:['文字只在内存里'],deferred:[],designId:'warm-paper'}
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'doda-record-failure-'));const store=new Store(root);await store.load()
 for(let index=0;index<7;index++){const project=store.create('warm-paper');if(index>=2){project.brief=structuredClone(brief);project.revision=1;project.handoffRevision=1}if(index>=3)project.requirementsError='之前没有整理成功';projects.push(project)}
 await store.save()
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const address=listener.address();if(!address||typeof address==='string')throw new Error('UNIT_PORT_MISSING');base=`http://127.0.0.1:${address.port}/api`;await new Promise<void>(done=>listener.close(()=>done()))
 const fixture=join(root,'provider-boundary.mjs')
 await writeFile(fixture,`const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,options){
 const url=String(input);if(!url.startsWith('https://api.deepseek.com/'))return originalFetch(input,options);
 const body=JSON.parse(options.body);
 if(url.endsWith('/chat/completions')){const text=body.messages.at(-1).content;return Response.json({choices:[{message:{content:text.includes('随便聊')?'一行字轻轻收好就够了。':'需求已经整理好了，就按这张卡交给编程伙伴吗？'}}]})}
 const valid=/重新整理出完整卡|先修正这张需求卡/.test(body.input[0].content),payload=valid?{reply:'recorded',brief:${JSON.stringify({...brief,title:'新的小纸片'})},handoff:body.input[0].content.includes('先修正这张需求卡')?'none':'offer',finish:false,inspirations:[]}:null;
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:valid?JSON.stringify(payload):'{invalid record'}]}]});
};
await import(${JSON.stringify(pathToFileURL(resolve('server/index.ts')).href)});`)
 const env:NodeJS.ProcessEnv={...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'recording-unit-fixture',MIMO_API_KEY:''}
 const modulePath=Object.entries(env).find(([name])=>name.toLowerCase()==='psmodulepath')?.[1];for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];if(modulePath)env.PSMODULEPATH=modulePath
 child=spawn(process.execPath,['--import','tsx',fixture],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});closed=once(child,'exit');child.stdout?.resume();let errors='';child.stderr?.on('data',bytes=>{errors+=String(bytes)})
 await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('UNIT_BACKEND_CLOSED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{if(child?.exitCode===null)child.kill();if(closed)await closed;if(root){const path=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(path)||path.startsWith('..')||!path.startsWith('doda-record-failure-'))throw new Error('INVALID_UNIT_CLEANUP');await rm(root,{recursive:true,force:true})}})
async function chat(index:number,text:string,voice=false,summarize=!text.includes('随便聊')){const response=await fetch(base+'/projects/'+projects[index].id+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,voice,summarize})}),project=await response.json();expect(response.status).toBe(200);return {response,project}}

describe('Recording failure conversation feedback',()=>{
 it('routes a spoken card correction through dialogue and requirements without cancelling its pending handoff',async()=>{
  const {response,project}=await chat(5,'先修正这张需求卡，不要编程，名字改为新的小纸片。',true,false)
  expect(response.headers.get('x-doda-dialogue-requests')).toBe('1');expect(response.headers.get('x-doda-requirements-requests')).toBe('1');expect(project.brief).toEqual({...brief,title:'新的小纸片'});expect(project.revision).toBe(2);expect(project.handoffRevision).toBe(2);expect(project.chatReply).toContain('想法整理好了');expect(project.voiceDone).toBe(false);expect(project.runs).toEqual([])
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((item:Project)=>item.id===projects[5].id);expect(saved.revision).toBe(2);expect(saved.handoffRevision).toBe(2);expect(saved.messages.at(-1).content).toBe(project.chatReply)
 })
 it('honours an explicit stop alongside a correction without calling either provider',async()=>{
  const {response,project}=await chat(6,'先修正这张需求卡，但停止当前编程任务。',true)
  expect(response.headers.get('x-doda-dialogue-requests')).toBeNull();expect(response.headers.get('x-doda-requirements-requests')).toBeNull();expect(project.chatReply).toBe('现在没有编程任务在运行。我们可以继续聊。');expect(project.brief).toEqual(brief);expect(project.revision).toBe(1);expect(project.handoffRevision).toBeUndefined();expect(project.voiceDone).toBe(false);expect(project.runs).toEqual([])
 })
 it('states that a fresh card was not recorded rather than inviting its handoff',async()=>{
  const {response,project}=await chat(0,'先整理这轮需求卡，不要编程。')
  expect(response.headers.get('x-doda-dialogue-requests')).toBe('1');expect(response.headers.get('x-doda-requirements-requests')).toBe('2');expect(project.brief).toBeUndefined();expect(project.runs).toEqual([]);expect(project.revision).toBe(0);expect(project.handoffRevision).toBeUndefined();expect(project.requirementsError).toContain('没有整理成功');expect(project.chatReply).toContain('没有整理成功');expect(project.chatReply).not.toContain('交给编程伙伴吗');expect(project.messages.at(-1).content).toBe(project.chatReply)
 })
 it('keeps the voice conversation open while saying the card could not be recorded',async()=>{
  const {project}=await chat(1,'先整理这轮需求卡，等我确认。',true)
  expect(project.voiceDone).toBe(false);expect(project.chatReply).toContain('没有整理成功');expect(project.chatReply).not.toContain('交给编程伙伴吗');expect(project.runs).toEqual([]);expect(project.messages.at(-1).content).toBe(project.chatReply)
 })
 it('preserves the previous card but removes its pending handoff after recording fails',async()=>{
  const {project}=await chat(2,'先更新并整理这轮需求卡，不要编程。')
  expect(project.brief).toEqual(brief);expect(project.revision).toBe(1);expect(project.handoffRevision).toBeUndefined();expect(project.chatReply).toContain('没有整理成功');expect(project.chatReply).not.toContain('交给编程伙伴吗');expect(project.archive.interview).toContain(project.chatReply)
  const saved=JSON.parse(await readFile(join(root,'state.json'),'utf8')).projects.find((item:Project)=>item.id===projects[2].id);expect(saved.brief).toEqual(brief);expect(saved.handoffRevision).toBeUndefined()
 })
 it('preserves an earlier failure marker while accepting a later casual reply',async()=>{
  const {response,project}=await chat(3,'随便聊，不整理，也不改作品。像一行很轻的字。')
  expect(response.headers.get('x-doda-requirements-requests')).toBe('0');expect(project.chatReply).toBe('一行字轻轻收好就够了。');expect(project.requirementsError).toBe('之前没有整理成功');expect(project.brief).toEqual(brief);expect(project.runs).toEqual([])
 })
 it('clears the failure marker only after a valid newly recorded card',async()=>{
  const {response,project}=await chat(4,'重新整理出完整卡，先不要编程。')
  expect(response.headers.get('x-doda-requirements-requests')).toBe('1');expect(project.requirementsError).toBeUndefined();expect(project.brief).toEqual({...brief,title:'新的小纸片'});expect(project.revision).toBe(2);expect(project.handoffRevision).toBe(2);expect(project.chatReply).toContain('想法整理好了');expect(project.runs).toEqual([])
 })
})

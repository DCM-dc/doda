import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chromium, type Browser } from 'playwright'
import { Store } from '../server/store'
import type { Project } from '../server/contracts'

let browser:Browser
let root='',base='',child:ChildProcess|undefined,closed:Promise<unknown>,projects:Project[]=[]
async function file(index:number,path:string,value:string){const target=join(root,'projects',projects[index].id,'current',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,value)}
beforeAll(async()=>{
  browser=await chromium.launch({headless:true});root=await mkdtemp(join(tmpdir(),'doda-preview-component-'));const store=new Store(root);await store.load()
  for(let index=0;index<9;index++){const project=store.create('warm-paper');projects.push(project);await mkdir(store.files(project.id),{recursive:true})}await store.save()
  for(let index=0;index<8;index++){
    await file(index,'app.js','App({globalData:{}})');await file(index,'app.wxss','page{color:#333}')
    await file(index,'app.json',JSON.stringify({pages:['pages/home/index'],usingComponents:index===2?{'global-pane':'/components/pane/index'}:{}}))
    const mapping=index===0?'/components/pane/index':index===1?'../../components/pane/index':index===3?'../../../private':index===4?'plugin://remote/pane':index===5?'/components/missing/index':index===6?'/components/plain/index':'/components/wrapper/index'
    await file(index,'pages/home/index.json',JSON.stringify({usingComponents:index===2?{}:{'small-pane':mapping}}))
    await file(index,'pages/home/index.wxml',index===2?'<global-pane label="全局窗"/>':'<small-pane label="小窗"/>')
    await file(index,'pages/home/index.js','Page({data:{}})');await file(index,'pages/home/index.wxss','.page{padding:10rpx}')
    await file(index,'components/pane/index.json','{"component":true}');await file(index,'components/pane/index.js','Component({properties:{label:String},data:{open:false},methods:{toggle(){this.setData({open:!this.data.open})}}})');await file(index,'components/pane/index.wxml','<text>{{label}}</text><button bindtap="toggle">{{open?"已开":"开窗"}}</button>');await file(index,'components/pane/index.wxss','button{border-radius:10rpx}')
  }
  await file(6,'components/plain/index.json','{"component":false}')
  await file(7,'components/wrapper/index.json','{"component":true,"usingComponents":{"inner-pane":"../pane/index"}}');await file(7,'components/wrapper/index.js','Component({properties:{label:String}})');await file(7,'components/wrapper/index.wxml','<inner-pane label="{{label}}"/>');await file(7,'components/wrapper/index.wxss','')
  await file(8,'app.js','App({})');await file(8,'app.json','{"pages":["pages/home/index"]}');await file(8,'app.wxss','');await file(8,'pages/home/index.json','{"usingComponents":{"letter":"/components/letter/index"}}');await file(8,'pages/home/index.js','Page({data:{cover:"晚一点拆也可以",content:"光还在窗边"}})');await file(8,'pages/home/index.wxml','<letter><text slot="cover">{{cover}}</text><text slot="content">{{content}}</text></letter>');await file(8,'pages/home/index.wxss','');await file(8,'components/letter/index.json','{"component":true}');await file(8,'components/letter/index.js','Component({options:{multipleSlots:true},data:{open:false},methods:{toggle(){this.setData({open:!this.data.open})}}})');await file(8,'components/letter/index.wxml','<slot name="cover"/><view wx:if="{{open}}"><slot name="content"/></view><button bindtap="toggle">{{open?"合上":"拆开"}}</button>');await file(8,'components/letter/index.wxss','')
  const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const address=listener.address();if(!address||typeof address==='string')throw new Error('UNIT_PORT_MISSING');base=`http://127.0.0.1:${address.port}/api`;await new Promise<void>(done=>listener.close(()=>done()))
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:resolve('.'),env:{...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'',MIMO_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});closed=once(child,'exit');child.stdout?.resume();let errors='';child.stderr?.on('data',bytes=>{errors+=String(bytes)})
  await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('UNIT_BACKEND_CLOSED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{await browser?.close();if(child?.exitCode===null)child.kill();if(closed)await closed;if(root){const target=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(target)||target.startsWith('..')||!target.startsWith('doda-preview-component-'))throw new Error('INVALID_UNIT_CLEANUP');await rm(root,{recursive:true,force:true})}})
async function response(index:number){return fetch(base+'/projects/'+projects[index].id+'/preview')}

describe('Actual preview HTTP loads the native component graph',()=>{
  it.each([0,1,2,7])('project %s renders an absolute, relative, global or nested native component',async index=>{const result=await response(index);expect(result.status).toBe(200);expect(result.headers.get('content-security-policy')).toContain("connect-src 'none'");const page=await browser.newPage({viewport:{width:393,height:852}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());try{await page.setContent(await result.text());expect(await page.locator('html').getAttribute('data-engine')).toBe('glass-easel');const button=page.getByRole('button',{name:'开窗',exact:true});expect(await button.count()).toBe(1);await button.click();expect(await page.getByRole('button',{name:'已开',exact:true}).count()).toBe(1);expect(await page.locator('#mini-content').innerText()).toContain(index===2?'全局窗':'小窗');expect(errors).toEqual([])}finally{await page.close()}})
  it.each([[3,'PREVIEW_COMPONENT_PATH_OUTSIDE_PROJECT'],[4,'PREVIEW_INVALID_COMPONENT_PATH'],[5,'ENOENT'],[6,'PREVIEW_COMPONENT_NOT_REGISTERED']])('project %s explicitly rejects malformed or missing component %s',async(index,code)=>{const result=await response(index as number);expect(result.status).toBe(422);expect((await result.json()).error).toContain(code)})
  it.each([0,1,2])('actual HTTP projects the supplied cover and body after %s taps',async taps=>{const before=await(await fetch(base+'/state')).json(),result=await response(8);expect(result.status).toBe(200);const page=await browser.newPage({viewport:{width:393,height:852}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());try{await page.setContent(await result.text());for(let tap=0;tap<taps;tap++)await page.locator('#mini-content button').click();expect(await page.locator('#mini-content button').innerText()).toBe(taps===1?'合上':'拆开');expect((await page.locator('#mini-content').textContent())!.trim()).toBe(taps===1?'晚一点拆也可以光还在窗边合上':'晚一点拆也可以拆开');expect(await(await fetch(base+'/state')).json()).toEqual(before);expect(errors).toEqual([])}finally{await page.close()}})
  it('preview source reads preserve the native files and start no coding task',async()=>{const before=await readFile(join(root,'projects',projects[0].id,'current','components/pane/index.js'),'utf8');expect((await response(0)).status).toBe(200);expect(await readFile(join(root,'projects',projects[0].id,'current','components/pane/index.js'),'utf8')).toBe(before);const state=await(await fetch(base+'/state')).json();expect(state.projects).toHaveLength(9);expect(state.projects.every((project:Project)=>!project.runs.length)).toBe(true);expect(state.settings.deepseekConfigured).toBe(false);expect(state.settings.mimoConfigured).toBe(false)})
})

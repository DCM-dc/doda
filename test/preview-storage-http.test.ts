import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Store } from '../server/store'
import type { Project } from '../server/contracts'
let root='',base='',child:ChildProcess|undefined,closed:Promise<unknown>,projects:Project[]=[]
beforeAll(async()=>{
 root=await mkdtemp(join(tmpdir(),'doda-preview-remove-'));const store=new Store(root);await store.load()
 for(let index=0;index<4;index++){const project=store.create('mint-garden');projects.push(project);await mkdir(join(root,'projects',project.id),{recursive:true})}await store.save()
 const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const address=listener.address();if(!address||typeof address==='string')throw new Error('UNIT_PORT_MISSING');base=`http://127.0.0.1:${address.port}/api`;await new Promise<void>(done=>listener.close(()=>done()))
 child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:resolve('.'),env:{...process.env,DODA_PRODUCTION:'1',DODA_DATA:root,DODA_PORT:String(address.port),DEEPSEEK_API_KEY:'',MIMO_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});closed=once(child,'exit');child.stdout?.resume();let errors='';child.stderr?.on('data',bytes=>{errors+=String(bytes)})
 await vi.waitFor(async()=>{if(child?.exitCode!==null)throw new Error('UNIT_BACKEND_CLOSED: '+errors);expect((await fetch(base+'/health')).status).toBe(200)},{timeout:20000,interval:100})
},30000)
afterAll(async()=>{if(child?.exitCode===null)child.kill();if(closed)await closed;if(root){const target=relative(resolve(tmpdir()),resolve(root));if(isAbsolute(target)||target.startsWith('..')||!target.startsWith('doda-preview-remove-'))throw new Error('INVALID_UNIT_CLEANUP');await rm(root,{recursive:true,force:true})}})
async function request(index:number,body:unknown){return fetch(base+'/projects/'+projects[index].id+'/preview-storage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
async function stored(index:number){return JSON.parse(await readFile(join(root,'projects',projects[index].id,'preview-storage.json'),'utf8'))}
describe('Actual preview storage HTTP removal',()=>{
 it('deletes the requested key while retaining unrelated arrays and null values',async()=>{
  for(const [key,value]of [['walk',['sky']],['other',['saved']],['nullable',null]])expect((await request(0,{key,value})).status).toBe(200)
  expect((await request(0,{key:'walk',remove:true})).status).toBe(200);expect(await stored(0)).toEqual({other:['saved'],nullable:null})
 })
 it('removes absent keys repeatedly without deleting another key',async()=>{
  expect((await request(1,{key:'other',value:2})).status).toBe(200)
  for(let attempt=0;attempt<2;attempt++)expect((await request(1,{key:'absent',remove:true})).status).toBe(200)
  expect(await stored(1)).toEqual({other:2})
 })
 it('keeps null distinct from deletion and rejects missing set values or nonboolean removal flags',async()=>{
  expect((await request(2,{key:'walk',value:null})).status).toBe(200);expect(await stored(2)).toEqual({walk:null})
  expect((await request(2,{key:'walk'})).status).toBe(422);expect((await request(2,{key:'walk',remove:'true'})).status).toBe(400);expect((await request(2,{key:'',remove:true})).status).toBe(400);expect(await stored(2)).toEqual({walk:null})
 })
 it('persists the final set-remove sequence and starts no native task',async()=>{
  for(let value=1;value<=3;value++){expect((await request(3,{key:'walk',value:[value]})).status).toBe(200);expect((await request(3,{key:'walk',remove:true})).status).toBe(200);expect(await stored(3)).toEqual({})}
  const state=await(await fetch(base+'/state')).json();expect(state.projects).toHaveLength(4);expect(state.projects.every((project:Project)=>!project.runs.length)).toBe(true);expect(state.settings.deepseekConfigured).toBe(false);expect(state.settings.mimoConfigured).toBe(false)
 })
})

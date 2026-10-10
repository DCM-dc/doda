import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {createInstance} from 'i18next'
import {I18nextProvider} from 'react-i18next'
import {JSDOM} from 'jsdom'
import {App} from '../src/ui/App'
import type {Project} from '../server/contracts'

type AudioRequest={signal:AbortSignal,startedAt:number,text:string,aborted:boolean,releaseHeaders?:()=>void,finishBody?:()=>void}
type Player={src:string,play:ReturnType<typeof vi.fn>,pause:ReturnType<typeof vi.fn>,onended?:()=>void,onerror?:()=>void}
let dom:JSDOM,root:Root,client:QueryClient,project:Project,mode:'headers'|'body'|'ready'|'delayed-body',done:boolean,requests:AudioRequest[],players:Player[],chats:unknown[],tracksStopped:number,port:{onmessage?: (event:{data:Float32Array})=>void}
const settings={model:'fixture-model',voice:'苏打',speak:false,talkLevel:'standard',deepseekConfigured:true,mimoConfigured:true},designs=[{id:'mint-garden',name:'薄荷',description:'',version:1,source:'fixture',tokens:{background:'#f0f6f2',surface:'#ffffff',text:'#263d32',muted:'#6a8376',accent:'#36896b',radius:22}}]
beforeEach(async()=>{
 vi.useFakeTimers();mode='headers';done=false;requests=[];players=[];chats=[];tracksStopped=0;port={}
 dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('navigator',dom.window.navigator);vi.stubGlobal('HTMLElement',dom.window.HTMLElement);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});dom.window.HTMLElement.prototype.scrollIntoView=function(){}
 const track={stop(){tracksStopped++},onended:undefined},stream={getTracks:()=>[track],getAudioTracks:()=>[track]},graph={connect(){}},context={sampleRate:16000,resume:async()=>{},close:async()=>{},createMediaStreamSource:()=>graph,createGain:()=>({connect(){},gain:{value:0}}),destination:{},audioWorklet:{addModule:async()=>{}}}
 Object.defineProperty(dom.window.navigator,'mediaDevices',{value:{getUserMedia:async()=>stream}});vi.stubGlobal('AudioContext',function AudioContext(){return context});const Worklet=function AudioWorkletNode(){return{port,connect(){},onprocessorerror:undefined}};vi.stubGlobal('AudioWorkletNode',Worklet);Object.defineProperty(dom.window,'AudioWorkletNode',{value:Worklet})
 vi.stubGlobal('Audio',function Audio(src:string){const player:Player={src,play:vi.fn(async()=>{}),pause:vi.fn()};players.push(player);return player})
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Audio preparation timed out','TimeoutError')),ms);return controller.signal})
 project={id:'voice-probe',name:'已有作品',createdAt:'',updatedAt:'',phase:'explore',revision:0,designId:'mint-garden',messages:[{id:'welcome',role:'assistant',content:'我们接着聊。',time:''}],runs:[],inspirations:[],archive:{highlights:'',interview:''}}
 vi.stubGlobal('fetch',async(input:string,options?:RequestInit)=>{
  if(input==='/api/state')return Response.json({projects:[project],designs,settings})
  if(/^\/api\/projects\/voice-probe\/(files|pages)$/.test(input))return Response.json([])
  if(input==='/api/asr')return Response.json({text:'继续陪我聊，不改作品。',engine:'fixture'})
  if(input==='/api/projects/voice-probe/chat'){
   const body=JSON.parse(String(options?.body));chats.push(structuredClone(body));project.messages.push({id:'user-'+chats.length,role:'user',content:body.text,time:''},{id:'reply-'+chats.length,role:'assistant',content:done?'下次再聊。':'眼睛和手指一起走，那一小下就够了。',time:''});return Response.json({...project,chatReply:project.messages.at(-1)!.content,voiceDone:done})
  }
  if(input==='/api/tts'){
   const signal=options!.signal as AbortSignal;signal.throwIfAborted();const request:AudioRequest={signal,startedAt:Date.now(),text:JSON.parse(String(options!.body)).text,aborted:false};requests.push(request)
   if(mode==='ready')return new Response(new Blob(['audio'],{type:'audio/wav'}))
   if(mode==='headers')return new Promise<Response>((resolve,reject)=>{function abort(){request.aborted=true;reject(signal.reason)}signal.addEventListener('abort',abort,{once:true});request.releaseHeaders=()=>{signal.removeEventListener('abort',abort);resolve(new Response(new Blob(['audio'],{type:'audio/wav'})))}})
   let controller!:ReadableStreamDefaultController<Uint8Array>;function abort(){request.aborted=true;controller.error(signal.reason)}const stream=new ReadableStream<Uint8Array>({start(value){controller=value}});signal.addEventListener('abort',abort,{once:true});request.finishBody=()=>{signal.removeEventListener('abort',abort);controller.enqueue(new Uint8Array([1,2,3]));controller.close()};const response=new Response(stream,{headers:{'Content-Type':'audio/wav'}})
   if(mode==='delayed-body')return new Promise<Response>((resolve,reject)=>{function abortHeaders(){reject(signal.reason)}signal.addEventListener('abort',abortHeaders,{once:true});request.releaseHeaders=()=>{signal.removeEventListener('abort',abortHeaders);resolve(response)}})
   return response
  }
  throw new Error('Unexpected UI unit network boundary '+input)
 })
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});client.setQueryData(['doda-state'],{projects:[project],designs,settings});const translations=createInstance();await translations.init({lng:'zh-CN',resources:{'zh-CN':{translation:{}}}});root=createRoot(dom.window.document.getElementById('root')!)
 await act(async()=>{root.render(createElement(QueryClientProvider,{client},createElement(I18nextProvider,{i18n:translations},createElement(App))));await vi.advanceTimersByTimeAsync(0)})
})
afterEach(async()=>{await act(async()=>{root?.unmount();client?.clear();await vi.advanceTimersByTimeAsync(0)});dom?.window.close();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
function phase(){return dom.window.document.querySelector('.voice-status')?.textContent}
async function tick(ms=0){await act(async()=>{await vi.advanceTimersByTimeAsync(ms)})}
async function click(text:string,aria=false){const button=Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(button=>aria?button.getAttribute('aria-label')===text:button.textContent===text);expect(button,text).not.toBeUndefined();await act(async()=>{button!.click();await vi.advanceTimersByTimeAsync(0)})}
async function start(){await click('voice.start',true);expect(phase()).toBe('voice.listening')}
async function say(){await act(async()=>{expect(port.onmessage).toBeTypeOf('function');for(let i=0;i<7;i++)port.onmessage!({data:new Float32Array(1600).fill(.04)});for(let i=0;i<12;i++)port.onmessage!({data:new Float32Array(1600)});await vi.advanceTimersByTimeAsync(0)})}
async function elapsed(request:AudioRequest,ms:number){await tick(Math.max(0,request.startedAt+ms-Date.now()))}

describe('Continuous voice waits a bounded time for audio preparation',()=>{
 it('returns to the same microphone at fifteen seconds when audio headers never arrive',async()=>{await start();await say();expect(requests).toHaveLength(1);const request=requests[0];await elapsed(request,14999);expect(phase()).toBe('voice.speaking');expect(request.aborted).toBe(false);await elapsed(request,15000);expect(request.aborted).toBe(true);expect(phase()).toBe('voice.listening');expect(tracksStopped).toBe(0);expect(chats).toHaveLength(1);expect(players).toEqual([]);expect(dom.window.document.body.textContent).toContain('voice.playError');expect(dom.window.document.body.textContent).toContain('眼睛和手指一起走，那一小下就够了。')})
 it('bounds audio body download as well as the response headers',async()=>{mode='body';await start();await say();await elapsed(requests[0],15000);expect(requests[0].aborted).toBe(true);expect(phase()).toBe('voice.listening');expect(players).toEqual([]);expect(chats).toHaveLength(1)})
 it('uses one preparation deadline across delayed headers and body download',async()=>{mode='delayed-body';await start();await say();await elapsed(requests[0],14000);await act(async()=>{requests[0].releaseHeaders!();await vi.advanceTimersByTimeAsync(0)});await elapsed(requests[0],15000);expect(requests[0].aborted).toBe(true);expect(phase()).toBe('voice.listening');expect(players).toEqual([])})
 it('does not cut off completed audio after the preparation deadline passes',async()=>{mode='ready';await start();await say();expect(players).toHaveLength(1);await tick(30000);expect(phase()).toBe('voice.speaking');expect(players[0].pause).not.toHaveBeenCalled();await act(async()=>{players[0].onended!();await vi.advanceTimersByTimeAsync(0)});expect(phase()).toBe('voice.listening');expect(tracksStopped).toBe(0)})
 it('accepts a new automatically submitted utterance after a preparation timeout',async()=>{await start();await say();await elapsed(requests[0],15000);mode='ready';await say();expect(chats).toHaveLength(2);expect(requests).toHaveLength(2);expect(players).toHaveLength(1);expect(tracksStopped).toBe(0);await act(async()=>{players[0].onended!();await vi.advanceTimersByTimeAsync(0)});expect(phase()).toBe('voice.listening')})
 it('closes voice after an unheard goodbye times out while preserving its text',async()=>{done=true;await start();await say();await elapsed(requests[0],15000);expect(phase()).toBe('voice.off');expect(tracksStopped).toBe(1);expect(chats).toHaveLength(1);expect(dom.window.document.body.textContent).toContain('下次再聊。')})
 it('lets the visible interrupt button cancel audio preparation immediately',async()=>{await start();await say();await click('voice.interrupt');expect(requests[0].aborted).toBe(true);expect(phase()).toBe('voice.listening');await tick(20000);expect(phase()).toBe('voice.listening');expect(tracksStopped).toBe(0);expect(chats).toHaveLength(1)})
 it('ending voice cancels preparation and never reopens the old microphone',async()=>{await start();await say();await click('voice.end');expect(requests[0].aborted).toBe(true);expect(phase()).toBe('voice.off');expect(tracksStopped).toBe(1);await tick(20000);expect(phase()).toBe('voice.off');expect(chats).toHaveLength(1)})
 it('keeps an explicit manual read request outside the continuous-voice preparation budget',async()=>{await click('chat.read',true);expect(requests).toHaveLength(1);await elapsed(requests[0],30000);expect(requests[0].aborted).toBe(false);expect(phase()).toBe('chat.read');await act(async()=>{requests[0].releaseHeaders!();await vi.advanceTimersByTimeAsync(0)});expect(players).toHaveLength(1);await act(async()=>{players[0].onended!();await vi.advanceTimersByTimeAsync(0)});expect(chats).toEqual([]);expect(tracksStopped).toBe(0)})
 it('idle listening is not timed out before a reply needs audio',async()=>{await start();await tick(60000);expect(phase()).toBe('voice.listening');expect(requests).toEqual([]);expect(chats).toEqual([]);expect(tracksStopped).toBe(0)})
})

describe('Manual reading can be stopped from the voice home',()=>{
 function stopButton(){return Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('.voice-controls button')).find(button=>button.textContent==='chat.stopRead')||null}
 it('exposes a stop control during preparation and cancels the request without opening a microphone',async()=>{await click('chat.read',true);expect(phase()).toBe('chat.read');expect(dom.window.document.querySelector('.voice-orb-button')!.classList.contains('speaking')).toBe(true);await click('chat.stopRead');expect(requests[0].aborted).toBe(true);expect(players).toEqual([]);expect(phase()).toBe('voice.off');expect(stopButton()).toBeNull();expect(chats).toEqual([]);expect(tracksStopped).toBe(0)})
 it('stops already playing manual audio and removes the active reading feedback',async()=>{mode='ready';await click('chat.read',true);expect(players).toHaveLength(1);expect(phase()).toBe('chat.read');await click('chat.stopRead');expect(players[0].pause).toHaveBeenCalled();expect(phase()).toBe('voice.off');expect(stopButton()).toBeNull();expect(dom.window.document.querySelector('.voice-orb-button')!.classList.contains('speaking')).toBe(false);expect(chats).toEqual([]);expect(tracksStopped).toBe(0)})
 it('finishing manual audio restores idle voice home without a stop control',async()=>{mode='ready';await click('chat.read',true);expect(stopButton()).not.toBeNull();await act(async()=>{players[0].onended!();await vi.advanceTimersByTimeAsync(0)});expect(phase()).toBe('voice.off');expect(stopButton()).toBeNull();expect(tracksStopped).toBe(0)})
 it('continuous voice keeps its conversational interrupt control without a manual-reading stop',async()=>{mode='ready';await start();await say();expect(phase()).toBe('voice.speaking');expect(stopButton()).toBeNull();await click('voice.interrupt');expect(phase()).toBe('voice.listening');expect(tracksStopped).toBe(0);expect(players[0].pause).toHaveBeenCalled();expect(chats).toHaveLength(1)})
 it('stopping and restarting in one task preserves the new reader while old cleanup settles',async()=>{mode='ready';await click('chat.read',true);const stop=stopButton(),read=Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.getAttribute('aria-label')==='chat.read');expect(stop).not.toBeNull();expect(read).not.toBeUndefined();await act(async()=>{stop!.click();read!.click();await vi.advanceTimersByTimeAsync(0)});expect(players).toHaveLength(2);await act(async()=>{players[0].onended!();await vi.advanceTimersByTimeAsync(0)});expect(phase()).toBe('chat.read');expect(stopButton()).not.toBeNull();expect(players[1].pause).not.toHaveBeenCalled();await click('chat.stopRead');expect(players[1].pause).toHaveBeenCalled();expect(phase()).toBe('voice.off')})
})

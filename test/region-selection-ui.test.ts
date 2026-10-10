import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {QueryClient,QueryClientProvider,notifyManager} from '@tanstack/react-query'
import {createInstance} from 'i18next'
import {I18nextProvider} from 'react-i18next'
import {JSDOM,VirtualConsole} from 'jsdom'
import {App} from '../src/ui/App'
import type {Project} from '../server/contracts'

let dom:JSDOM,root:Root,client:QueryClient,project:Project,iframe:HTMLIFrameElement,requests:unknown[],errors:string[]
beforeEach(async()=>{
 errors=[];requests=[];const consolePort=new VirtualConsole();consolePort.on('jsdomError',error=>errors.push(error.message));consolePort.on('error',(...values)=>errors.push(values.map(String).join(' ')))
 dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',virtualConsole:consolePort})
 vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('navigator',dom.window.navigator);vi.stubGlobal('HTMLElement',dom.window.HTMLElement);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});dom.window.HTMLElement.prototype.scrollIntoView=function(){}
 project={id:'letter',name:'小信',createdAt:'',updatedAt:'',phase:'refine',revision:1,designId:'paper',brief:{title:'小信',audience:'自己',purpose:'拆开看',features:['信封'],pages:['首页'],acceptance:['开合'],deferred:[],designId:'paper'},messages:[],runs:[],inspirations:[],archive:{highlights:'',interview:''}}
 const designs=[{id:'paper',name:'纸间',description:'纸色',tokens:{background:'#fff',surface:'#fff',text:'#333',muted:'#777',accent:'#975',radius:12}}],settings={model:'deepseek-flash',voice:'苏打',speak:false,talkLevel:'standard',deepseekConfigured:true,mimoConfigured:false}
 vi.stubGlobal('fetch',async(input:string,options?:RequestInit)=>{
  if(input==='/api/state')return Response.json({projects:[project],designs,settings})
  if(input==='/api/projects/letter/files')return Response.json(['app.js','pages/home/index.wxml','components/letter/index.wxml','components/badge/index.wxml'])
  if(input.startsWith('/api/projects/letter/preview-state?'))return Response.json({revision:'fixture',pages:['pages/home/index'],available:true,live:false})
  if(input==='/api/projects/letter/pages')return Response.json(['pages/home/index'])
  if(input==='/api/projects/letter/chat'&&options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return Response.json({...project,chatReply:'好，我们聊这一处。'})}
  throw new Error('Unexpected region UI boundary: '+input)
 })
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});client.setQueryData(['doda-state'],{projects:[project],designs,settings})
 const translations=createInstance();await translations.init({lng:'zh-CN',resources:{'zh-CN':{translation:{'chat.region':'正在讨论选中的区域'}}}});root=createRoot(dom.window.document.getElementById('root')!)
 await act(async()=>{root.render(createElement(QueryClientProvider,{client},createElement(I18nextProvider,{i18n:translations},createElement(App))));await new Promise<void>(done=>notifyManager.schedule(done))})
 await act(async()=>{await new Promise<void>(done=>notifyManager.schedule(done))})
 iframe=dom.window.document.querySelector<HTMLIFrameElement>('iframe')!;expect(iframe).not.toBeNull()
})
afterEach(async()=>{await act(async()=>{root?.unmount();client?.clear();await new Promise<void>(done=>notifyManager.schedule(done))});dom?.window.close();vi.unstubAllGlobals();vi.restoreAllMocks();expect(errors).toEqual([])})
function button(label:string){const element=Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(element=>element.textContent?.trim()===label||element.getAttribute('aria-label')===label);expect(element,label).not.toBeUndefined();return element!}
async function click(element:HTMLElement){await act(async()=>{element.click();await new Promise<void>(done=>notifyManager.schedule(done))})}
async function selection(data:Record<string,unknown>,source:Window=iframe.contentWindow!){await act(async()=>{dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source,data:{type:'doda-region',...data}}));await new Promise<void>(done=>notifyManager.schedule(done))})}
function chip(){return dom.window.document.querySelector('.region-chip')}
describe('Selected preview content supplies a native source context to chat',()=>{
 it('does not attach a stale screenshot while the preview is reloading a new revision',async()=>{const post=vi.spyOn(iframe.contentWindow!,'postMessage');await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));await click(button('common.refresh'));expect(iframe.dataset.loaded).not.toBe(iframe.src);await click(button('chat.summarize'));expect(post.mock.calls).toEqual([[{type:'doda-preview-device',id:'iphone-15-pro'},'*']]);expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true}])})
 it('captures the visible iframe state before forwarding a selected-region message',async()=>{const data='data:image/png;base64,AA==',post=vi.spyOn(iframe.contentWindow!,'postMessage');await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));await selection({file:'components/letter/index.wxml',classes:'action',text:'合上'});await click(button('chat.summarize'));expect(requests).toEqual([]);const request=post.mock.calls.find(([message])=>message?.type==='doda-preview-capture')![0];expect(request.id).toBeTypeOf('string');await selection({type:'doda-preview-captured',id:request.id,data,page:'pages/home/index'},dom.window as unknown as Window);expect(requests).toEqual([]);await selection({type:'doda-preview-captured',id:'wrong',data,page:'pages/home/index'});expect(requests).toEqual([]);await selection({type:'doda-preview-captured',id:request.id,data,page:'pages/home/index'});await vi.waitFor(()=>expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true,region:'components/letter/index.wxml [action]：合上',image:{data,page:'pages/home/index'}}]))})
 it('continues a text message when the current iframe reports capture failure',async()=>{const post=vi.spyOn(iframe.contentWindow!,'postMessage');await act(async()=>iframe.dispatchEvent(new dom.window.Event('load')));await click(button('chat.summarize'));const request=post.mock.calls.find(([message])=>message?.type==='doda-preview-capture')![0];await selection({type:'doda-preview-captured',id:request.id,error:'PREVIEW_CAPTURE_FAILED'});await vi.waitFor(()=>expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true}]))})
 it('forwards the component source and native class through the actual App chat mutation',async()=>{await selection({file:'components/letter/index.wxml',classes:'action',text:'合上'});await click(button('chat.summarize'));expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true,region:'components/letter/index.wxml [action]：合上'}]);expect(chip()).toBeNull()})
 it('shows the selected words while keeping paths and style names out of the user flow',async()=>{await selection({file:'components/letter/index.wxml',classes:'action',text:'合上'});expect(chip()?.querySelector('span')?.textContent).toBe('正在讨论选中的区域：合上');expect(chip()?.textContent).not.toContain('index.wxml');expect(chip()?.textContent).not.toContain('action')})
 it('keeps the preview visible after selecting a local region',async()=>{await selection({file:'components/letter/index.wxml',classes:'action',text:'合上'});expect(dom.window.document.querySelectorAll('[role="tab"]')).toHaveLength(0);expect(dom.window.document.querySelector('.preview-only')).not.toBeNull();expect(dom.window.document.querySelector('iframe')).toBe(iframe)})
 it('retains the page author source for projected cover text',async()=>{await selection({file:'pages/home/index.wxml',classes:'cover-text',text:'晚一点拆也可以'});await click(button('chat.summarize'));expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true,region:'pages/home/index.wxml [cover-text]：晚一点拆也可以'}])})
 it('retains the nested component author source',async()=>{await selection({file:'components/badge/index.wxml',classes:'badge',text:'标记'});await click(button('chat.summarize'));expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true,region:'components/badge/index.wxml [badge]：标记'}])})
 it('ignores a source message from outside the current preview iframe',async()=>{await selection({file:'components/letter/index.wxml',classes:'action',text:'外来的选区'},dom.window as unknown as Window);expect(chip()).toBeNull();expect(requests).toEqual([])})
 it.each(['components/missing/index.wxml','../pages/home/index.wxml','app.js',undefined,42])('rejects an unknown or non-WXML author file %s',async file=>{await selection({file,classes:'action',text:'无效选区'});expect(chip()).toBeNull();expect(requests).toEqual([])})
 it('bounds literal text and native classes before supplying the chat context',async()=>{await selection({file:'components/letter/index.wxml',classes:'类'.repeat(100),text:'字'.repeat(180)});expect(chip()?.querySelector('span')?.textContent).toBe('正在讨论选中的区域：'+'字'.repeat(160));await click(button('chat.summarize'));expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true,region:'components/letter/index.wxml ['+'类'.repeat(80)+']：'+'字'.repeat(160)}])})
 it('keeps a blank visual region selectable without exposing an empty implementation label',async()=>{await selection({file:'components/letter/index.wxml',classes:'circle',text:''});expect(chip()?.querySelector('span')?.textContent).toBe('正在讨论选中的区域');await click(button('chat.summarize'));expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true,region:'components/letter/index.wxml [circle]：'}])})
 it('clears the chosen source when the user cancels the selection',async()=>{await selection({file:'components/letter/index.wxml',classes:'action',text:'合上'});await click(button('chat.clearRegion'));expect(chip()).toBeNull();await click(button('chat.summarize'));expect(requests).toEqual([{text:'chat.summarize',summarize:true,allowHandoff:true}])})
})

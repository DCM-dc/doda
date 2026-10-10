import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { JSDOM } from 'jsdom'
import { App } from '../src/ui/App'
import type { Project } from '../server/contracts'

let dom: JSDOM, root: Root, client: QueryClient, project: Project, projects: Project[], requests: unknown[], release: (value: Response) => void, releaseState: () => void, defer = false, deferState = false
const designs = [
  { id: 'warm-paper', name: '纸间', description: '纸色', tokens: { background: '#f6f2eb', surface: '#fffdf8', text: '#37332e', muted: '#857d72', accent: '#b66b44', radius: 14 } },
  { id: 'mint-garden', name: '薄荷', description: '绿', tokens: { background: '#eff7f1', surface: '#ffffff', text: '#273d32', muted: '#75867d', accent: '#36896b', radius: 18 } },
  { id: 'soft-blue', name: '晴空', description: '蓝', tokens: { background: '#f6f8fc', surface: '#ffffff', text: '#20242c', muted: '#7a8494', accent: '#4d6bfe', radius: 18 } },
]
beforeEach(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }); requests = []; defer = false; deferState = false
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('HTMLElement', dom.window.HTMLElement); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }); dom.window.HTMLElement.prototype.scrollIntoView = function () {}
  project = { id: 'source', name: '旧纸片', createdAt: '', updatedAt: '', phase: 'done', revision: 1, designId: 'warm-paper', brief: { title: '旧纸片', audience: '自己', purpose: '一行字', features: ['折叠'], pages: ['首页'], acceptance: ['不存储'], deferred: [], designId: 'warm-paper' }, messages: [{ id: 'welcome', role: 'assistant', content: '旧的对话', time: '' }], runs: [], inspirations: [], archive: { highlights: '', interview: '' } }
  projects = [project]
  const settings = { model: 'deepseek-flash', voice: '苏打', speak: false, talkLevel: 'standard', deepseekConfigured: true, mimoConfigured: false }
  vi.stubGlobal('fetch', async (input: string, options?: RequestInit) => {
    if (input === '/api/state') { if (deferState) return new Promise<Response>(done => { releaseState = () => done(Response.json({ projects, designs, settings })) }); return Response.json({ projects, designs, settings }) }
    if (/^\/api\/projects\/(source|created|leading)\/preview-state\?/.test(input)) return Response.json({revision:'fixture',pages:[],available:false,live:false})
    if (/^\/api\/projects\/(source|created|leading)\/(files|pages)$/.test(input)) return Response.json([])
    if (input === '/api/projects/source/preview-storage' && options?.method === 'POST') { requests.push(JSON.parse(String(options.body))); return Response.json({ ok: true }) }
    if (input === '/api/projects' && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)); requests.push(structuredClone(body))
      const created: Project = { ...structuredClone(project), id: 'created', name: '新的小点子', designId: body.designId, brief: undefined, phase: 'explore', revision: 0, messages: [{ id: 'new-welcome', role: 'assistant', content: '新的对话', time: '' }] }
      projects = [created, ...projects]; if (defer) return new Promise<Response>(done => { release = done }); return Response.json(created)
    }
    throw new Error('Unexpected UI unit boundary: ' + input)
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); client.setQueryData(['doda-state'], { projects, designs, settings })
  const translations = createInstance(); await translations.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: {} } } }); root = createRoot(dom.window.document.getElementById('root')!)
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(I18nextProvider, { i18n: translations }, createElement(App)))); await new Promise<void>(done => notifyManager.schedule(done)) })
})
afterEach(async () => { await act(async () => { root?.unmount(); client?.clear(); await new Promise<void>(done => notifyManager.schedule(done)) }); dom?.window.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function button(text: string) { const element = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(element => element.textContent?.trim() === text); expect(element, text).not.toBeUndefined(); return element! }
async function click(element: HTMLElement) { await act(async () => { element.click(); await new Promise<void>(done => notifyManager.schedule(done)) }) }
async function changeInternalStyle(id: string) { await act(async () => { client.setQueryData(['doda-state'], (state: { projects: Project[] }) => ({ ...state, projects: state.projects.map(value => value.id === 'source' ? { ...value, designId:id, brief:{...value.brief!,designId:id} } : value) })); await new Promise<void>(done=>notifyManager.schedule(done)) }) }

describe('A style agreed in chat is reused internally without a style picker', () => {
  it('forwards an iframe single-key removal for the current project', async () => {
    const iframe=dom.window.document.querySelector<HTMLIFrameElement>('iframe')!; expect(iframe).not.toBeNull()
    await act(async()=>{dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:iframe.contentWindow!,data:{type:'doda-preview-storage',key:'walk',remove:true}}));await new Promise<void>(done=>notifyManager.schedule(done))});await vi.waitFor(()=>expect(requests).toEqual([{key:'walk',remove:true}]))
  })
  it('preserves a null storage value when removal is not true', async () => {
    const iframe=dom.window.document.querySelector<HTMLIFrameElement>('iframe')!; expect(iframe).not.toBeNull()
    await act(async()=>{dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:iframe.contentWindow!,data:{type:'doda-preview-storage',key:'other',value:null,remove:'false'}}));await new Promise<void>(done=>notifyManager.schedule(done))});await vi.waitFor(()=>expect(requests).toEqual([{key:'other',value:null}]))
  })
  it('creates a new idea with the style agreed in chat without overwriting the old project', async () => {
    const original=structuredClone(project);await changeInternalStyle('mint-garden');await click(button('nav.new'));expect(requests).toEqual([{designId:'mint-garden'}]);expect(project).toEqual(original);expect(dom.window.document.querySelector('.project-link.selected')?.getAttribute('title')).toBe('新的小点子');expect(dom.window.document.querySelector('.messages')?.textContent).toContain('新的对话')
  })
  it('carries forward the saved paper design when chat has not changed it', async () => {await click(button('nav.new'));expect(requests).toEqual([{designId:'warm-paper'}]);expect(project.brief?.designId).toBe('warm-paper')})
  it('uses the latest agreed style after two internal updates', async () => {await changeInternalStyle('soft-blue');await changeInternalStyle('mint-garden');await click(button('nav.new'));expect(requests).toEqual([{designId:'mint-garden'}]);expect(project.brief?.designId).toBe('warm-paper')})
  it('exposes one preview with a device selector and no design, source or history tabs', async () => {expect(dom.window.document.querySelectorAll('.artifact-panel')).toHaveLength(1);expect(dom.window.document.querySelectorAll('[role="tab"],.design-card,.brief-panel')).toHaveLength(0);const selector=dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="preview.device"]')!;expect(Array.from(selector.options).map(item=>item.textContent)).toEqual(['iPhone 15 Pro','iPhone 13','iPhone SE','Pixel 9']);expect(project.designId).toBe('warm-paper')})
  it('prevents duplicate project creation while the first request is pending', async () => {
    await changeInternalStyle('mint-garden');defer=true;await click(button('nav.new'));expect(button('nav.new').disabled).toBe(true);await click(button('nav.new'));expect(requests).toEqual([{designId:'mint-garden'}]);await act(async()=>{release(Response.json({...structuredClone(project),id:'created',name:'新的小点子',designId:'mint-garden',brief:undefined,phase:'explore',revision:0}));await new Promise<void>(done=>notifyManager.schedule(done))})
  })
  it('shows the confirmed new project before a delayed state refresh', async () => {
    const leading={...structuredClone(project),id:'leading',name:'另一件旧作品'};projects=[leading,project];await act(async()=>{client.setQueryData(['doda-state'],(state:object)=>({...state,projects}));await new Promise<void>(done=>notifyManager.schedule(done))});deferState=true;await click(button('nav.new'));expect(client.getQueryData<{projects:Project[]}>(['doda-state'])!.projects.map(value=>value.id)).toEqual(['created','leading','source']);expect(dom.window.document.querySelector('.project-link.selected')?.getAttribute('title')).toBe('新的小点子');expect(dom.window.document.querySelector('.messages')?.textContent).toContain('新的对话');await act(async()=>{releaseState();await new Promise<void>(done=>notifyManager.schedule(done))});expect(dom.window.document.querySelector('.project-link.selected')?.getAttribute('title')).toBe('新的小点子');expect(project.designId).toBe('warm-paper')
  })
})

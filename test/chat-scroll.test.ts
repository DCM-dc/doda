import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { JSDOM } from 'jsdom'
import { App } from '../src/ui/App'
import type { Project } from '../server/contracts'

let dom: JSDOM, root: Root, client: QueryClient, scrolls: HTMLElement[], projects: Project[], messages: HTMLElement, metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }

beforeEach(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('HTMLElement', dom.window.HTMLElement); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  scrolls = []
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this) }
  vi.stubGlobal('fetch', async (input: string) => {
    if (/^\/api\/projects\/(first|second)\/(files|pages)$/.test(input)) return new Response('[]', { headers: { 'content-type': 'application/json' } })
    throw new Error('Unexpected unit network boundary: ' + input)
  })
  projects = ['first', 'second'].map(id => ({ id, name: id, createdAt: '', updatedAt: '', phase: 'explore', revision: 0, designId: 'soft-blue', messages: Array.from({ length: 12 }, (_, index) => ({ id: id + index, role: index % 2 ? 'assistant' : 'user', content: '原话 ' + index, time: '' })), runs: [], inspirations: [], archive: { highlights: '', interview: '' } } as Project))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['doda-state'], { projects, designs: [], settings: { model: 'deepseek-flash', voice: '苏打', speak: false, talkLevel: 'standard', deepseekConfigured: true, mimoConfigured: false } })
  for (const id of ['', 'first', 'second']) { client.setQueryData(['doda-files', id, 0], []); client.setQueryData(['doda-pages', id, 0], []) }
  const translations = createInstance(); await translations.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: {} } } })
  root = createRoot(dom.window.document.getElementById('root')!)
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(I18nextProvider, { i18n: translations }, createElement(App)))) })
  messages = dom.window.document.querySelector<HTMLElement>('.messages')!
  expect(messages).not.toBeNull()
  metrics = { scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 }
  for (const key of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) Object.defineProperty(messages, key, { configurable: true, get: () => metrics[key] })
  scrolls.length = 0
})

afterEach(async () => { await act(async () => root?.unmount()); client?.clear(); dom?.window.close(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function scrollTo(top: number) { metrics.scrollTop = top; await act(async () => { messages.dispatchEvent(new dom.window.Event('scroll', { bubbles: false })) }) }
async function append(id = 'first', content = '新回复') {
  projects = projects.map(project => project.id === id ? { ...project, messages: [...project.messages, { id: id + '-reply-' + project.messages.length, role: 'assistant', content, time: '' }] } : project)
  await act(async () => { client.setQueryData(['doda-state'], (state: object) => ({ ...state, projects })); await new Promise<void>(done => notifyManager.schedule(done)) })
  const current = dom.window.document.querySelector('.project-link.selected')?.getAttribute('title')
  expect(messages.querySelectorAll('article.message')).toHaveLength(projects.find(project => project.id === current)!.messages.length)
  if (id === current) expect(messages.textContent).toContain(content)
}

describe('Conversation reading position while new messages arrive', () => {
  it('preserves an older reading position when a reply is appended', async () => {
    await scrollTo(700); await append()
    expect(scrolls).toHaveLength(0); expect(metrics.scrollTop).toBe(700); expect(messages.textContent).toContain('新回复')
  })
  it('preserves an older reading position for a delivery announcement', async () => {
    await scrollTo(700); await append('first', '作品这一版可以预览了。')
    expect(scrolls).toHaveLength(0); expect(messages.textContent).toContain('作品这一版可以预览了。')
  })
  it('follows a new reply while already reading at the bottom', async () => {
    await scrollTo(1600); await append()
    expect(scrolls).toHaveLength(1); expect(scrolls[0]).toBe(messages.lastElementChild)
  })
  it('follows a reply within the 64 pixel bottom allowance', async () => {
    await scrollTo(1536); await append()
    expect(scrolls).toHaveLength(1); expect(scrolls[0]).toBe(messages.lastElementChild)
  })
  it('keeps the reading position outside the 64 pixel bottom allowance', async () => {
    await scrollTo(1535); await append()
    expect(scrolls).toHaveLength(0); expect(metrics.scrollTop).toBe(1535)
  })
  it('resumes following after the reader scrolls back to the bottom', async () => {
    await scrollTo(700); await append(); expect(scrolls).toHaveLength(0)
    await scrollTo(1600); await append()
    expect(scrolls).toHaveLength(1); expect(scrolls[0]).toBe(messages.lastElementChild)
  })
  it('follows a short conversation that does not overflow', async () => {
    metrics.scrollHeight = 300; await scrollTo(0); await append()
    expect(scrolls).toHaveLength(1); expect(scrolls[0]).toBe(messages.lastElementChild)
  })
  it('opens the latest messages when switching to a project with the same message count', async () => {
    await scrollTo(700)
    const button = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('.project-link')).find(item => item.title === 'second')!
    expect(button).not.toBeUndefined()
    await act(async () => { button.click(); await new Promise<void>(done => notifyManager.schedule(done)) })
    expect(scrolls).toHaveLength(1); expect(scrolls[0]).toBe(messages.lastElementChild)
    expect(dom.window.document.querySelector('.project-link.selected')?.getAttribute('title')).toBe('second')
  })
  it('does not move the current reader for an appended reply in a different project', async () => {
    await scrollTo(700); await append('second', '另一个作品的新回复')
    expect(scrolls).toHaveLength(0); expect(messages.textContent).not.toContain('另一个作品的新回复')
  })
})

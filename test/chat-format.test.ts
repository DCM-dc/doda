import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { JSDOM } from 'jsdom'
import { App, speechText } from '../src/ui/App'
import type { Project, DesignSystem } from '../server/contracts'

const translations = createInstance()
beforeAll(async () => { await translations.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: {} } } }) })
function rendered(messages: { role: 'user' | 'assistant'; content: string }[], initial: 'ready' | 'pending' | 'error' | 'empty' | 'empty-configured' | 'refreshing' | 'cached-error' = 'ready', designState: 'none' | 'available' | 'missing' | 'empty-library' = 'none') {
  const project: Project = { id: 'format-unit', name: '灵感花盆', createdAt: '', updatedAt: '', phase: 'explore', revision: 0, designId: 'mint-garden', runs: [], inspirations: [], archive: { highlights: '', interview: '' }, messages: messages.map((message, index) => ({ ...message, id: String(index), time: '' })) }
  const designs: DesignSystem[] = designState === 'none' || designState === 'empty-library' ? [] : [{ id: 'soft-blue', name: '晴空', description: '', version: 1, source: '', tokens: { background: '#ffffff', surface: '#ffffff', text: '#111111', muted: '#777777', accent: '#5577ee', radius: 18 } }]
  if (designState === 'available') designs.push({ id: 'warm-paper', name: '纸间', description: '', version: 1, source: '', tokens: { background: '#fff8ee', surface: '#ffffff', text: '#332211', muted: '#777777', accent: '#aa6633', radius: 14 } })
  if (designState !== 'none') { project.designId = 'warm-paper'; project.revision = 2; project.handoffRevision = 2; project.brief = { title: '灵感花盆', audience: '自己', purpose: '轻轻种下一个念头', features: ['点一下长一片叶'], pages: ['首页'], acceptance: ['能长出叶子'], deferred: [], designId: 'warm-paper' } }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } })
  if (initial !== 'pending' && initial !== 'error') client.setQueryData(['doda-state'], { projects: initial.startsWith('empty') ? [] : [project], designs, settings: { deepseekConfigured: initial !== 'empty', mimoConfigured: initial !== 'empty', model: 'deepseek-chat', voice: '苏打', speak: false } })
  if (initial === 'refreshing') client.getQueryCache().find({ queryKey: ['doda-state'] })!.setState({ fetchStatus: 'fetching' })
  if (initial === 'error' || initial === 'cached-error') client.getQueryCache().build(client, { queryKey: ['doda-state'] }).setState({ status: 'error', error: new Error('连接暂时不可用'), fetchStatus: 'idle' })
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(I18nextProvider, { i18n: translations }, createElement(App))))
  client.clear()
  return new JSDOM(html)
}

describe('需求摘要在对话中呈现，设计系统不作为选择界面', () => {
  it.each(['missing','empty-library'] as const)('内部风格 %s 时保留已定需求并阻止制作', state => {
    const dom = rendered([], 'ready', state)
    try { expect(dom.window.document.querySelector('.chat-brief h3')?.textContent).toBe('灵感花盆'); expect(dom.window.document.querySelector('.chat-brief p')?.textContent).toBe('轻轻种下一个念头'); expect(dom.window.document.querySelector('.chat-brief select')).toBeNull(); expect(dom.window.document.querySelector<HTMLButtonElement>('.chat-brief .primary-button')!.disabled).toBe(true); expect(dom.window.document.querySelectorAll('[role="tab"],.design-card')).toHaveLength(0) } finally { dom.window.close() }
  })
  it('已定纸间保持内部选择，需求摘要可确认，不出现设计菜单', () => {
    const dom = rendered([], 'ready', 'available')
    try { expect(dom.window.document.querySelector('.chat-brief h3')?.textContent).toBe('灵感花盆'); expect(dom.window.document.querySelector('.chat-brief select')).toBeNull(); expect(dom.window.document.querySelector<HTMLButtonElement>('.chat-brief .primary-button')!.disabled).toBe(false); expect(dom.window.document.querySelectorAll('[role="tab"],.design-card')).toHaveLength(0) } finally { dom.window.close() }
  })
})

describe('启动时等待作品和配置状态', () => {
  it('尚未收到状态时不假定用户没有作品或没有配置', () => {
    const dom = rendered([], 'pending')
    try { expect(dom.window.document.body.textContent).toContain('common.opening'); expect(dom.window.document.body.textContent).not.toContain('common.setup'); expect(dom.window.document.body.textContent).not.toContain('common.openSettings'); expect(dom.window.document.querySelectorAll('.sidebar-empty,.idea-list')).toHaveLength(0); expect(dom.window.document.querySelector<HTMLIFrameElement>('iframe')!.getAttribute('src')).toBe('about:blank'); expect(dom.window.document.querySelectorAll('.artifact-panel')).toHaveLength(1); expect(dom.window.document.querySelector('[aria-busy="true"]')).not.toBeNull() } finally { dom.window.close() }
  })
  it('尚未收到状态时小球、新点子、设置和打字入口都等待', () => {
    const dom = rendered([], 'pending')
    try { for (const selector of ['.new-button', '.sidebar-bottom button', '.workspace-header button', '.voice-orb-button', '.voice-controls button']) expect(dom.window.document.querySelector<HTMLButtonElement>(selector)?.disabled, selector).toBe(true) } finally { dom.window.close() }
  })
  it('首次连接失败保留加载边界并提供重试，不误报需要配置密钥', () => {
    const dom = rendered([], 'error')
    try { expect(dom.window.document.body.textContent).toContain('common.openFailed'); expect(dom.window.document.body.textContent).toContain('common.retry'); expect(dom.window.document.body.textContent).not.toContain('common.setup'); expect(dom.window.document.body.textContent).not.toContain('common.loading'); expect(dom.window.document.body.textContent).toContain('common.unavailable'); expect(dom.window.document.querySelector<HTMLButtonElement>('.voice-orb-button')?.disabled).toBe(true); expect(dom.window.document.querySelector('.notice')).toBeNull(); expect(dom.window.document.querySelector('[aria-busy="true"]')).toBeNull() } finally { dom.window.close() }
  })
  it('已加载配置和作品后恢复对话入口并显示实际连接', () => {
    const dom = rendered([{ role: 'assistant', content: '我们接着聊花盆。' }])
    try { expect(dom.window.document.body.textContent).toContain('灵感花盆'); expect(dom.window.document.body.textContent).toContain('common.connected'); expect(dom.window.document.body.textContent).toContain('我们接着聊花盆。'); expect(dom.window.document.querySelector<HTMLButtonElement>('.voice-orb-button')?.disabled).toBe(false); expect(dom.window.document.querySelector<HTMLButtonElement>('.new-button')?.disabled).toBe(false); expect(dom.window.document.body.textContent).not.toContain('common.opening') } finally { dom.window.close() }
  })
  it('确实没有作品也没有配置的用户仍能开始新点子和打开设置', () => {
    const dom = rendered([], 'empty')
    try { expect(dom.window.document.body.textContent).toContain('common.setup'); expect(dom.window.document.body.textContent).toContain('common.openSettings'); expect(dom.window.document.querySelectorAll('.idea-list button')).toHaveLength(3); expect(dom.window.document.querySelector('.sidebar-empty')).not.toBeNull(); expect(dom.window.document.querySelector<HTMLButtonElement>('.new-button')?.disabled).toBe(false); expect(dom.window.document.querySelector<HTMLButtonElement>('.voice-orb-button')?.disabled).toBe(false) } finally { dom.window.close() }
  })
  it('没有作品但已配置的用户可以直接开始语音并创建第一件作品', () => {
    const dom = rendered([], 'empty-configured')
    try { expect(dom.window.document.body.textContent).toContain('common.connected'); expect(dom.window.document.body.textContent).not.toContain('common.setup'); expect(dom.window.document.querySelectorAll('.idea-list button')).toHaveLength(3); expect(dom.window.document.querySelector<HTMLButtonElement>('.voice-orb-button')?.disabled).toBe(false) } finally { dom.window.close() }
  })
  it('后台刷新保留当前作品和可用对话，不退回首次加载', () => {
    const dom = rendered([{ role: 'user', content: '让花慢慢长出来。' }], 'refreshing')
    try { expect(dom.window.document.body.textContent).toContain('让花慢慢长出来。'); expect(dom.window.document.body.textContent).not.toContain('common.opening'); expect(dom.window.document.querySelector<HTMLButtonElement>('.voice-orb-button')?.disabled).toBe(false); expect(dom.window.document.querySelector<HTMLButtonElement>('.new-button')?.disabled).toBe(false); expect(dom.window.document.querySelector('[aria-busy="true"]')).toBeNull() } finally { dom.window.close() }
  })
  it('后台刷新失败保留已有作品和配置，显示连接错误', () => {
    const dom = rendered([{ role: 'assistant', content: '已有作品还在。' }], 'cached-error')
    try { expect(dom.window.document.body.textContent).toContain('已有作品还在。'); expect(dom.window.document.querySelector('.notice')?.textContent).toContain('连接暂时不可用'); expect(dom.window.document.body.textContent).not.toContain('common.openFailed'); expect(dom.window.document.querySelector<HTMLButtonElement>('.voice-orb-button')?.disabled).toBe(false); expect(dom.window.document.body.textContent).toContain('common.connected') } finally { dom.window.close() }
  })
})

describe('对话显示保留原话并呈现回复格式', () => {
  it('实际花盆问句中的四处强调成为 strong，屏幕不显示包围星号', () => {
    const dom = rendered([{ role: 'assistant', content: '你更想要**每点一次就立刻长高一截**，还是**点几下后花一下绽放出来**？' }, { role: 'assistant', content: '长的是**同一株慢慢抽高**，还是**每一下都冒出个新东西**？' }])
    try {
      expect([...dom.window.document.querySelectorAll('.message.assistant strong')].map(node => node.textContent)).toEqual(['每点一次就立刻长高一截', '点几下后花一下绽放出来', '同一株慢慢抽高', '每一下都冒出个新东西'])
      expect([...dom.window.document.querySelectorAll('.message.assistant .message-content')].map(node => node.textContent)).toEqual(['你更想要每点一次就立刻长高一截，还是点几下后花一下绽放出来？', '长的是同一株慢慢抽高，还是每一下都冒出个新东西？'])
    } finally { dom.window.close() }
  })
  it('用户输入中的星号、换行和 HTML 继续作为原文字显示', () => {
    const content = '我写 **星星**，2 * 3 = 6。\n<script>原文</script>', dom = rendered([{ role: 'user', content }])
    try { expect(dom.window.document.querySelector('.message.user p')?.textContent).toBe(content); expect(dom.window.document.querySelectorAll('.message.user strong,.message.user script')).toHaveLength(0) } finally { dom.window.close() }
  })
  it('转义星号与代码里的双星号保留，普通段落分开呈现', () => {
    const dom = rendered([{ role: 'assistant', content: '这里是\\*\\*原符号\\*\\*，`**代码**`。\n\n这是**第二段**。' }])
    try {
      expect([...dom.window.document.querySelectorAll('.message.assistant .message-content p')].map(node => node.textContent)).toEqual(['这里是**原符号**，**代码**。', '这是第二段。'])
      expect(dom.window.document.querySelector('.message.assistant code')?.textContent).toBe('**代码**')
      expect(dom.window.document.querySelector('.message.assistant strong')?.textContent).toBe('第二段')
    } finally { dom.window.close() }
  })
  it('回复中的 HTML 不执行，图片只显示描述，危险链接没有可执行 href', () => {
    const dom = rendered([{ role: 'assistant', content: '<script>alert(1)</script>\n\n![一朵小花](https://example.invalid/flower.png) [危险](javascript:alert%281%29)' }])
    try {
      const message = dom.window.document.querySelector('.message.assistant .message-content')!
      expect(message.querySelectorAll('script,img')).toHaveLength(0)
      expect(message.textContent).toContain('一朵小花')
      expect(message.querySelector('a')?.getAttribute('href')).toBe('')
    } finally { dom.window.close() }
  })
})

describe('回复朗读提取可见文字', () => {
  it('强调标记不进入语音文本，中文问句与标点不变', () => { expect(speechText('你更想要**每点一次就立刻长高一截**，还是**一下绽放**？')).toBe('你更想要每点一次就立刻长高一截，还是一下绽放？') })
  it('转义与代码中的星号保留原含义', () => { expect(speechText('\\*\\*星星\\*\\*，`**原代码**`，2 * 3 = 6。')).toBe('**星星**，**原代码**，2 * 3 = 6。') })
  it('段落和列表之间保留停顿，不把相邻条目粘成一个词', () => { expect(speechText('先**种下**。\n\n- 浇一点灵感\n- 再等下一次\n\n就到这里。')).toBe('先种下。\n\n浇一点灵感\n再等下一次\n\n就到这里。') })
  it('链接朗读标签，图片朗读描述，引用定义不朗读网址', () => { expect(speechText('[看看花盆][pot]，![小花](https://example.invalid/flower.png)。\n\n[pot]: https://example.invalid')).toBe('看看花盆，小花。') })
  it('空白与未闭合的强调不造成丢字', () => { expect(speechText('  \n ')).toBe(''); expect(speechText('我写 **还没写完')).toBe('我写 **还没写完') })
})

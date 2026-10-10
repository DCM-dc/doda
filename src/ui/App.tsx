import { useState, useRef, type CSSProperties } from 'react'
import { designWebStyle } from '../../server/design'
import { dodaReply } from '../../server/contracts'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEventListener, useWatch, useUnmount, useTimeoutFn, useMediaQuery, useResizeObserver } from '@reause/core'
import { If } from 'react-if-lite'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { devices, previewDevice } from '../../server/devices'
import type { Project, DesignSystem, Settings } from '../../server/contracts'
import { VoiceSession, captureMicrophone, type VoicePhase } from './voice'

type PublicSettings = Settings & { deepseekConfigured: boolean; mimoConfigured: boolean }
interface State { projects: Project[]; designs: DesignSystem[]; settings: PublicSettings }
export function speechText(content: string) {
  function words(node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>['children'][number]): string {
    if (node.type === 'definition') return ''
    if (node.type === 'break' || node.type === 'thematicBreak') return '\n'
    if ('children' in node) {
      const separator = node.type === 'root' || node.type === 'blockquote' || node.type === 'listItem' ? '\n\n' : node.type === 'list' ? '\n' : ''
      return node.children.map(words).join(separator)
    }
    if ('value' in node) return node.value
    if ('alt' in node) return node.alt || ''
    return ''
  }
  return words(fromMarkdown(dodaReply(content))).trim()
}
async function api<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? { signal } : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'REQUEST_FAILED') }
  return response.json()
}
function Icon({ name }: { name: 'plus' | 'send' | 'mic' | 'settings' | 'close' | 'arrow' | 'stop' | 'speaker' | 'folder' | 'menu' }) {
  const paths = { plus: 'M12 5v14M5 12h14', send: 'M12 19V5m-6 6 6-6 6 6', mic: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm-7-4v1a7 7 0 0 0 14 0v-1m-7 8v3m-4 0h8', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2', close: 'm6 6 12 12M6 18 18 6', arrow: 'M5 12h14m-6-6 6 6-6 6', stop: 'M7 7h10v10H7z', speaker: 'M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8', folder: 'M3 7h7l2-3h9v16H3z', menu: 'M4 6h16M4 12h16M4 18h16' }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

export function App() {
  // 1. 数据查询 (Queries)
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const compact = useMediaQuery('(max-width:900px)')
  const state = useQuery({ queryKey: ['doda-state'], queryFn: () => api<State>('/state'), refetchInterval: query => query.state.data?.projects.some(p => p.runs.some(r => r.status === 'running')) ? 1000 : 10000 })
  // 2. 本地用户选择状态
  const [projectId, setProjectId] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [text, setText] = useState('')
  const composerVersion = useRef(0)
  const displayedProject = useRef('')
  const [showSettings, setShowSettings] = useState(false)
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState('')
  const [previewRoute, setPreviewRoute] = useState('')
  const [region, setRegion] = useState<{ file: string; classes: string; text: string }>()
  const [speaking, setSpeaking] = useState(false)
  const [voiceMode, setVoiceMode] = useState(true)
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('off')
  const [voiceError, setVoiceError] = useState('')
  const [voiceText, setVoiceText] = useState('')
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [deviceId, setDeviceId] = useState<string>(devices[0].id)
  const [previewSize, setPreviewSize] = useState({width:480,height:700})
  const previewStage = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const audioRequest = useRef<AbortController | null>(null)
  const voiceSession = useRef<VoiceSession | null>(null)
  const voiceTarget = useRef('')
  const voiceDeliveries = useRef(new Set<string>())
  const previewRef = useRef<HTMLIFrameElement>(null)
  const captures=useRef(new Map<string,{frame:Window;resolve:(image?:{data:string;page:string;runId?:string})=>void;finish:()=>void}>())
  const endRef = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const scrollProject = useRef('')
  const noticeVersion = useRef(0)
  const { start: expireNotice, stop: cancelNoticeExpiry } = useTimeoutFn((version: number) => { if (noticeVersion.current === version) setNotice('') }, 5000, { immediate: false })
  // 3. 项目文件数据 Query
  const filesQuery = useQuery({ queryKey: ['doda-files', projectId, previewEpoch], queryFn: () => api<string[]>(`/projects/${projectId}/files`), enabled: Boolean(projectId), refetchInterval: 5000 })
  const pagesQuery = useQuery({ queryKey: ['doda-pages', projectId, previewEpoch], queryFn: () => api<string[]>(`/projects/${projectId}/pages`), enabled: Boolean(projectId), refetchInterval: 5000 })
  const previewState = useQuery({queryKey:['doda-preview-state',projectId,page,previewEpoch],queryFn:()=>api<{revision:string;pages:string[];runId?:string;available:boolean;live:boolean}>(`/projects/${projectId}/preview-state?device=${devices[0].id}${page?'&page='+encodeURIComponent(page):''}`),enabled:Boolean(projectId),refetchInterval:2000,retry:false})
  // 4. 派生数据提取与 Map 索引构造
  const projects = state.data?.projects || []
  const designs = state.data?.designs || []
  const projectMap = new Map(projects.map(p => [p.id, p]))
  const project = projectMap.get(projectId) || projects[0]
  const currentId = project?.id || ''
  displayedProject.current = currentId
  const active = project?.runs.find(r => r.status === 'running')
  const brief = project?.brief
  const designMap = new Map(designs.map(d => [d.id, d]))
  const currentDesign = designMap.get(brief?.designId || project?.designId || designs[0]?.id)
  const missingDesign = Boolean(brief && !currentDesign)
  const workbenchDesign = designMap.get('open-design-apple') || designs[0]
  const defaultDesign = currentDesign?.id || workbenchDesign?.id || 'soft-blue'
  const progressStage = [...(active?.events || [])].reverse().find(event => ['visual', 'visual-repair', 'checked', 'validation', 'repair', 'started'].includes(event.kind))?.kind
  const progressLabel = t(progressStage === 'checked' ? 'chat.finishing' : ['visual', 'visual-repair', 'validation', 'repair'].includes(progressStage || '') ? 'chat.checking' : 'chat.making')
  const device = previewDevice(deviceId)
  const frameHeight = device.height + (device.shape === 'home' ? 110 : 20)
  const frameWidth = device.width + 20
  const phoneScale = Math.min(1, Math.max(.25, Math.min((previewSize.width - 48) / frameWidth, (previewSize.height - 40) / frameHeight)))
  const pagePaths = previewState.data?.pages || pagesQuery.data || []
  const effectivePage = pagePaths.includes(page) ? page : pagePaths[0] || 'pages/home/index'
  const shownPage = pagePaths.includes(previewRoute) ? previewRoute : effectivePage
  const latestDelivery = project?.runs.find(r => r.status === 'completed')
  const settings = state.data?.settings
  const stateReady = state.data !== undefined
  const initialError = !stateReady && state.isError && !state.isFetching
  const connectionLabel = t(!stateReady ? initialError ? 'common.unavailable' : 'common.loading' : settings?.deepseekConfigured ? 'common.connected' : 'common.setup')
  const deliveredMessages = new Set(project?.runs.filter(run => run.status === 'completed').map(run => `delivery-${run.id}`) || [])
  const voiceActive = voicePhase !== 'off' && voicePhase !== 'error'
  const orbPhase = voicePhase === 'listening' ? 'listening' : voicePhase === 'speaking' || speaking ? 'speaking' : voiceActive ? 'thinking' : ''
  const expandedSidebar = compact && sidebarOpen

  // 5. 使用 useMutation 封装提交流程
  function showNotice(message: string, transient = false) { cancelNoticeExpiry(); const version = ++noticeVersion.current; setNotice(message); if (message && transient) expireNotice(version) }
  async function refresh() { await queryClient.invalidateQueries({ queryKey: ['doda-state'] }) }
  function stopAudio() { audioRequest.current?.abort(); audioRequest.current = null; const playing = audio.current; if (playing) { playing.pause(); URL.revokeObjectURL(playing.src); audio.current = null } setSpeaking(false) }
  async function playReply(content: string, voice?: '苏打' | '冰糖', signal?: AbortSignal) {
    stopAudio(); const controller = new AbortController(); audioRequest.current = controller; setSpeaking(true)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const preparing = signal ? AbortSignal.any([combined, AbortSignal.timeout(15000)]) : combined
    let url = ''
    try {
      const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: speechText(content).slice(0, 1200), voice }), signal: preparing })
      if (!response.ok) throw new Error((await response.json()).error)
      url = URL.createObjectURL(await response.blob()); preparing.throwIfAborted()
      const player = new Audio(url); audio.current = player
      await new Promise<void>((resolve, reject) => {
        function abort() { player.pause(); reject(new DOMException('Aborted', 'AbortError')) }
        function ended() { combined.removeEventListener('abort', abort); resolve() }
        player.onended = ended
        player.onerror = () => { combined.removeEventListener('abort', abort); reject(new Error(t('voice.playError'))) }
        combined.addEventListener('abort', abort, { once: true })
        player.play().catch(error => { combined.removeEventListener('abort', abort); reject(error) })
      })
    } finally {
      if (url) URL.revokeObjectURL(url)
      if (audioRequest.current === controller) { audio.current = null; audioRequest.current = null; setSpeaking(false) }
    }
  }
  async function speak(content: string, voice?: '苏打' | '冰糖') {
    if (voiceActive) return
    try { await playReply(content, voice) } catch (error) { if ((error as Error).name !== 'AbortError') showNotice((error as Error).message) }
  }
  const createProject = useMutation({ mutationFn: (input: { designId: string; reuseProjectId?: string }) => api<Project>('/projects', input), onSuccess: async p => { queryClient.setQueryData<State>(['doda-state'], old => old ? { ...old, projects: [p, ...old.projects.filter(project => project.id !== p.id)] } : old); stopVoice(); stopAudio(); setProjectId(p.id); setRegion(undefined); setPage(''); await refresh() }, onError: e => showNotice(e.message) })
  const chat = useMutation({ mutationFn: async (input: { text: string; summarize?: boolean; voice?: boolean; projectId?: string; signal?: AbortSignal; composerVersion?: number }) => {
    const target=input.projectId||currentId,selectedRegion=region?`${region.file} [${region.classes}]：${region.text}`:undefined,allowHandoff=true
    let image:{data:string;page:string;runId?:string}|undefined
    const frame=previewRef.current
    if(target===displayedProject.current&&previewState.data?.available&&frame?.dataset.ready==='1'&&frame.dataset.loaded===frame.src&&frame.contentWindow){
      const view=frame.contentWindow,runId=previewState.data?.runId
      image=await new Promise((resolve,reject)=>{
        const id=crypto.randomUUID()
        function finish(){clearTimeout(timer);input.signal?.removeEventListener('abort',abort);captures.current.delete(id)}
        function abort(){finish();reject(new DOMException('Aborted','AbortError'))}
        const timer=setTimeout(()=>{finish();resolve(undefined)},4000)
        captures.current.set(id,{frame:view,resolve:value=>resolve(value?{...value,runId}:undefined),finish})
        input.signal?.addEventListener('abort',abort,{once:true});if(input.signal?.aborted){abort();return}
        view.postMessage({type:'doda-preview-capture',id},'*')
      })
    }
    return api<Project & { chatReply?: string; cancelledRunId?: string; voiceDone?: boolean }>(`/projects/${target}/chat`, { text: input.text, summarize: input.summarize, voice: input.voice, allowHandoff, region:selectedRegion,image }, 'POST', input.signal)
  }, onSuccess: async (p, input) => { if (input.signal?.aborted) return; if (p.cancelledRunId) voiceDeliveries.current.add(p.cancelledRunId); queryClient.setQueryData<State>(['doda-state'], old => old ? { ...old, projects: old.projects.map(x => x.id === p.id ? p : x) } : old); if (p.id !== displayedProject.current) return; if (!input.voice && input.composerVersion === composerVersion.current) setText(''); setVoiceText(''); setRegion(undefined); if (settings?.speak && !input.voice) void speak(p.chatReply || p.messages[p.messages.length - 1].content) }, onError: (e, input) => { if (e.name === 'AbortError' || input.voice) return; showNotice(e.message); if (!settings?.deepseekConfigured) setShowSettings(true) } })
  const followup = useMutation({ mutationFn: (input: { projectId: string; signal: AbortSignal }) => api<{ id: string; runId: string; text: string } | null>(`/projects/${input.projectId}/followup`, {}, 'POST', input.signal) })
  const acceptFollowup = useMutation({ mutationFn: (input: { projectId: string; id: string; signal: AbortSignal }) => api<{ accepted: boolean }>(`/projects/${input.projectId}/followup/accept`, { id: input.id }, 'POST', input.signal), onSuccess: async result => { if (result.accepted) await refresh() } })
  const action = useMutation({ mutationFn: (input: { path: string; body?: unknown }) => api<any>(input.path, input.body || {}), onSuccess: async (result, input) => { await refresh(); if (input.path.endsWith('/design')) setPreviewEpoch(x => x + 1); if (result.message) showNotice(result.message, true); if (result.output) showNotice(result.output.slice(-500)); if (result.qrcode) window.open(result.qrcode, '_blank', 'noopener') }, onError: e => showNotice(e.message) })
  const check = useMutation({ mutationFn: () => api<{ ok: boolean; errors: string[]; warnings: string[]; scope: string }>(`/projects/${currentId}/check`), onSuccess: result => showNotice(result.ok ? [result.scope, ...result.warnings].join('\n') : result.errors.join('\n'), result.ok && !result.warnings.length), onError: e => showNotice(e.message) })
  const previewStorage = useMutation({ mutationFn: (input: { projectId: string; key: string; value?: unknown; remove?: boolean }) => api(`/projects/${input.projectId}/preview-storage`, input.remove ? { key: input.key, remove: true } : { key: input.key, value: input.value }), onError: () => showNotice(t('preview.storageError')) })
  useResizeObserver(previewStage, entries => { const rect = entries[0]?.contentRect; if (rect?.width && rect.height) setPreviewSize({width:Math.round(rect.width),height:Math.round(rect.height)}) })
  useWatch(deviceId,()=>{const frame=previewRef.current;if(frame?.dataset.ready==='1')frame.contentWindow?.postMessage({type:'doda-preview-device',id:deviceId},'*')})
  useWatch(project?.id, () => { if (project && projectId !== project.id) setProjectId(project.id) }, { immediate: true })
  useWatch(`${currentId}:${latestDelivery?.id || ''}`, () => { setPreviewEpoch(x => x + 1); void queryClient.invalidateQueries({ queryKey: ['doda-files'] }); void queryClient.invalidateQueries({ queryKey: ['doda-pages'] }) })
  useWatch(project?.runs.map(run => `${run.id}:${run.status}`).join(','), () => { if (voiceTarget.current !== currentId) return; voiceSession.current?.followBuild(active?.id, settings?.talkLevel || 'standard'); for (const run of project?.runs || []) { if (run.status === 'running' || voiceDeliveries.current.has(run.id)) continue; voiceDeliveries.current.add(run.id); const message = project?.messages.find(item => item.id === `delivery-${run.id}`); if (message) voiceSession.current?.announce(message.content) } })
  useWatch(`${currentId}:${project?.messages.length || 0}`, () => { if (scrollProject.current !== currentId) { scrollProject.current = currentId; followLatest.current = true } if (followLatest.current) endRef.current?.scrollIntoView({ block: 'nearest' }) }, { immediate: true })
  useWatch(`${currentId}:${effectivePage}:${previewEpoch}`, () => setPreviewRoute(''))
  useWatch(currentId, () => { if (voiceTarget.current !== currentId) { stopVoice(); stopAudio() } })
  useWatch(showSettings, () => { if (showSettings) stopVoice() })
  useWatch(compact, () => { if (!compact) setSidebarOpen(false) })
  useUnmount(() => { voiceSession.current?.stop(); audioRequest.current?.abort(); audio.current?.pause();for(const pending of captures.current.values()){pending.finish();pending.resolve()} })
  useEventListener('pagehide', () => { stopVoice(); stopAudio() })
  useEventListener('message', (event: MessageEvent) => {
    if (event.source !== previewRef.current?.contentWindow) return
    if(event.data?.type==='doda-preview-captured'){
      const pending=captures.current.get(event.data.id)
      if(!pending||pending.frame!==event.source)return
      pending.finish()
      if(typeof event.data.data==='string'&&event.data.data.length<=2000000&&event.data.data.startsWith('data:image/png;base64,')&&pagePaths.includes(event.data.page))pending.resolve({data:event.data.data,page:event.data.page});else pending.resolve()
      return
    }
    if (event.data?.type === 'doda-preview-route') { if (pagePaths.includes(event.data.page)) setPreviewRoute(event.data.page); return }
    if (event.data?.type === 'doda-preview-storage') { previewStorage.mutate({ projectId: currentId, key: String(event.data.key).slice(0, 120), value: event.data.value, remove: event.data.remove === true }); return }
    if (event.data?.type !== 'doda-region') return
    const file = event.data.file
    if (typeof file !== 'string' || !file.endsWith('.wxml') || !filesQuery.data?.includes(file)) return
    setRegion({ file, classes: String(event.data.classes || '').slice(0, 80), text: String(event.data.text || '').slice(0, 160) })
  })
  useEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Escape') { setSidebarOpen(false); setShowSettings(false); stopVoice(); stopAudio() } })
  function editText(value: string) { ++composerVersion.current; setText(value) }
  function submit() { if (text.trim() && currentId && !chat.isPending && !createProject.isPending) { stopAudio(); followLatest.current = true; endRef.current?.scrollIntoView({ block: 'nearest' }); chat.mutate({ text: text.trim(), projectId: currentId, composerVersion: composerVersion.current }) } }
  function chooseProject(id: string) { setSidebarOpen(false); if (id === currentId) return; stopVoice(); stopAudio(); setProjectId(id); editText(''); setRegion(undefined); setPage(''); setPreviewRoute('') }
  function choosePreviewPage(path: string) { setPreviewRoute(''); setPage(path); setPreviewEpoch(x => x + 1) }
  function stopVoice() { voiceSession.current?.stop(); voiceSession.current = null; voiceTarget.current = ''; setVoicePhase('off'); setVoiceText(''); setVoiceError('') }
  async function startVoice() {
    if (voiceActive) { stopVoice(); return }
    if (!stateReady) return
    if (!settings?.deepseekConfigured || !settings?.mimoConfigured) { showNotice(t('voice.keys')); setShowSettings(true); return }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { showNotice(t('chat.noAsr')); return }
    if (createProject.isPending) return
    let target = currentId
    if (!target) { try { target = (await createProject.mutateAsync({ designId: defaultDesign })).id } catch { return } }
    stopVoice(); stopAudio(); setVoiceMode(true)
    voiceTarget.current = target
    voiceDeliveries.current = new Set(project?.runs.filter(run => run.status !== 'running').map(run => run.id) || [])
    const session = new VoiceSession({
      capture: captureMicrophone,
      transcribe: async (wav, signal) => { const response = await fetch('/api/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result.text },
      chat: async (text, signal) => { const result = await chat.mutateAsync({ text, voice: true, projectId: target, signal }); return { text: result.chatReply || result.messages[result.messages.length - 1].content, done: result.voiceDone } },
      play: (text, signal) => playReply(text, undefined, signal),
      changed: (phase, error) => { setVoicePhase(phase); setVoiceError(error && (phase === 'listening' || phase === 'off') ? t('voice.playError') : error || '') },
      transcript: setVoiceText,
      followup: async signal => { const invitation = await followup.mutateAsync({ projectId: target, signal }); if (!invitation) return; return { text: invitation.text, accept: async signal => (await acceptFollowup.mutateAsync({ projectId: target, id: invitation.id, signal })).accepted } },
    })
    voiceSession.current = session; void session.start()
    session.followBuild(active?.id, settings.talkLevel)
  }
  function switchToText() { stopVoice(); stopAudio(); setVoiceMode(false) }
  function newProject(input?: { designId?: string; reuseProjectId?: string; text?: string }) { if (!stateReady || createProject.isPending) return; setSidebarOpen(false); editText(input?.text || ''); createProject.mutate({ designId: input?.designId || defaultDesign, reuseProjectId: input?.reuseProjectId }) }

  return <div className="app-shell" style={designWebStyle(workbenchDesign) as CSSProperties}>
    <If cond={expandedSidebar}><button className="sidebar-backdrop" aria-label={t('nav.hideProjects')} onClick={() => setSidebarOpen(false)} /></If>
    <aside className={`sidebar ${expandedSidebar ? 'expanded' : ''}`}>
      <div className="brand"><span className="brand-dot" /><strong>doda</strong><If cond={compact}><button className="icon-button sidebar-toggle" aria-label={t(expandedSidebar ? 'nav.hideProjects' : 'nav.showProjects')} aria-expanded={expandedSidebar} aria-controls="project-navigation" onClick={() => setSidebarOpen(value => !value)}><Icon name={expandedSidebar ? 'close' : 'menu'} /></button></If></div>
      <button className="new-button" onClick={() => newProject()} disabled={!stateReady || createProject.isPending}><Icon name="plus" />{t('nav.new')}</button>
      <p className="sidebar-label">{t('nav.projects')}</p>
      <nav id="project-navigation" aria-label={t('nav.projects')}>{projects.map(p => <button key={p.id} className={`project-link ${p.id === currentId ? 'selected' : ''}`} title={p.name} onClick={() => chooseProject(p.id)}><Icon name="folder" /><span>{p.name}</span><If cond={p.phase === 'done'}><span className="done-dot" /></If></button>)}</nav>
      <If cond={stateReady && !projects.length}><p className="sidebar-empty">{t('nav.empty')}</p></If>
      <div className="sidebar-bottom"><span className={`connection-dot ${!stateReady ? 'waiting' : settings?.deepseekConfigured ? '' : 'needs-key'}`} /><span>{connectionLabel}</span><button className="icon-button" aria-label={t('nav.settings')} onClick={() => setShowSettings(true)} disabled={!stateReady}><Icon name="settings" /></button></div>
    </aside>
    <main className="workspace">
      <header className="workspace-header"><div><span>{project?.name || t('brand.tag')}</span><If cond={Boolean(project)}><span className="phase-chip">{t(`project.${project?.phase || 'explore'}`)}</span></If></div><button className="subtle-button" onClick={() => setShowSettings(true)} disabled={!stateReady}>{!stateReady ? connectionLabel : settings?.deepseekConfigured ? t('nav.settings') : t('common.openSettings')}<Icon name="settings" /></button></header>
      <div className="work-columns">
        <section className="conversation" aria-label="doda" aria-busy={!stateReady && state.isFetching}>
          <div className="messages" aria-live="polite" onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 64 }}>
            <If cond={!stateReady}><div className="welcome" role="status"><p>{t(initialError ? 'common.openFailed' : 'common.opening')}</p><If cond={initialError}><button className="secondary-button" onClick={() => void state.refetch()}>{t('common.retry')}</button></If></div></If>
            <If cond={stateReady && !project}><div className="welcome"><span className="orb welcome-orb" /><h1>{t('chat.welcome')}</h1><p>{t('chat.subtitle')}</p><div className="idea-list">{['idea.cat', 'idea.reading', 'idea.story'].map(key => <button key={key} onClick={() => newProject({ text: t(key) })}>{t(key)}<Icon name="arrow" /></button>)}</div></div></If>
            <If cond={Boolean(project)}>{project?.messages.map(message => <article className={`message ${message.role}`} key={message.id}><If cond={message.role === 'assistant'}><span className="message-orb" /></If><div className="message-content"><div className="message-text"><If cond={message.role === 'assistant'} else={<p>{message.content}</p>}><Markdown components={{ img: ({ alt }) => <span>{alt}</span> }}>{dodaReply(message.content)}</Markdown></If></div><If cond={Boolean(message.visual)}><button className="visual-card" onClick={()=>previewRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'})}><img src={`/api/projects/${currentId}/images/${message.visual?.id}`} alt={t('chat.visual')} /><span>{t('chat.visual')}</span></button></If><If cond={Boolean(project?.runs.find(run=>`delivery-${run.id}`===message.id&&run.status==='completed'&&run.visual))}><button className="visual-card delivery-visual" onClick={()=>previewRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'})}><img src={`/api/projects/${currentId}/runs/${message.id.slice(9)}/preview-image`} alt={t('chat.openWork')} /></button></If><If cond={deliveredMessages.has(message.id)}><button className="secondary-button delivery-button" onClick={() => previewRef.current?.scrollIntoView({block:'nearest',behavior:'smooth'})}>{t('chat.openWork')}<Icon name="arrow" /></button></If><If cond={message.role === 'assistant' && Boolean(settings?.mimoConfigured)}><button className="read-button" aria-label={t('chat.read')} onClick={() => void speak(message.content)}><Icon name="speaker" /></button></If></div></article>)}</If>
            <If cond={Boolean(brief) && project?.handoffRevision===project?.revision && !active}><article className="chat-brief"><span className="eyebrow">{t('panel.brief')}</span><h3>{brief?.title}</h3><p>{brief?.purpose}</p><ul>{brief?.features.map(feature=><li key={feature}>{feature}</li>)}</ul><details><summary>{t('brief.review')}</summary><p>{brief?.audience}</p><ul>{brief?.pages.map(item=><li key={item}>{item}</li>)}</ul><ul>{brief?.acceptance.map(item=><li key={item}>{item}</li>)}</ul></details><button className="primary-button" disabled={chat.isPending||Boolean(project?.requirementsError)||missingDesign} onClick={()=>chat.mutate({text:t('chat.confirm')})}>{t('brief.build')}<Icon name="arrow" /></button></article></If>
            <If cond={chat.isPending}><article className="message assistant"><span className="message-orb thinking" /><p className="muted">{t('chat.thinking')}</p></article></If>
            <If cond={project?.phase === 'done'}><div className="completion"><span className="completion-mark">✓</span><strong>{t('chat.done')}</strong><button className="subtle-button" onClick={() => action.mutate({ path: `/projects/${currentId}/phase`, body: { phase: 'refine' } })}>{t('chat.continue')}</button></div></If>
            <div ref={endRef} />
          </div>
          <If cond={Boolean(region)}><div className="region-chip"><span>{t('chat.region')}<If cond={Boolean(region?.text)}>：{region?.text}</If></span><button className="icon-button" aria-label={t('chat.clearRegion')} onClick={() => setRegion(undefined)}><Icon name="close" /></button></div></If>
          <If cond={Boolean(active)}><div className="making-status" role="status"><span className="activity-pulse" /><span>{progressLabel}</span><button className="subtle-button" disabled={action.isPending} onClick={() => action.mutate({ path: `/projects/${currentId}/cancel` })}>{t('brief.cancel')}</button></div></If><div className="composer-wrap"><If cond={voiceMode}><div className="voice-conversation">
            <If cond={Boolean(voiceText)}><p className="voice-transcript">{voiceText}</p></If>
            <button className={`voice-orb-button ${orbPhase}`} aria-label={voiceActive ? t('voice.end') : t('voice.start')} onClick={startVoice} disabled={!stateReady || !voiceActive && chat.isPending}><span className={`orb voice-orb ${orbPhase}`} /></button>
            <If cond={stateReady}><p className="voice-status" role="status">{t(speaking && !voiceActive ? 'chat.read' : `voice.${voicePhase}`)}</p></If>
            <If cond={Boolean(voiceError)}><p className="voice-error">{voiceError}</p></If>
            <div className="voice-controls"><If cond={speaking && !voiceActive}><button className="secondary-button" onClick={stopAudio}>{t('chat.stopRead')}</button></If><If cond={voicePhase === 'speaking'}><button className="secondary-button" onClick={() => voiceSession.current?.interrupt()}>{t('voice.interrupt')}</button></If><If cond={voiceActive}><button className="subtle-button" onClick={stopVoice}>{t('voice.end')}</button></If><button className="subtle-button" onClick={switchToText} disabled={!stateReady}>{t('voice.keyboard')}</button></div>
          </div></If><If cond={!voiceMode}><div className="composer">
            <textarea aria-label={t('chat.placeholder')} placeholder={t('chat.placeholder')} value={text} onChange={e => editText(e.target.value)} disabled={!currentId || createProject.isPending} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
            <div className="composer-tools"><button className="orb-button" aria-label={t('voice.start')} onClick={() => { setVoiceMode(true); startVoice() }} disabled={!stateReady || chat.isPending || createProject.isPending}><span className={`orb ${speaking ? 'speaking' : ''}`} /></button><span className="composer-status">{speaking ? t('chat.read') : t('brand.tag')}</span><If cond={speaking}><button className="icon-button" aria-label={t('chat.stopRead')} onClick={stopAudio}><Icon name="stop" /></button></If><button className="send-button" aria-label={t('chat.send')} onClick={submit} disabled={!text.trim() || !currentId || chat.isPending || createProject.isPending}><Icon name="send" /></button></div>
          </div></If><div className="conversation-actions"><button onClick={() => { if (voiceActive) stopVoice(); chat.mutate({ text: t('chat.summarize'), summarize: true }) }} disabled={!currentId || chat.isPending || project?.phase === 'done'}>{t('chat.summarize')}</button><If cond={Boolean(project?.runs.some(r => r.status === 'completed')) && project?.phase !== 'done'}><button onClick={() => { stopVoice(); action.mutate({ path: `/projects/${currentId}/phase`, body: { phase: 'done' } }) }}>{t('chat.finish')}</button></If></div></div>
        </section>
        <section className="artifact-panel preview-only" aria-label={t('panel.preview')}>
          <header className="preview-heading"><h2>{t('panel.preview')}</h2><span className={`preview-sync ${active ? 'busy' : ''}`}><span />{t(active ? previewState.data?.live ? 'preview.live' : 'preview.preparing' : previewState.data?.available ? 'preview.synced' : 'preview.waiting')}</span></header>
          <div className="preview-toolbar"><select aria-label={t('preview.device')} value={deviceId} onChange={e=>{setDeviceId(e.target.value);setPreviewRoute('')}}>{devices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" aria-label={t('common.refresh')} disabled={!currentId} onClick={()=>{setPage(shownPage);setPreviewEpoch(value=>value+1)}}>↻</button><details className="preview-options"><summary aria-label={t('preview.options')}><Icon name="menu" /></summary><div className="preview-option-menu"><button disabled={!currentId||action.isPending} onClick={()=>action.mutate({path:`/projects/${currentId}/devtools`})}>{t('project.devtools')}</button><button disabled={!currentId||check.isPending} onClick={()=>check.mutate()}>{t('preview.check')}</button><a aria-disabled={!currentId} href={currentId?`/api/projects/${currentId}/export`:undefined}>{t('preview.export')}</a></div></details></div>
          <If cond={pagePaths.length>1}><select className="preview-page" aria-label={t('preview.selectPage')} value={shownPage} onChange={e=>choosePreviewPage(e.target.value)}>{pagePaths.map(path=><option key={path}>{path}</option>)}</select></If>
          <div className="preview-stage" ref={previewStage}><div className="phone-space" style={{width:frameWidth*phoneScale,height:frameHeight*phoneScale}}><div className={`phone-device ${device.shape}`} style={{width:frameWidth,height:frameHeight,transform:`scale(${phoneScale})`,'--phone-radius':device.radius+'px'} as CSSProperties}><span className="phone-side mute" /><span className="phone-side volume-up" /><span className="phone-side volume-down" /><span className="phone-side power" /><If cond={device.shape==='home'}><span className="phone-speaker" /><span className="phone-home" /></If><div className="phone-screen" style={{width:device.width,height:device.height,borderRadius:device.radius+'px'}}><iframe ref={previewRef} key={currentId} onLoad={event=>{event.currentTarget.dataset.ready='1';event.currentTarget.dataset.loaded=event.currentTarget.src;event.currentTarget.contentWindow?.postMessage({type:'doda-preview-device',id:deviceId},'*')}} title={t('panel.preview')} sandbox="allow-scripts" src={currentId&&previewState.data?.available?`/api/projects/${currentId}/preview?device=${devices[0].id}&page=${encodeURIComponent(effectivePage)}&v=${previewState.data.revision}&refresh=${previewEpoch}`:'about:blank'} /><If cond={!previewState.data?.available}><div className={`phone-empty ${device.shape}`}><span className="empty-camera" /><span className="orb" /><p>{t(active?'preview.preparing':'preview.empty')}</p></div></If></div></div></div></div>
          <footer className="preview-footer"><span>{t('preview.touch')}</span><span>{Math.round(phoneScale*100)}%</span></footer>
        </section>
      </div>
    </main>
    <If cond={Boolean(notice || stateReady && state.error)}><div className="notice" role="status"><p>{notice || state.error?.message}</p><button className="icon-button" aria-label={t('common.close')} onClick={() => showNotice('')}><Icon name="close" /></button></div></If>
    <If cond={showSettings && Boolean(settings)}><SettingsDialog settings={settings!} onClose={() => setShowSettings(false)} onSaved={async () => { showNotice(t('settings.saved'), true); await refresh(); setShowSettings(false) }} speak={speak} onError={showNotice} /></If>
  </div>
}

function SettingsDialog({ settings, onClose, onSaved, speak, onError }: { settings: PublicSettings; onClose: () => void; onSaved: () => Promise<void>; speak: (text: string, voice?: '苏打' | '冰糖') => Promise<void>; onError: (text: string) => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ ...settings, deepseekKey: '', mimoKey: '' })
  const [models, setModels] = useState<string[]>([])
  const save = useMutation({ mutationFn: () => api('/settings', form), onSuccess: onSaved, onError: e => onError(e.message) })
  const discover = useMutation({ mutationFn: () => api<string[]>('/models'), onSuccess: setModels, onError: e => onError(e.message) })
  function field(name: string, value: string | boolean) { setForm(old => ({ ...old, [name]: value })) }
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><h2 id="settings-title">{t('settings.title')}</h2><button className="icon-button" aria-label={t('settings.close')} onClick={onClose}><Icon name="close" /></button></header><div className="settings-content"><label>{t('settings.deepseek')}<input autoFocus type="password" autoComplete="off" value={form.deepseekKey} placeholder={t(settings.deepseekConfigured ? 'settings.configured' : 'settings.missing')} onChange={e => field('deepseekKey', e.target.value)} /></label><label>{t('settings.model')}<div className="inline-field"><input list="model-list" value={form.model} onChange={e => field('model', e.target.value)} /><button className="subtle-button" disabled={discover.isPending || !settings.deepseekConfigured} onClick={() => discover.mutate()}>{t('settings.models')}</button></div><datalist id="model-list">{models.map(model => <option key={model} value={model} />)}</datalist></label><label>{t('settings.mimo')}<input type="password" autoComplete="off" value={form.mimoKey} placeholder={t(settings.mimoConfigured ? 'settings.configured' : 'settings.missing')} onChange={e => field('mimoKey', e.target.value)} /></label><label>{t('settings.voice')}<div className="inline-field"><select value={form.voice} onChange={e => field('voice', e.target.value)}><option value="苏打">{t('settings.male')}</option><option value="冰糖">{t('settings.female')}</option></select><button className="subtle-button" onClick={() => void speak(t('settings.voiceText'), form.voice)}>{t('settings.testVoice')}</button></div></label><label className="check-label"><input type="checkbox" checked={form.speak} onChange={e => field('speak', e.target.checked)} />{t('settings.autoSpeak')}</label><label>{t('settings.talk')}<select value={form.talkLevel} onChange={e => field('talkLevel', e.target.value)}>{['quiet', 'standard', 'lively'].map(v => <option key={v} value={v}>{t(`settings.${v}`)}</option>)}</select></label><label>{t('settings.devtools')}<input value={form.devtoolsPath} onChange={e => field('devtoolsPath', e.target.value)} placeholder="C:\…\cli.bat" /></label><label>{t('settings.appId')}<input value={form.appId} onChange={e => field('appId', e.target.value)} placeholder="wx…" /></label><label>{t('settings.uploadKey')}<input value={form.uploadKeyPath} onChange={e => field('uploadKeyPath', e.target.value)} placeholder="C:\…\private.wx….key" /></label></div><footer><button className="primary-button" disabled={save.isPending} onClick={() => save.mutate()}>{t('settings.save')}</button></footer></section></div>
}

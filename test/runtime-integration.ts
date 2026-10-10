import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative, isAbsolute } from 'node:path'
import assert from 'node:assert/strict'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { Store, defaultDesigns } from '../server/store'
import { scaffold } from '../server/miniprogram'
import { Builder } from '../server/dsh'
import type { Run } from '../server/contracts'

const root = await mkdtemp(join(tmpdir(), 'doda-native-protocol-'))
let requests = 0
let caseRequests = 0
let rejected = false
let scenario = 'success'
let waitingForRepair = false
let pendingResponse: import('node:http').ServerResponse | undefined
const invalidTemplate = '<view>{{ count + }}</view>'
const validTemplate = '<view class="page">{{count}}</view><button bindtap="add">+2</button>'
const continuedTemplate = '<view class="page">{{count}}</view><button bindtap="add">继续计数</button>'
type FixtureTool = { tool: string; input: Record<string, string> }
const steps: Record<string, (string | { path: string; content: string } | FixtureTool)[]> = {
  success: [{ path: '../escaped.js', content: 'forbidden' }, { path: 'pages/home/index.js', content: 'Page({ data: { count: 0 }, add() { this.setData({ count: this.data.count + 2 }) } })\n' }, '计数逻辑已修改。'],
  repair: [{ path: 'pages/home/index.wxml', content: invalidTemplate }, '这一轮已生成。', { path: 'pages/home/index.wxml', content: validTemplate }, '编译问题已修正。'],
  invalid: [{ path: 'pages/home/index.wxml', content: invalidTemplate }, '已生成。', { path: 'pages/home/index.wxml', content: invalidTemplate }, '已修正。', { path: 'pages/home/index.wxml', content: invalidTemplate }, '已修正。'],
  cancel: [{ path: 'pages/home/index.wxml', content: invalidTemplate }, '已生成。', 'WAIT_FOR_CANCEL'],
  capped: ['LIMIT_BEFORE_WRITE', { path: 'pages/home/index.wxml', content: continuedTemplate }, '截断后已完成代码。'],
  repeatedCap: ['LIMIT_BEFORE_WRITE', 'LIMIT_BEFORE_WRITE'],
  capDuringRepair: ['LIMIT_BEFORE_WRITE', { path: 'pages/home/index.wxml', content: invalidTemplate }, '已生成。', 'LIMIT_BEFORE_WRITE'],
}
const designPrelude: FixtureTool[] = [
  { tool: 'doda_read', input: { path: 'DESIGN.md' } },
  { tool: 'doda_read', input: { path: '.design/native/USAGE.md' } },
  { tool: 'doda_use_component', input: { name: 'theme' } },
  { tool: 'doda_use_component', input: { name: 'button' } },
]
for (const name of Object.keys(steps)) steps[name].splice(name === 'success' ? 1 : 0, 0, ...designPrelude)
const repairFeedback: { scenario: string; diagnostic: boolean; frozen: boolean; contextRetained: boolean }[] = []
const continuationFeedback: { scenario: string; frozen: boolean; contextRetained: boolean }[] = []
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  try {
    assert.equal(request.url, '/v1/messages')
    const input = JSON.parse(body)
    assert.equal(input.max_tokens, 16384)
    assert.equal(input.output_config?.effort, 'low')
    assert.deepEqual(input.tools.map((tool: { name: string }) => tool.name).sort(), ['doda_list', 'doda_read', 'doda_use_component', 'doda_write'])
    if (scenario === 'auth-failure') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Fixture authentication failure' } })); return }
    requests++; caseRequests++
    const lastUser = JSON.stringify(input.messages.filter((message: { role: string }) => message.role === 'user').at(-1))
    const previous = input.messages.flatMap((message: { content: any[] }) => Array.isArray(message.content) ? message.content : [])
    if (lastUser.includes('DODA_DELIVERY_CHECK_FAILED')) repairFeedback.push({ scenario, diagnostic: lastUser.includes('pages/home/index.wxml') && lastUser.includes('unexpected character'), frozen: !lastUser.includes('修正时的新想法'), contextRetained: previous.some((block: any) => block.type === 'tool_use' && block.input?.content === invalidTemplate) })
    if (lastUser.includes('DODA_OUTPUT_LIMIT_REACHED')) continuationFeedback.push({ scenario, frozen: lastUser.includes('按钮计数增加2') && !lastUser.includes('截断时的新想法'), contextRetained: previous.some((block: any) => block.type === 'thinking' && block.thinking === 'Fixture output limit before a tool write') })
    if (previous.some((block: any) => block.type === 'tool_result' && JSON.stringify(block).includes('PATH_OUTSIDE_PROJECT'))) rejected = true
    const payload = steps[scenario]?.[caseRequests - 1]
    assert(payload, `Unexpected fixture request ${scenario}:${caseRequests}`)
    if (payload === 'WAIT_FOR_CANCEL') { waitingForRepair = true; pendingResponse = response; return }
    const tool = typeof payload !== 'string'
    const toolName = tool && 'tool' in payload ? payload.tool : 'doda_write'
    const toolInput = tool && 'input' in payload ? payload.input : payload
    const capped = payload === 'LIMIT_BEFORE_WRITE'
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    function event(value: any) { response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`) }
    event({ type: 'message_start', message: { id: `message-${requests}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } })
    event({ type: 'content_block_start', index: 0, content_block: capped ? { type: 'thinking', thinking: '' } : tool ? { type: 'tool_use', id: `tool-${requests}`, name: toolName, input: {} } : { type: 'text', text: '' } })
    event({ type: 'content_block_delta', index: 0, delta: capped ? { type: 'thinking_delta', thinking: 'Fixture output limit before a tool write' } : tool ? { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) } : { type: 'text_delta', text: payload } })
    event({ type: 'content_block_stop', index: 0 })
    event({ type: 'message_delta', delta: { stop_reason: capped ? 'max_tokens' : tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: capped ? input.max_tokens : 40 } })
    event({ type: 'message_stop' }); response.end()
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
const address = server.address()
assert(address && typeof address !== 'string')
const patch = join(root, 'fixture.patch.yml')
await writeFile(patch, `- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:${address.port}\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n`)
const store = new Store(root); await store.load()
const project = store.create('soft-blue'); await scaffold(store.files(project.id), defaultDesigns[0], '')
project.brief = { title: '本地协议验收', audience: '测试', purpose: '验证 DSH 原生工具与交付边界', features: ['按钮计数增加2'], pages: ['首页'], acceptance: ['点击一次显示2'], deferred: [], designId: 'soft-blue' }
const originalCredential = 'sk-doda-protocol-fixture-000000000000000000'
const originalModel = store.settings.model
let credential = originalCredential
let capturedOptions: any
const builder = new Builder(store, () => credential, options => { capturedOptions = options; return new DeepSeekHarness({ ...options, patches: [...(options.patches || []), patch] }) })
async function terminal(run: Run) { const deadline = Date.now() + 60000; while ((run.status === 'running' || !run.finishedAt) && Date.now() < deadline) await new Promise(done => setTimeout(done, 100)); assert.notEqual(run.status, 'running', 'native run did not reach a terminal state'); assert.equal(typeof run.finishedAt, 'string', 'native cleanup did not finish') }
async function archivedOutcome(run: Run, completed: number) {
  const outcome = project.messages.find(message => message.id === `delivery-${run.id}`); assert(outcome)
  assert(project.archive.interview.includes(`doda：${outcome.content}`), 'terminal outcome is missing from the creation archive'); assert(project.archive.interview.includes(outcome.time), 'terminal outcome timestamp is missing from the creation archive')
  assert(project.archive.highlights.includes(`完成了 ${completed} 轮实现。`), 'failed or cancelled work must not count as delivery'); await store.save()
  const persisted = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).projects.find((item: { id: string }) => item.id === project.id); assert.deepEqual(persisted.archive, project.archive)
}
try {
  const starting = builder.start(project)
  credential = 'sk-doda-protocol-new-setting-000000000000000'
  store.settings.model = 'changed-during-preparation'
  const starts = await Promise.allSettled([starting, builder.start(project)])
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1, 'concurrent dispatch must create only one implementation run')
  const accepted = starts.find(result => result.status === 'fulfilled')
  assert(accepted?.status === 'fulfilled')
  const run = accepted.value
  project.brief.features.push('后续新想法')
  await terminal(run)
  assert.equal(run.status, 'completed', run.error)
  assert.equal(capturedOptions.model, originalModel)
  assert.equal(capturedOptions.reasoningEffort, 'low')
  assert.equal(capturedOptions.maxTokens, 16384)
  assert.equal(capturedOptions.env.DEEPSEEK_API_KEY, originalCredential)
  assert.deepEqual(run.snapshot.brief.features, ['按钮计数增加2'])
  assert.equal(rejected, true, 'out-of-project tool call must be denied')
  assert.match(await readFile(join(store.files(project.id), 'pages/home/index.js'), 'utf8'), /count \+ 2/)
  assert(run.diff?.some(file => file.path === 'pages/home/index.js'))
  assert(run.events.some(event => event.kind === 'tool'))
  assert.equal(requests, 7)
  assert.equal(JSON.parse(await readFile(join(store.files(project.id), 'app.json'), 'utf8')).usingComponents['doda-button'], '/components/doda-button/index')
  assert.match(await readFile(join(store.files(project.id), 'app.wxss'), 'utf8'), /@import "styles\/doda.wxss"/)
  assert(run.diff?.some(file => file.path === 'components/doda-button/index.wxml'))
  await archivedOutcome(run, 1)
  await builder.close()
  store.settings.model = originalModel; credential = originalCredential
  scenario = 'auth-failure'
  const previous = await readFile(join(store.files(project.id), 'pages/home/index.js'), 'utf8')
  const failed = await builder.start(project)
  await terminal(failed)
  assert.equal(failed.status, 'failed')
  await archivedOutcome(failed, 1)
  assert.match(failed.error || '', /Fixture authentication failure/)
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.js'), 'utf8'), previous)
  project.brief.features = ['按钮计数增加2']; scenario = 'repair'; caseRequests = 0
  const repaired = await builder.start(project)
  project.brief.features.push('修正时的新想法')
  await terminal(repaired)
  assert.equal(repaired.status, 'completed', repaired.error)
  await archivedOutcome(repaired, 2)
  assert.equal(caseRequests, 8)
  assert.equal(repaired.events.filter(event => event.kind === 'repair').length, 1)
  assert.deepEqual(repaired.snapshot.brief.features, ['按钮计数增加2'])
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.wxml'), 'utf8'), validTemplate)
  assert(repairFeedback.some(feedback => feedback.scenario === 'repair' && feedback.diagnostic && feedback.frozen && feedback.contextRetained))
  project.brief.features = ['按钮计数增加2']
  scenario = 'invalid'; caseRequests = 0
  const invalid = await builder.start(project)
  await terminal(invalid)
  assert.equal(invalid.status, 'failed')
  await archivedOutcome(invalid, 2)
  assert.equal(invalid.events.filter(event => event.kind === 'repair').length, 2)
  assert.equal(caseRequests, 10)
  assert.match(invalid.error || '', /工程检查未通过/)
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.wxml'), 'utf8'), validTemplate)
  scenario = 'cancel'; caseRequests = 0
  const cancelled = await builder.start(project)
  const cancelDeadline = Date.now() + 60000
  while (!waitingForRepair && cancelled.status === 'running' && Date.now() < cancelDeadline) await new Promise(done => setTimeout(done, 100))
  assert.equal(waitingForRepair, true)
  await builder.cancel(project.id); pendingResponse?.destroy()
  assert.equal(cancelled.status, 'cancelled', 'cancellation must settle the native run before acknowledgement')
  await archivedOutcome(cancelled, 2)
  assert.equal(typeof cancelled.finishedAt, 'string', 'cancellation acknowledgement must follow cleanup')
  await terminal(cancelled)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.wxml'), 'utf8'), validTemplate)
  assert(repairFeedback.every(feedback => feedback.diagnostic && feedback.frozen && feedback.contextRetained))
  scenario = 'capped'; caseRequests = 0
  const continued = await builder.start(project)
  project.brief.features.push('截断时的新想法')
  await terminal(continued)
  assert.equal(continued.status, 'completed', continued.error)
  await archivedOutcome(continued, 3)
  assert.equal(caseRequests, 7)
  assert.equal(continued.events.filter(event => event.kind === 'continuation').length, 1)
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.wxml'), 'utf8'), continuedTemplate)
  assert(continuationFeedback.some(feedback => feedback.scenario === 'capped' && feedback.frozen && feedback.contextRetained))
  project.brief.features = ['按钮计数增加2']; scenario = 'repeatedCap'; caseRequests = 0
  const exhausted = await builder.start(project)
  await terminal(exhausted)
  assert.equal(exhausted.status, 'failed')
  await archivedOutcome(exhausted, 3)
  assert.equal(caseRequests, 6)
  assert.equal(exhausted.events.filter(event => event.kind === 'continuation').length, 1)
  assert.match(exhausted.error || '', /输出上限/)
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.wxml'), 'utf8'), continuedTemplate)
  assert(continuationFeedback.every(feedback => feedback.frozen && feedback.contextRetained))
  scenario = 'capDuringRepair'; caseRequests = 0
  const repairCap = await builder.start(project)
  await terminal(repairCap)
  assert.equal(repairCap.status, 'failed')
  await archivedOutcome(repairCap, 3)
  assert.equal(caseRequests, 8)
  assert.equal(repairCap.events.filter(event => event.kind === 'continuation').length, 1)
  assert.equal(repairCap.events.filter(event => event.kind === 'repair').length, 1)
  assert.match(repairCap.error || '', /输出上限/)
  assert.equal(await readFile(join(store.files(project.id), 'pages/home/index.wxml'), 'utf8'), continuedTemplate)
  process.stdout.write(JSON.stringify({ ok: true, layer: 'native DSH with local protocol fixture', requests, concurrentDispatchGuard: true, runtimeConfigFrozen: true, snapshotFrozen: true, traversalRejected: true, committedNativeCode: true, diffRecorded: true, failurePreservedProject: true, compilerFeedbackRepaired: true, repairContextRetained: true, repairLimitEnforced: true, cancellationDuringRepair: true, outputCapContinuation: true, continuationContextRetained: true, continuationLimitEnforced: true, continuationBudgetSharedWithRepair: true, terminalOutcomesArchived: true, persistedTerminalArchives: true, liveDeepseek: false }) + '\n')
} finally { await builder.close(); pendingResponse?.destroy(); await new Promise<void>(done => server.close(() => done())); const delta = relative(resolve(tmpdir()), resolve(root)); assert(!isAbsolute(delta) && !delta.startsWith('..') && delta.startsWith('doda-native-protocol-')); await rm(root, { recursive: true, force: true }) }

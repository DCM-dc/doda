import { describe, expect, it } from 'vitest'
import { requestsVoiceEnd, workFinishDecision, type Project } from '../server/contracts'

function delivered(): Project {
  const brief = { title: '颜色小册', audience: '自己', purpose: '抬头找颜色', features: ['抽颜色'], pages: ['首页'], acceptance: ['抽到一种颜色'], deferred: [], designId: 'mint-garden' }
  return { id: 'project', name: brief.title, createdAt: '', updatedAt: '', phase: 'refine', messages: [], brief, revision: 2, handoffRevision: 2, designId: brief.designId, inspirations: [], archive: { highlights: '', interview: '' }, runs: [{ id: 'delivery', status: 'completed', startedAt: '', finishedAt: '', events: [], snapshot: { id: 'snapshot', revision: 2, hash: 'frozen', brief: structuredClone(brief), time: '', design: { id: brief.designId, name: '薄荷', description: '', version: 1, source: '', tokens: { background: '', surface: '', text: '', muted: '', accent: '', radius: 22 } } } }] }
}

describe('作品收官保留连续聊天', () => {
  it.each([
    '颜色小册这一版作品完成了，功能就到这里，不要加或改；我们继续聊天，不要再整理或编程。我想聊聊抽一个颜色再抬头找东西，会不会比盯屏幕更容易开始。',
    '这版已经做完了，不过我还想聊',
    '这个小程序收官了，我们接着聊',
    '这版不用再改了，继续聊天',
    '作品已经做好了，咱们接着聊聊刚才的感觉',
    '作品完成了。你觉得抬头看看怎么样？我们继续聊',
  ])('明确完成作品 %s 时保持聊天', text => {
    const project = delivered(), before = structuredClone(project)
    expect(workFinishDecision(project, text)).toBe(true)
    expect(requestsVoiceEnd(text)).toBe(false)
    expect(project).toEqual(before)
  })
  it.each([
    '作品还没完成，我们继续聊',
    '如果这版完成了怎么办？继续聊聊',
    '解释“作品完成了”这个按钮，我们先聊',
    '把结局叫“作品完成了”，我们继续聊',
    '台词是作品完成了，继续讨论',
    '需求聊完了交给 agent 做',
    '就按这个做',
    '就这样',
    '今天聊天完成了，晚安',
    '等这版完成了再聊',
    '这版完成之后再收官',
    '不要把作品标记完成，继续聊',
    '作品完成了，但是不要收官，我们继续聊',
    '这版完成了吗？继续聊聊',
    '作品完成了？我们继续聊',
    '这版完成得很快，继续聊',
    '先聊玩法，别整理',
  ])('讨论、否定、引用或交付确认 %s 不收官', text => {
    expect(workFinishDecision(delivered(), text)).toBe(false)
  })
  it.each([false, true])('没有成功交付时拒绝收官 recorded=%s', recorded => {
    const project = delivered(); project.runs[0].status = 'failed'
    expect(workFinishDecision(project, '作品完成了，我们继续聊', recorded)).toBe(false)
  })
  it.each([false, true])('运行中的新一轮任务不能收官 recorded=%s', recorded => {
    const project = delivered(); project.runs.push({ ...structuredClone(project.runs[0]), id: 'pending', status: 'running' })
    expect(workFinishDecision(project, '作品完成了，我们继续聊', recorded)).toBe(false)
  })
  it('需求整理失败时保留未收官状态', () => {
    const project = delivered(); project.requirementsError = '本轮未整理成功'
    expect(workFinishDecision(project, '作品完成了，我们继续聊', true)).toBe(false)
  })
  it('只继续聊天时不接受模型误报的完成字段', () => {
    expect(workFinishDecision(delivered(), '先继续聊，还没决定改不改', true)).toBe(false)
  })
  it('随便聊而没有作品收官话语时不接受模型误报的完成字段', () => {
    expect(workFinishDecision(delivered(), '我们随便聊聊，暂时不改作品', true)).toBe(false)
  })
  it('没有继续讨论要求时保留合格交付后的模型收官语义', () => {
    expect(workFinishDecision(delivered(), '这一版就到这里，不再修改', true)).toBe(true)
  })
  it('作品名中的正则字符按名称匹配，不能扩大收官条件', () => {
    const project = delivered(); project.name = '颜色(小册)+'
    expect(workFinishDecision(project, '颜色(小册)+这一版作品完成了，继续聊')).toBe(true)
    expect(workFinishDecision(project, '颜色小册这一版作品完成了，继续聊')).toBe(false)
  })
})

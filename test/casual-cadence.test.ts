import { describe, expect, it } from 'vitest'
import { dialogueMessages, type Message } from '../server/contracts'

const sharing = '继续随便聊，不整理也不改作品。风没有真的吹起来，手心却像松开了一点。'
const earlier = '你继续做，我们随便聊，不整理。手指把风捏大又捏小，像给烦乱找个小出口。'
const question = '手指一滑，风就有了形状。你烦的时候更想捏成大风，还是回到安静？'
type Turn = Pick<Message, 'role' | 'content'> & Partial<Pick<Message, 'id'>>

function user(content = sharing): Turn { return { role: 'user', content } }
function assistant(content: string, id?: string): Turn { return { role: 'assistant', content, ...(id ? { id } : {}) } }
function paused(history: Turn[]) { return dialogueMessages('先讨论感受', history, null).filter(message => message.role === 'system').every(message => message.content.includes('本轮先接话，不提问。')) }

describe('闲聊问题之后留一轮接话空间', () => {
  it.each([false, true])('上一轮闲聊已提问时本轮系统要求接话 spoken=%s', spoken => {
    const history = [user(earlier), assistant(question), user()], before = structuredClone(history)
    const messages = dialogueMessages('先讨论感受', history, { title: '捏一阵风' }, spoken), systems = messages.filter(message => message.role === 'system')
    expect(systems).toHaveLength(2); expect(systems[0]).toEqual(systems[1]); expect(systems[0].content).toContain('本轮先接话，不提问。'); expect(systems[0].content).toContain('捏一阵风'); expect(history).toEqual(before)
  })
  it('两次闲聊之间的需求卡、确认和交付不替换已问过的闲聊问题', () => {
    expect(paused([user(earlier), assistant(question), user('整理本轮需求给我看'), assistant('就按这张卡交给编程伙伴吗？'), user('就按这张卡做'), assistant('它开始做，我们可以继续聊。'), assistant('这一版可以预览了。', 'delivery-build'), user()])).toBe(true)
  })
  it('本轮用户发言后同时到达的交付通知不遮住接话要求', () => {
    expect(paused([user(earlier), assistant(question), user(), assistant('这一版可以预览了。', 'delivery-build')])).toBe(true)
  })
  it('交付通知里的引用问句不被当成闲聊追问', () => {
    expect(paused([user(earlier), assistant('给乱糟糟的一会儿留个出口，挺舒服。'), assistant('这一版写着你想装哪阵风？', 'delivery-build'), user()])).toBe(false)
  })
  it('已经实际说出的主动闲聊问题同样留接话空间', () => {
    expect(paused([user(earlier), assistant('给这一会儿留个出口，挺舒服。'), assistant('这会让你想到什么？', 'followup-build'), user()])).toBe(true)
  })
  it('最新闲聊回复已经只接话时下一轮允许自然提问', () => {
    expect(paused([user(earlier), assistant(question), user(), assistant('那一点松开，像把烦乱轻轻放下了。'), user()])).toBe(false)
  })
  it('功能讨论的确认问题不占用闲聊轮次', () => {
    expect(paused([user('整理滑动条的需求给我看'), assistant('就按这张卡交给编程伙伴吗？'), user()])).toBe(false)
  })
  it.each([
    '你说的“风能装起来吗？”像一个小愿望。',
    '你说的「风能装起来吗？」像一个小愿望。',
    '你说的 "Can wind fit in a card?" 很有画面。',
    '给这一会儿留一个小出口。',
  ])('引用问题或陈述 %s 不消耗下一轮的提问空间', reply => { expect(paused([user(earlier), assistant(reply), user()])).toBe(false) })
  it.each(['你会想把风捏大吗', 'Would you make the wind louder?'])('没有中文问号也识别实际提问 %s', reply => { expect(paused([user(earlier), assistant(reply), user()])).toBe(true) })
  it.each(['下一轮要不要加声音？', '现在整理需求卡给我看', '就按这张卡做'])('最新功能讨论或执行 %s 保留原讨论规则', text => { expect(paused([user(earlier), assistant(question), user(text)])).toBe(false) })
  it('只有当前闲聊时不凭空暂停提问', () => { expect(paused([user()])).toBe(false) })
  it('超过最近三十条记录的问题不形成永久限制', () => {
    expect(paused([user(earlier), assistant(question), ...Array.from({ length: 15 }, () => [user('整理以前的作品需求'), assistant('这份作品记录已整理。')]).flat(), user()])).toBe(false)
  })
  it('最新用户只引用陪聊句子时不把引用变成指令', () => {
    expect(paused([user(earlier), assistant(question), user('按钮文案写成“继续随便聊，不整理也不改作品”')])).toBe(false)
  })
})

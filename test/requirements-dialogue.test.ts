import { describe, expect, it } from 'vitest'
import { dialogueNeedsDiscussion, requestsRequirementReview } from '../server/contracts'

describe('聊天中尚未决定的问题优先于后台需求卡候选', () => {
  it.each([
    '等公交时点一下就换个念头。是换一句话，还是换一个颜色、一张小图？',
    '这些念头是你自己存进去的，还是一点就随机蹦出来的？',
    '点一下以后出现什么？',
    '你想它出现一句话吗',
    '那你想它变成什么呢。',
    'Which content should change when you tap?',
    'What happens when you tap.',
    'Do you want words or colors',
    '就按这个交给编程伙伴吗？另外，点一下换什么？',
    '让编程伙伴做一句话还是小图？',
    '你觉得交给编程伙伴之前还要确定哪个玩法？',
    '换什么内容？可以交给编程伙伴吗？',
    '你想怎么做一版？',
    '什么时候交给编程伙伴？',
  ])('保留真实讨论：%s', reply => expect(dialogueNeedsDiscussion(reply)).toBe(true))

  it.each([
    '就按这个交给编程伙伴吗？',
    '规则都清楚了。按这张需求卡交给编程伙伴吗？',
    '可以让编程伙伴开始做吗？',
    '按这个方案开始制作吗？',
    '我们先做一版试试吗？',
    '先做出来试试吗？',
    '这个轻巧的玩法正适合等车时放松一下。',
    '页面显示“换什么念头？”这句文案。',
    '页面显示‘换什么念头？’这句文案。',
    '页面显示「换什么念头？」这句文案。',
    '页面显示『换什么念头？』这句文案。',
    '页面显示"换什么念头?"这句文案。',
    "页面显示'换什么念头?'这句文案。",
    '页面显示`换什么念头?`这句文案。',
    '按「换什么念头？」这张卡交给编程伙伴吗？',
  ])('确认交付或引用的问句无需继续讨论：%s', reply => expect(dialogueNeedsDiscussion(reply)).toBe(false))

  it.each(['先整理本轮需求给我看', '请修正需求卡再给我看', '更新这张卡给我看', '看看需求卡'])('明确要求查看卡仍可整理：%s', text => expect(requestsRequirementReview(text)).toBe(true))
  it.each(['等车时点一下换个念头', '我还没决定换什么', '再聊聊这个玩法'])('普通聊天不是整理请求：%s', text => expect(requestsRequirementReview(text)).toBe(false))
  it.each([
    '按钮叫“整理本轮需求”，玩法还没决定',
    '按钮叫‘整理本轮需求’，玩法还没决定',
    '按钮叫「整理本轮需求」，玩法还没决定',
    '按钮叫『整理本轮需求』，玩法还没决定',
    '按钮叫"整理本轮需求"，玩法还没决定',
    "按钮叫'整理本轮需求'，玩法还没决定",
    '按钮叫`整理本轮需求`，玩法还没决定',
    '不要整理本轮需求',
    '暂时不用总结需求',
    '别修正需求卡',
    '不要更新这张卡给我看',
    '先整理本轮需求，想了想还是别整理需求',
  ])('引用与最新否定不是主动整理：%s', text => expect(requestsRequirementReview(text)).toBe(false))
  it.each(['按钮叫「整理本轮需求」，现在请整理需求', '先别整理需求，想了想还是整理本轮需求', '不要编程，先整理本轮需求'])('引用或早先否定不取消后来明确整理：%s', text => expect(requestsRequirementReview(text)).toBe(true))
})

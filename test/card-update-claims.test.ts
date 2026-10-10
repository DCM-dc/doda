import { describe, expect, it } from 'vitest'
import { requestsRequirementReview, requirementsReplyClaimsUpdate } from '../server/contracts'

describe('Repair card requests still review the current requirements', () => {
  it.each([
    ['其他文案和规则不变，先整理修正卡，别开工。', true],
    ['先整理修正卡给我看，别开工。', true],
    ['先更新需求卡给我看，别开工。', true],
    ['先别整理修正卡。', false],
    ['这次不整理修正卡。', false],
    ['按钮文案写「修正卡整理好了」，先讨论这句话。', false],
  ])('%s', (text, expected) => { expect(requestsRequirementReview(text as string)).toBe(expected) })
})

describe('Requirement update claims refer to an actual card commit', () => {
  it.each([
    ['「一笔小光」的修正卡整理好了：线条直接跟着手指走。', true],
    ['需求卡已经更新好了，其他规则不变。', true],
    ['这张卡改好了。', true],
    ['这轮需求已经修正好了。', true],
    ['新的修正卡整理完成。', true],
    ['需求卡中的文字已经更新了。', true],
    ['我把需求卡改好了。', true],
    ['已经更新了这张需求卡。', true],
    ['需求卡整理好了。', false],
    ['需求卡没有更新。', false],
    ['需求卡还没更新好了。', false],
    ['需求卡将会更新好了。', false],
    ['我来更新需求卡。', false],
    ['需求卡已经更新了吗？', false],
    ['按钮上显示「需求卡已更新」。', false],
    ['上次需求卡已经更新好了，这次我们只聊感觉。', false],
    ['如果需求卡更新好了，就接着聊。', false],
    ['我想把需求卡改好了再让你看。', false],
  ])('%s', (reply, expected) => { expect(requirementsReplyClaimsUpdate(reply as string)).toBe(expected) })
})

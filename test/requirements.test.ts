import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { dialogueSchema, dialogueJsonSchema } from '../server/contracts'

const validate = new Ajv().compile(dialogueJsonSchema)
function recorded() { return { reply: 'recorded', handoff: 'offer', finish: false, inspirations: [] as string[], brief: { title: '猫猫故事', audience: '同学', purpose: '一起选择故事结局', features: ['选择下一个场景'], pages: ['故事页'], acceptance: ['选择后进入下一段'], deferred: [] as string[], designId: 'warm-paper' } } }

describe('Requirements structured output contract', () => {
  it('rejects ten acceptance criteria instead of advertising an output the server cannot accept', () => {
    const record = recorded(); record.brief.acceptance = Array.from({ length: 10 }, (_, index) => `第${index + 1}项验收`)
    expect(dialogueSchema.safeParse(record).success).toBe(false)
    expect(validate(record)).toBe(false)
  })
  it('accepts eight criteria at their inclusive text limit', () => {
    const record = recorded(); record.brief.acceptance = Array.from({ length: 8 }, () => '验'.repeat(300))
    expect(validate(record)).toBe(true)
    expect(dialogueSchema.safeParse(record).success).toBe(true)
  })
  it('rejects oversized page descriptions and postponed idea lists in the advertised schema', () => {
    const page = recorded(); page.brief.pages = ['页'.repeat(301)]
    const ideas = recorded(); ideas.inspirations = Array.from({ length: 13 }, () => '以后再做'); ideas.brief.deferred = [...ideas.inspirations]
    for (const record of [page, ideas]) {
      expect(dialogueSchema.safeParse(record).success).toBe(false)
      expect(validate(record)).toBe(false)
    }
  })
  it('accepts a whole supplied story paragraph in a single page description', () => {
    const record = recorded()
    record.brief.pages = ['一页一张卡和一个按钮；封面「路口还有一盏灯」「打开」；打开后「傍晚的小街口，面包店把最后一盏灯留着。有人把自行车靠在门边，先闻到一点热乎乎的甜味，再慢慢想起今天其实没有白过。风从路牌后面绕过来，树叶响了两下。你不必马上做下一件事，只要在这个亮着的小地方站一会儿。等想走了，就把这一小段安静折回口袋，路还是原来的路，脚步可以轻一点。」「合上」；合上或离开回封面。']
    expect(dialogueSchema.safeParse(record).success).toBe(true)
    expect(validate(record)).toBe(true)
  })
  it('accepts a page description at the inclusive 300 character limit', () => {
    const record = recorded(); record.brief.pages = ['页'.repeat(300)]
    expect(dialogueSchema.safeParse(record).success).toBe(true)
    expect(validate(record)).toBe(true)
  })
  it('allows conversation without a brief while refusing an empty feature list', () => {
    const record = recorded()
    expect(validate({ ...record, brief: null, handoff: 'none' })).toBe(true)
    record.brief.features = []
    expect(dialogueSchema.safeParse(record).success).toBe(false)
    expect(validate(record)).toBe(false)
  })
})

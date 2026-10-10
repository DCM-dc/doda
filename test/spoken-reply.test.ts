import { describe, expect, it } from 'vitest'
import { spokenReply } from '../server/contracts'

const actualLongReply = '记下了：主页先放一句「挑一个日子」，用原生日期选择器按天选，范围从2000年到2099年，选好就显示成年月日、中间用横线连起来，装进小盒里。\n\n没选日期时按钮是灰的、点不动，选好才能打开卡片；再放一个清空选择的按钮，点了就回到最开始还没挑日子的样子。这个流程听起来挺顺的，我可以先顺着聊。'

describe('连续语音回复的实际长度边界', () => {
  it('保留真实超长回复中的完整第一句，不截断第二句', () => {
    expect(spokenReply(actualLongReply)).toBe('记下了：主页先放一句「挑一个日子」，用原生日期选择器按天选，范围从2000年到2099年，选好就显示成年月日、中间用横线连起来，装进小盒里。')
  })
  it.each([['短句', '嗯，轻轻留下这一天。'], ['140字边界', '日'.repeat(139)+'。']])('%s 完全保留', (_name, reply) => {
    expect(spokenReply(reply)).toBe(reply)
  })
  it.each(['。','！','？','!','?'])('长回复沿 %s 保留最后一个完整句子', mark => {
    expect(spokenReply('我在听'+mark+'继续聊'+mark+'日'.repeat(150))).toBe('我在听'+mark+'继续聊'+mark)
  })
  it('第一句太长时沿自然分句收口，不留下半个字词', () => {
    expect(spokenReply('这个日子像一片叶子，'+ '日'.repeat(145)+'。')).toBe('这个日子像一片叶子。')
  })
  it('无自然停顿的异常长回复用短接话收口', () => {
    expect(spokenReply('日'.repeat(141))).toBe('这句话我记下了。你接着说，我在听。')
  })
})

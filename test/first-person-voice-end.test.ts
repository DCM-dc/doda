import {describe,expect,it} from 'vitest'
import {requestsVoiceEnd} from '../server/contracts'

describe('第一人称语音结束指令的范围',()=>{
 it.each([
  '这一小会儿先留在这里，我先结束语音。',
  '我先结束语音。',
  '我现在停止语音聊天。',
  '我关闭麦克风。',
  '我先结束语音，之后打字继续聊。',
 ])('明确关闭当前语音：%s',text=>expect(requestsVoiceEnd(text)).toBe(true))
 it.each([
  '这句话引用了“我先结束语音”，我们继续语音聊。',
  '请解释“一个按钮，我先结束语音，返回”这个标题。',
  '如果我先结束语音，会怎么样？',
  '如果打开这张卡，我先结束语音。',
  '我先不要结束语音。',
  '我先结束语音，不过继续语音聊故事。',
  '我先结束需求整理。',
 ])('引用假设否定后续继续或其他工作不关闭语音：%s',text=>expect(requestsVoiceEnd(text)).toBe(false))
})

import {describe,expect,it} from 'vitest'
import {requestsVoiceEnd} from '../server/contracts'

describe('缺少标点的语音结束仍有明确指令边界',()=>{
 it.each([
  '卡片先留着先结束语音。',
  '作品先不改我先结束语音。',
  '这张卡先保留现在暂停语音聊天。',
  '卡片先留着请关掉麦克风。',
  '卡片先留着先结束语音之后打字继续聊。',
  'doda卡片先留着我先结束语音。',
 ])('上下文后明确停止当前语音：%s',text=>expect(requestsVoiceEnd(text)).toBe(true))
 it.each([
  '卡片先留着不要先结束语音。',
  '按钮文字写我先结束语音。',
  '是不是先结束语音。',
  '我之前先结束语音。',
  '他先结束语音。',
  '卡片先留着先结束语音再继续语音聊。',
  '卡片先留着我继续聊故事。',
 ])('否定文案问题过去他人或继续聊天不停止：%s',text=>expect(requestsVoiceEnd(text)).toBe(false))
})

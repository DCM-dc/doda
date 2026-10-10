import {describe,it,expect} from 'vitest'
import {casualQuestionPause} from '../server/contracts'

const pauses=[
 '这些规则已经定了。先聊，不整理，也不编程。',
 '这套规则已经确定了。先聊，不整理。',
 '这些行为已经定了。先聊这些行为，不整理。',
 '玩法已定。继续聊，不整理。',
 '目前功能范围已确定。先聊，不整理。',
]
const continues=[
 '先聊这个规则，不整理。',
 '这些规则还没定。先聊，不整理。',
 '这些规则并没有定。先聊，不整理。',
 '这些规则已经定了吗？先聊，不整理。',
 '这些规则已经定了？先聊，不整理。',
 '他说“这些规则已经定了”。先聊，不整理。',
 '他说「这些规则已经定了」。先聊，不整理。',
 '他说『这些规则已经定了』。先聊，不整理。',
 '他说"这些规则已经定了"。先聊，不整理。',
 '代码里写着 `这些规则已经定了`。先聊，不整理。',
 '如果这些规则已经定了，先聊，不整理。',
 '例如这些规则已经定了，先聊，不整理。',
 '这些规则已经定了，但还有一项没决定。先聊，不整理。',
 '这些规则已经定了，请你问我一个取舍。先聊，不整理。',
 '这些规则已经定了，问我一个还没确定的问题。先聊，不整理。',
 '这些规则已经定了，现在整理本轮需求。',
 '这些规则已经定了，交给编程伙伴开始制作。',
]

describe('已定规则的功能讨论可以直接接话',()=>{
 it.each(pauses)('明确已定且继续讨论的这一句暂停追问：%s',text=>{expect(casualQuestionPause([{role:'user',content:text}])).toBe(true)})
 it.each(continues)('未定、引用、假设、请求提问或交付保持原讨论规则：%s',text=>{expect(casualQuestionPause([{role:'user',content:text}])).toBe(false)})
 it('上一句说已定不能让下一句未定问题继续暂停',()=>{expect(casualQuestionPause([{role:'user',content:pauses[0]},{role:'assistant',content:'这样试来试去，已收的那张还在。'},{role:'user',content:'我还有一个没定的问题，请你问我。先聊，不整理。'}])).toBe(false)})
})

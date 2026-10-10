import { describe, expect, it } from 'vitest'
import { handoffDecision, requestsExplicitHandoff, type Project } from '../server/contracts'

function reviewed(): Project {
  return { id:'reviewed',name:'课间暗号机',phase:'explore',revision:2,handoffRevision:2,designId:'mint-garden',createdAt:'',updatedAt:'',brief:{title:'课间暗号机',audience:'自己和同学',purpose:'写个小暗号',features:['原生表单'],pages:['主页','卡片'],acceptance:['八字上限'],deferred:[],designId:'mint-garden'},messages:[{id:'casual',role:'assistant',content:'我在听，你接着说。',time:''}],runs:[],inspirations:[],archive:{highlights:'',interview:''} }
}
const confirmations=['确认，交给编程伙伴开始制作。','好的，交给编程伙伴开始做吧。','好，交给编程伙伴制作吧。','确定，交给 Agent 开始做。','确认，按这张需求卡做。','确认，照这份需求卡做出来。','好的，就按这个做吧。','可以，交给编程伙伴。','交给编程伙伴开始制作吧。','让编程伙伴开始制作吧。','确认，交给 agent 做出来。','确定，交给 Agent。','好，交给编程伙伴做吧。','现在开始制作。']
const repairConfirmations=['确认这张修正卡交给编程伙伴开始改。','确认这张修正卡，交给编程伙伴开始改。','确定这张需求卡，交给编程伙伴开始修改。','确认本轮需求，交给 Agent 开始修正。','确认当前需求卡，交给编程伙伴制作。','好的，交给编程伙伴开始修改吧。','确认这张卡，交给编程伙伴开始实现。','确认这张修正需求卡，让编程伙伴开始修改吧。']
describe('Compound explicit confirmation dispatches the reviewed current card',()=>{
  it('starts the reviewed version from the actual inline summary confirmation',()=>{const text='好，就按这版开始做吧。';expect(requestsExplicitHandoff(text)).toBe(true);expect(handoffDecision(reviewed(),'none',text,2)).toBe('start')})
  it.each(['好，就按这版开始做吧？','不要按这版开始做。','如果按这版开始做呢？','好，就按这版开始做吧，不过先加登录。','“好，就按这版开始做吧”是按钮文字。'])('%s does not convert a question or proposed change into confirmation',text=>{expect(requestsExplicitHandoff(text)).toBe(false);expect(handoffDecision(reviewed(),'none',text,2)).not.toBe('start')})
  it.each(['按这张需求卡交给编程伙伴做出来。','就按当前需求卡交给 Agent 开始制作。','按这张修正卡交给编程伙伴修改。'])('%s dispatches the reviewed named card',text=>{expect(requestsExplicitHandoff(text)).toBe(true);for(const intent of ['none','offer','confirm'] as const)expect(handoffDecision(reviewed(),intent,text,2)).toBe('start')})
  it.each([...confirmations,...repairConfirmations])('%s is one explicit handoff without depending on the model decision',text=>{
    expect(requestsExplicitHandoff(text)).toBe(true)
    for(const intent of ['none','offer','confirm'] as const)expect(handoffDecision(reviewed(),intent,text,2)).toBe('start')
  })
  it.each(['确认这张修正卡交给编程伙伴开始改？','确认这张修正卡交给编程伙伴开始改?','不要确认这张修正卡交给编程伙伴开始改。','确认这张修正卡，别交给编程伙伴开始改。','如果确认这张修正卡交给编程伙伴开始改呢？','“确认这张修正卡交给编程伙伴开始改”是按钮文字。','确认这张修正卡交给编程伙伴开始改，先加登录。','确认这张修正卡交给编程伙伴开始改，不过先聊聊。','确认这张修正卡交给编程伙伴开始改；先不做。','解释确认这张修正卡交给编程伙伴开始改这句话。','确认这张修正卡。','开始修改。'])('%s does not authorize a repair task',text=>{
    expect(requestsExplicitHandoff(text)).toBe(false)
    for(const intent of ['none','offer','confirm'] as const)expect(handoffDecision(reviewed(),intent,text,2)).not.toBe('start')
  })
  it.each(['确认，交给编程伙伴开始制作？','确认，交给编程伙伴开始制作?','不要确认交给编程伙伴开始制作。','别交给编程伙伴开始制作。','如果我说确认交给编程伙伴开始制作呢？','“确认，交给编程伙伴开始制作”是按钮文字。','`确认交给编程伙伴开始制作`','确认交给编程伙伴开始制作，先加一个登录。','确认交给编程伙伴开始制作，等等先别动。','等我说确认交给编程伙伴开始制作再做。','不是确认交给编程伙伴开始制作。','确认交给编程伙伴开始制作，不过先聊聊。','确认交给编程伙伴开始制作；先不做。','确认交给编程伙伴开始制作，要不要这样？','帮我解释确认交给编程伙伴开始制作这句话。','确认','好的','就按这张塔做。'])('%s does not authorize a build',text=>{
    expect(requestsExplicitHandoff(text)).toBe(false)
    for(const intent of ['none','offer','confirm'] as const)expect(handoffDecision(reviewed(),intent,text,2)).not.toBe('start')
  })
  it.each(['missing','stale','changed'])('%s reviewed revision still offers the current card before dispatch',state=>{
    const p=reviewed();if(state==='missing')delete p.handoffRevision;if(state==='stale')p.handoffRevision=1;if(state==='changed')p.revision=3
    expect(handoffDecision(p,'none','确认，交给编程伙伴开始制作。',2)).toBe('offer')
  })
  it.each(['done','error','no-brief'])('%s project never starts from a compound confirmation',state=>{
    const p=reviewed();if(state==='done')p.phase='done';if(state==='error')p.requirementsError='整理失败';if(state==='no-brief')delete p.brief
    expect(handoffDecision(p,'confirm','确认，交给编程伙伴开始制作。',2)).toBe('none')
  })
  it('a running native task is not duplicated by another compound confirmation',()=>{
    const p=reviewed();p.runs.push({id:'running',status:'running',startedAt:'',events:[],snapshot:{id:'snapshot',revision:2,hash:'frozen',time:'',brief:p.brief!,design:{id:'mint-garden',name:'薄荷',description:'',version:1,source:'',tokens:{background:'',surface:'',text:'',muted:'',accent:'',radius:18}}}})
    expect(handoffDecision(p,'none','确认，交给编程伙伴开始制作。',2)).toBe('none');expect(handoffDecision(p,'confirm','确认，交给编程伙伴开始制作。',2)).toBe('busy')
  })
  it.each(['missing','stale','changed','done','error','no-brief','running'])('a repair confirmation preserves the %s state boundary',state=>{
    const p=reviewed();if(state==='missing')delete p.handoffRevision;if(state==='stale')p.handoffRevision=1;if(state==='changed')p.revision=3;if(state==='done')p.phase='done';if(state==='error')p.requirementsError='整理失败';if(state==='no-brief')delete p.brief
    if(state==='running')p.runs.push({id:'running',status:'running',startedAt:'',events:[],snapshot:{id:'snapshot',revision:2,hash:'frozen',time:'',brief:p.brief!,design:{id:'mint-garden',name:'薄荷',description:'',version:1,source:'',tokens:{background:'',surface:'',text:'',muted:'',accent:'',radius:18}}}})
    const expected={missing:'offer',stale:'offer',changed:'offer',done:'none',error:'none','no-brief':'none',running:'none'}
    expect(handoffDecision(p,'none','确认这张修正卡交给编程伙伴开始改。',2)).toBe(expected[state as keyof typeof expected])
  })
})

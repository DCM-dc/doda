import {describe,it,expect} from 'vitest'
import {Builder} from '../server/dsh'
import {Store} from '../server/store'
import type {Project,Message} from '../server/contracts'

function project(messages:Message[]):Project {
  return {id:'archive-check',name:'课间灵感卡',createdAt:'',updatedAt:'',phase:'explore',messages,revision:1,designId:'warm-paper',runs:[],inspirations:[],archive:{highlights:'',interview:''}}
}
function message(role:'user'|'assistant',content:string,index:number):Message {
  return {id:String(index),role,content,time:`2026-10-07T18:00:0${index}.000Z`}
}
function builder(){return new Builder(new Store('archive-unit-unused'),()=>{throw new Error('Archive formatting must not request a credential')})}

describe('创作档案的对话来源',()=>{
  it('把通知记录为 doda 原话，不虚构成采访问题',()=>{
    const record=project([message('assistant','这一版可以预览了。',0),message('user','我想让圆圈机器人只用圆形。',1)])
    builder().updateArchive(record)
    expect(record.archive.interview).toContain('doda：这一版可以预览了。')
    expect(record.archive.interview).toContain('你：我想让圆圈机器人只用圆形。')
    expect(record.archive.interview).not.toContain('问：')
    expect(record.archive.interview).not.toContain('答：')
    expect(record.archive.interview).not.toContain('创作采访')
  })
  it('问题、回答和交付通知按原时间顺序各记录一次',()=>{
    const messages=[message('assistant','更想画画还是观察？',0),message('user','各两张。',1),message('assistant','这一版可以预览了。',2),message('user','换卡和计数都能用了。',3)]
    const record=project(messages)
    builder().updateArchive(record)
    let previous=-1
    for(const item of messages){const index=record.archive.interview.indexOf(item.content);expect(index).toBeGreaterThan(previous);expect(record.archive.interview.split(item.content)).toHaveLength(2);expect(record.archive.interview).toContain(item.time);previous=index}
  })
  it('首条和连续用户消息也保留原话，不补写缺失的问题',()=>{
    const record=project([message('user','先陪我聊预设内容。',0),message('user','我还没决定要不要加声音。',1)])
    builder().updateArchive(record)
    expect(record.archive.interview).toContain('你：先陪我聊预设内容。')
    expect(record.archive.interview).toContain('你：我还没决定要不要加声音。')
    expect(record.archive.interview).not.toContain('未记录对应问句')
    expect(record.archive.interview).not.toContain('doda：')
  })
  it('只更新派生档案，不修改聊天、需求版本或执行记录',()=>{
    const record=project([message('assistant','好，我们继续聊。',0),message('user','先不改这轮。',1)])
    const before=structuredClone(record)
    builder().updateArchive(record)
    const {archive:_,...rest}=record
    const {archive:__,...original}=before
    expect(rest).toEqual(original)
    expect(record.archive.highlights).toContain('完成了 0 轮实现。')
  })
})

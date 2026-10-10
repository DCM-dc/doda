import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {renderPreview} from '../server/preview'
const out=resolve('../../../work/open-design-live'),{id}=JSON.parse(await readFile(out+'/project.json','utf8')),base='http://127.0.0.1:4318/api'
const records=[]
for(const actions of [['看一眼'],['慢一点','走一步']]){const shot=await renderPreview(resolve('.data/projects',id,'current'),undefined,actions);await writeFile(out+'/state-'+records.length+'.png',shot.data);const response=await fetch(`${base}/projects/${id}/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'需求卡和作品都保持不变。只看这张截图回答：哪张卡片展开了？目前可见的句子是什么？不要根据源码猜，也不需要讨论改动。',image:{data:'data:image/png;base64,'+shot.data.toString('base64'),page:shot.page}})});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));records.push({actions,reply:result.chatReply,headers:Object.fromEntries([...response.headers].filter(([name])=>name.startsWith('x-doda'))),visual:result.messages.findLast((message:any)=>message.role==='user').visual});console.log(JSON.stringify(records.at(-1)))}
await writeFile(out+'/vision-probe.json',JSON.stringify(records,null,2));assert.match(records[0].reply,/看一眼|中间|第二/);assert.match(records[0].reply,/光在这里/);assert.doesNotMatch(records[0].reply,/无法.*图|看不到|仅.*文本/);assert.match(records[1].reply,/慢一点|第一/);assert.match(records[1].reply,/走一步|第三/);assert.match(records[1].reply,/风会等你/);assert.match(records[1].reply,/一步也算/)

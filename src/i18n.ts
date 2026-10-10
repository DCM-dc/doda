import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const zh = {
  'preview.device':'预览机型','preview.options':'预览操作','preview.live':'实时更新','preview.preparing':'正在制作','preview.synced':'已更新','preview.waiting':'等待你的点子','preview.empty':'聊出来，就会在这里出现','preview.touch':'点击体验 · 右键圈选','brief.review':'查看细节','chat.confirm':'好，就按这版开始做吧。',
  'chat.visual':'本轮看到的作品','design.sampleTitle':'一刻小想法','design.sampleAction':'开始看看',
  'common.opening': '正在打开你的作品…', 'common.openFailed': '连接没有成功，请重试。', 'common.retry': '重试', 'common.unavailable': '未连接',
  'nav.showProjects': '展开作品列表', 'nav.hideProjects': '收起作品列表',
  'chat.openWork': '看看这版', 'chat.making': '我在做这版，你继续说', 'chat.checking': '我在检查这版，你继续说', 'chat.finishing': '我在收尾，你继续说', 'preview.storageError': '预览数据没有保存成功，请重试。',
  'voice.start': '开始聊天', 'voice.end': '结束语音', 'voice.keyboard': '打字聊', 'voice.interrupt': '我想说一句', 'voice.off': '点小球，和 doda 聊聊', 'voice.connecting': '正在连接麦克风…', 'voice.listening': '我在听，说说你的想法', 'voice.transcribing': '正在听清你刚才的话…', 'voice.thinking': 'doda 正在想…', 'voice.speaking': 'doda 在说，听完接着聊', 'voice.error': '语音已暂停，点小球重试', 'voice.keys': '配置 DeepSeek 对话和 MiMo 语音后，就可以一直聊。', 'voice.playError': '声音暂时没播出来，聊天文字还在。',
  'brand.tag': '把想法做出来', 'nav.new': '新点子', 'nav.projects': '我的作品', 'nav.settings': '设置', 'nav.designs': '我的风格', 'nav.empty': '你的第一个作品，从一个小点子开始。',
  'chat.welcome': '今天，想做点什么？', 'chat.subtitle': '一个小工具，一个有趣的故事，或者你一直想实现的点子。', 'chat.placeholder': '和 doda 聊聊你的想法…', 'chat.send': '发送', 'chat.summarize': '整理本轮需求', 'chat.thinking': 'doda 正在想…', 'chat.user': '你', 'chat.done': '这次作品完成啦。', 'chat.continue': '继续创作', 'chat.finish': '就这样，完成了', 'chat.voice': '开始语音', 'chat.listening': '正在听你说…', 'chat.stopVoice': '停止语音', 'chat.read': '朗读', 'chat.stopRead': '停止播放', 'chat.noAsr': '当前环境不支持语音识别，可以继续使用文字。', 'chat.region': '正在讨论选中的区域', 'chat.clearRegion': '取消选区',
  'idea.cat': '记录我家猫的吃饭时间', 'idea.reading': '做一个我的读书清单', 'idea.story': '做一个可以选择结局的故事',
  'project.untitled': '新的小点子', 'project.explore': '聊聊想法', 'project.refine': '打磨作品', 'project.done': '已完成', 'project.export': '导出小程序', 'project.devtools': '微信开发者工具',
  'panel.brief': '本轮需求', 'panel.preview': '预览', 'panel.files': '代码', 'panel.activity': '执行记录', 'panel.archive': '创作档案', 'panel.design': '设计系统', 'panel.empty': '先聊一聊你的想法。确定要做什么以后，这里会出现本轮需求。',
  'brief.title': '作品名称', 'brief.audience': '给谁用', 'brief.purpose': '它要帮你做什么', 'brief.features': '这次先做', 'brief.pages': '页面', 'brief.acceptance': '怎样算做好了', 'brief.deferred': '留给下次', 'brief.save': '保存需求', 'brief.edit': '修改需求', 'brief.build': '开始制作', 'brief.building': '我在做这版，你继续说', 'brief.cancel': '停止本轮', 'brief.frozen': '本轮需求已固定，新的想法会留到下一轮。', 'brief.saved': '需求已保存。', 'brief.changed': '修改已暂存，保存后再开始制作。',
  'preview.note': '布局预览 · 微信能力以真机为准', 'preview.select': '右键选择区域', 'preview.check': '检查工程', 'preview.previewCode': '生成微信预览码', 'preview.upload': '上传代码', 'preview.uploadNote': '上传后仍需在微信公众平台提审与发布。', 'preview.export': '下载源码 ZIP', 'preview.selectPage': '选择页面',
  'files.empty': '选择一个文件，看看作品是怎样组成的。', 'files.diff': '本轮修改', 'files.before': '修改前', 'files.after': '修改后', 'files.source': '文件内容',
  'activity.empty': '开始制作以后，这里会记录这版的进展。', 'activity.completed': '本轮已交付', 'activity.failed': '本轮未完成', 'activity.cancelled': '本轮已停止', 'activity.running': '制作中', 'activity.hash': '需求版本',
  'design.title': '给点子选一种风格', 'design.unavailable': '原风格不可用，请重新选择', 'design.save': '把这个风格存起来', 'design.name': '风格名称', 'design.saved': '设计系统已保存，下个项目也能用。', 'design.reuse': '用这个风格开始新项目', 'design.accent': '主题色',
  'archive.highlights': '创作记录', 'archive.interview': '对话摘录', 'archive.empty': '你的想法和完成的任务，会在这里慢慢积累。',
  'settings.title': '设置', 'settings.model': 'DeepSeek 模型', 'settings.deepseek': 'DeepSeek API key', 'settings.mimo': 'MiMo 语音 key', 'settings.configured': '已配置，留空保留', 'settings.missing': '尚未配置', 'settings.voice': 'doda 的声音', 'settings.male': '苏打 · 男声', 'settings.female': '冰糖 · 女声', 'settings.autoSpeak': '自动朗读 doda 的回复', 'settings.talk': '陪伴节奏', 'settings.quiet': '安静', 'settings.standard': '标准', 'settings.lively': '活泼', 'settings.devtools': '微信开发者工具 cli.bat 路径', 'settings.appId': '小程序 AppID', 'settings.uploadKey': '代码上传密钥文件路径', 'settings.save': '保存设置', 'settings.saved': '设置已保存。', 'settings.testVoice': '试听声音', 'settings.models': '读取模型列表', 'settings.close': '关闭', 'settings.voiceText': '你好呀，我是 doda。我们先把你的想法聊清楚，再一起把它做出来。',
  'common.loading': '正在加载…', 'common.error': '没有完成', 'common.close': '关闭', 'common.refresh': '刷新', 'common.ready': '已准备好', 'common.setup': '配置 DeepSeek 后开始对话', 'common.newline': '每行一项', 'common.empty': '暂时没有', 'common.openSettings': '打开设置', 'common.connected': 'doda 已连接', 'common.orbIdle': 'doda 小球',
}
const en = { ...zh }
Object.assign(en,{'chat.visual':'Work shared this turn','design.sampleTitle':'A little idea','design.sampleAction':'Take a look'})
Object.assign(en, { 'voice.playError': 'Audio could not play, but the conversation text is still here.', 'nav.showProjects': 'Show projects', 'nav.hideProjects': 'Hide projects', 'brand.tag': 'Make your ideas real', 'nav.new': 'New idea', 'nav.projects': 'My projects', 'nav.settings': 'Settings', 'chat.welcome': 'What shall we make today?', 'chat.send': 'Send', 'chat.placeholder': 'Tell doda about your idea…', 'brief.build': 'Start making', 'settings.save': 'Save settings', 'settings.close': 'Close' })
void i18n.use(initReactI18next).init({ lng: 'zh-CN', fallbackLng: 'zh-CN', resources: { 'zh-CN': { translation: zh }, 'en-US': { translation: en } }, interpolation: { escapeValue: false } })
export default i18n

import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const { JSDOM } = createRequire(import.meta.url)('jsdom') as typeof import('jsdom')
const windows: InstanceType<typeof JSDOM>[] = []
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); vi.useRealTimers() })

const formMarkup = '<view id="parent"><form id="letter" data-index="{{7}}" bindsubmit="collect" bindreset="clear"><input id="word" name="word" maxlength="8" value="{{word}}" bindinput="input"/><textarea id="note" name="note" value="{{note}}"/><switch id="quiet" name="quiet" checked="{{quiet}}" bindchange="quietChange"/><button id="send" data-index="{{3}}" form-type="submit">收好</button><button id="clear" form-type="reset">重写</button><button id="ordinary">普通按钮</button></form></view><button id="rerender" bindtap="rerender">更新</button><button id="leave" bindtap="leave">离开</button>'
async function nativeForm(markup = formMarkup, methods = '') {
  return preview({ 'pages/home/index.js': 'Page({data:{word:"",quiet:false,note:"",revision:0},input(e){this.setData({word:e.detail.value})},quietChange(e){this.setData({quiet:e.detail.value})},collect(e){getApp().globalData.events??=[];getApp().globalData.events.push(e)},clear(e){getApp().globalData.resetEvent=e;this.setData({word:"",quiet:false,note:""})},rerender(){this.setData({revision:this.data.revision+1})},leave(){wx.navigateTo({url:"/pages/records/index"})},' + methods + '})' }, '', '', markup)
}
type NativeFormEvent = { type: string; timeStamp: number; detail: { value: Record<string, string | string[] | boolean | number>; target: { id: string; dataset: Record<string, unknown> } }; currentTarget: { id: string; dataset: Record<string, unknown> }; target: { id: string; dataset: Record<string, unknown> } }
function formEvent(dom: InstanceType<typeof JSDOM>): NativeFormEvent[] { const result = dom.window.eval('getApp().globalData.events'); expect(Array.isArray(result)).toBe(true); expect(result).toHaveLength(1); return result as NativeFormEvent[] }
function formControl<T extends Element = HTMLElement>(dom: InstanceType<typeof JSDOM>, id: string) { const result = dom.window.document.querySelector<T>('#' + id); expect(result).not.toBeNull(); return result! }
function editForm(dom: InstanceType<typeof JSDOM>, word: string, quiet = false) { const input = formControl<HTMLInputElement>(dom, 'word'); input.value = word; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); const toggle = formControl<HTMLInputElement>(dom, 'quiet'); toggle.checked = quiet; toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true })) }

const sliderFormMarkup = '<form bindsubmit="collect" bindreset="resetLight"><slider id="light" name="light" min="0" max="100" step="10" value="{{light}}" show-value bindchanging="slide" bindchange="slide"/><switch id="quiet" name="gentle" checked="{{quiet}}" bindchange="quietChange"/><button id="send" form-type="submit">留住</button><button id="clear" form-type="reset">回中间</button></form>'
async function sliderForm(markup = sliderFormMarkup) { return nativeForm(markup, 'onLoad(){this.setData({light:50})},slide(e){this.setData({light:e.detail.value})},resetLight(e){getApp().globalData.resetEvent=e;this.setData({light:50,quiet:false})}') }
function slideForm(dom: InstanceType<typeof JSDOM>, value: number, event = 'change') { const slider = formControl<HTMLInputElement>(dom, 'light'); slider.value = String(value); slider.dispatchEvent(new dom.window.Event(event, { bubbles: true })) }

const choiceFormMarkup = '<form id="note" bindsubmit="collect" bindreset="resetChoices"><radio-group id="place" name="place" bindchange="placeChange"><radio id="window" value="窗边" checked="{{place===\'窗边\'}}"/><radio id="hall" value="走廊" checked="{{place===\'走廊\'}}"/><radio id="corner" value="桌角" checked="{{place===\'桌角\'}}"/></radio-group><checkbox-group id="extras" name="extras" bindchange="extrasChange"><checkbox id="cloud" value="一朵云" checked="{{extras.indexOf(\'一朵云\')>-1}}"/><checkbox id="wind" value="一阵风" checked="{{extras.indexOf(\'一阵风\')>-1}}"/><checkbox id="sun" value="一束光" checked="{{extras.indexOf(\'一束光\')>-1}}"/></checkbox-group><button id="send" form-type="submit">收好</button><button id="clear" form-type="reset">回窗边</button></form><button id="rerender" bindtap="rerender">更新</button>'
async function choiceForm(markup = choiceFormMarkup) { return nativeForm(markup, 'onLoad(){this.setData({place:"窗边",extras:[]})},placeChange(e){this.setData({place:e.detail.value})},extrasChange(e){this.setData({extras:e.detail.value})},resetChoices(e){getApp().globalData.resetEvent=e;this.setData({place:"窗边",extras:[]})}') }
function chooseForm(dom: InstanceType<typeof JSDOM>, id: string) { formControl<HTMLInputElement>(dom, id).click() }

describe('Native form choice groups submit current strings and arrays', () => {
  it('initial place and valid empty extras are both present in the form', async () => { const dom = await choiceForm(); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '窗边', extras: [] }) })
  it.each([['window', '窗边'], ['hall', '走廊'], ['corner', '桌角']])('selected %s is the current scalar string %s', async (id, value) => { const dom = await choiceForm(); chooseForm(dom, id); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: value, extras: [] }) })
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('checkbox subset %s is a string array including the empty subset', async mask => { const dom = await choiceForm(), ids = ['cloud', 'wind', 'sun'], values = ['一朵云', '一阵风', '一束光']; for (let index = 0; index < 3; index++) if (mask & (1 << index)) chooseForm(dom, ids[index]); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '窗边', extras: values.filter((_value, index) => mask & (1 << index)) }); expect(Array.isArray(formEvent(dom)[0].detail.value.extras)).toBe(true) })
  it('reverse click order still submits checkboxes in their page order', async () => { const dom = await choiceForm(); for (const id of ['sun', 'wind', 'cloud']) chooseForm(dom, id); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value.extras).toEqual(['一朵云', '一阵风', '一束光']) })
  it('uncontrolled groups read the current DOM rather than old page data', async () => { const dom = await choiceForm(choiceFormMarkup.replace('bindchange="placeChange"', '').replace('bindchange="extrasChange"', '')); chooseForm(dom, 'hall'); chooseForm(dom, 'sun'); chooseForm(dom, 'send'); expect(dom.window.eval('getCurrentPages()[0].data.place')).toBe('窗边'); expect(dom.window.eval('getCurrentPages()[0].data.extras')).toEqual([]); expect(formEvent(dom)[0].detail.value).toEqual({ place: '走廊', extras: ['一束光'] }) })
  it('later choice edits cannot mutate the captured array or place', async () => { const dom = await choiceForm(); chooseForm(dom, 'hall'); chooseForm(dom, 'cloud'); chooseForm(dom, 'send'); chooseForm(dom, 'corner'); chooseForm(dom, 'cloud'); chooseForm(dom, 'wind'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '走廊', extras: ['一朵云'] }) })
  it('reset handler restores the reviewed draft while its old submitted card stays independent', async () => { const dom = await choiceForm(); chooseForm(dom, 'corner'); chooseForm(dom, 'sun'); chooseForm(dom, 'send'); chooseForm(dom, 'clear'); expect(formControl<HTMLInputElement>(dom, 'window').checked).toBe(true); expect(formControl<HTMLInputElement>(dom, 'corner').checked).toBe(false); expect(formControl<HTMLInputElement>(dom, 'sun').checked).toBe(false); expect(formEvent(dom)[0].detail.value).toEqual({ place: '桌角', extras: ['一束光'] }); expect(dom.window.eval('getApp().globalData.resetEvent.type')).toBe('reset') })
  it('unhandled reset clears unnamed choices without synthesizing group change events', async () => { const dom = await choiceForm(choiceFormMarkup.replace('bindreset="resetChoices"', '').replace('name="place"', '').replace('name="extras"', '')); chooseForm(dom, 'hall'); chooseForm(dom, 'sun'); let changes = 0; for (const id of ['place', 'extras']) formControl(dom, id).addEventListener('change', () => changes++); chooseForm(dom, 'clear'); expect(Array.from(dom.window.document.querySelectorAll<HTMLInputElement>('input[type=radio],input[type=checkbox]')).every(control => !control.checked)).toBe(true); expect(formControl<HTMLInputElement>(dom, 'hall').value).toBe('走廊'); expect(formControl<HTMLInputElement>(dom, 'sun').value).toBe('一束光'); expect(changes).toBe(0) })
  it('unnamed groups and standalone choice inputs do not invent form fields', async () => { const dom = await choiceForm(choiceFormMarkup.replace('name="place"', '').replace('name="extras"', '').replace('<button id="send"', '<checkbox name="lone" value="extra" checked/><radio name="single" value="extra" checked/><button id="send"')); chooseForm(dom, 'cloud'); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({}) })
  it('sibling forms collect only their own two named groups', async () => { const dom = await choiceForm(choiceFormMarkup + '<form bindsubmit="collect"><radio-group name="otherPlace"><radio value="外面" checked/></radio-group><checkbox-group name="otherExtras"><checkbox value="另一片" checked/></checkbox-group><button id="second" form-type="submit">另一张</button></form>'); chooseForm(dom, 'hall'); chooseForm(dom, 'cloud'); chooseForm(dom, 'second'); expect(formEvent(dom)[0].detail.value).toEqual({ otherPlace: '外面', otherExtras: ['另一片'] }) })
  it('resetting a sibling form leaves the first place and extras checked', async () => { const dom = await choiceForm(choiceFormMarkup + '<form><radio-group><radio id="otherRadio" value="外面" checked/></radio-group><checkbox-group><checkbox id="otherCheckbox" value="另一片" checked/></checkbox-group><button id="second" form-type="reset">另一张</button></form>'); chooseForm(dom, 'hall'); chooseForm(dom, 'sun'); chooseForm(dom, 'second'); expect(formControl<HTMLInputElement>(dom, 'hall').checked).toBe(true); expect(formControl<HTMLInputElement>(dom, 'sun').checked).toBe(true); expect(formControl<HTMLInputElement>(dom, 'otherRadio').checked).toBe(false); expect(formControl<HTMLInputElement>(dom, 'otherCheckbox').checked).toBe(false); expect(formControl<HTMLInputElement>(dom, 'otherRadio').value).toBe('外面') })
  it('nested groups contribute only choices belonging to their nearest named group', async () => { const dom = await choiceForm('<form bindsubmit="collect"><radio-group name="outerPlace"><radio id="outerRadio" value="外侧" checked/><radio-group name="innerPlace"><radio id="innerRadio" value="内侧" checked/></radio-group></radio-group><checkbox-group name="outerExtras"><checkbox value="外云" checked/><checkbox-group name="innerExtras"><checkbox value="内云" checked/></checkbox-group></checkbox-group><button id="send" form-type="submit">收好</button></form>'); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ outerPlace: '外侧', innerPlace: '内侧', outerExtras: ['外云'], innerExtras: ['内云'] }) })
  it('multiple groups with identical choice values remain independent', async () => { const dom = await choiceForm(choiceFormMarkup.replace('<button id="send"', '<radio-group name="otherPlace"><radio value="窗边" checked/></radio-group><checkbox-group name="otherExtras"><checkbox value="一朵云" checked/></checkbox-group><button id="send"')); chooseForm(dom, 'corner'); chooseForm(dom, 'sun'); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '桌角', extras: ['一束光'], otherPlace: '窗边', otherExtras: ['一朵云'] }); expect(Object.keys(formEvent(dom)[0].detail.value).some(name => name.startsWith('doda-radio-'))).toBe(false) })
  it('choice strings keep literal zero and empty text without fallback', async () => { const dom = await choiceForm('<form bindsubmit="collect"><radio-group name="place"><radio value="0" checked/></radio-group><checkbox-group name="extras"><checkbox value="" checked/><checkbox value="0" checked/></checkbox-group><button id="send" form-type="submit">收好</button></form>'); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '0', extras: ['', '0'] }) })
  it('an empty named group keeps its empty scalar or array instead of being omitted', async () => { const dom = await choiceForm('<form bindsubmit="collect"><radio-group name="place"/><checkbox-group name="extras"/><button id="send" form-type="submit">收好</button></form>'); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '', extras: [] }) })
  it('choice group fields retain types alongside text slider and switch fields', async () => { const dom = await choiceForm(choiceFormMarkup.replace('<button id="send"', '<input name="word" value="0"/><slider name="light" value="0"/><switch name="gentle"/><button id="send"')); chooseForm(dom, 'cloud'); chooseForm(dom, 'send'); expect(formEvent(dom)[0].detail.value).toEqual({ place: '窗边', extras: ['一朵云'], word: '0', light: 0, gentle: false }) })
  it('rerender keeps one submit listener and reads the latest controlled groups', async () => { const dom = await choiceForm(), submit = formControl<HTMLButtonElement>(dom, 'send'); for (let index = 0; index < 3; index++) chooseForm(dom, 'rerender'); chooseForm(dom, 'hall'); chooseForm(dom, 'wind'); expect(formControl(dom, 'send')).toBe(submit); submit.click(); expect(formEvent(dom)[0].detail.value).toEqual({ place: '走廊', extras: ['一阵风'] }) })
  it('prototype-named group values remain own fields and arrays', async () => { const dom = await choiceForm(choiceFormMarkup.replace('name="extras"', 'name="__proto__"')); chooseForm(dom, 'cloud'); chooseForm(dom, 'send'); const value = formEvent(dom)[0].detail.value; expect(Object.hasOwn(value, '__proto__')).toBe(true); expect(value.__proto__).toEqual(['一朵云']); expect(Object.getPrototypeOf(value)).not.toBe(value.__proto__) })
})

describe('Native form sliders preserve numeric zero and current values', () => {
  it('default form submission carries a number and boolean false', async () => { const dom = await sliderForm(); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ light: 50, gentle: false }) })
  it.each([0, 10, 40, 50, 100])('committed slider value %s remains a numeric form field', async value => { const dom = await sliderForm(); slideForm(dom, value); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ light: value, gentle: false }); expect(typeof formEvent(dom)[0].detail.value.light).toBe('number') })
  it('changing input commits the current zero before slider release', async () => { const dom = await sliderForm(); slideForm(dom, 0, 'input'); expect(dom.window.document.querySelector('output')!.textContent).toBe('0'); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ light: 0, gentle: false }) })
  it('zero and true are preserved independently in one captured form object', async () => { const dom = await sliderForm(); slideForm(dom, 0); const toggle = formControl<HTMLInputElement>(dom, 'quiet'); toggle.checked = true; toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true })); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ light: 0, gentle: true }) })
  it('later sliding does not mutate the already submitted numeric value', async () => { const dom = await sliderForm(); slideForm(dom, 0); formControl<HTMLButtonElement>(dom, 'send').click(); slideForm(dom, 100); expect(formEvent(dom)[0].detail.value).toEqual({ light: 0, gentle: false }); expect(formControl<HTMLInputElement>(dom, 'light').value).toBe('100') })
  it('reset handler restores the reviewed midpoint and false without changing the captured card', async () => { const dom = await sliderForm(); slideForm(dom, 0); const toggle = formControl<HTMLInputElement>(dom, 'quiet'); toggle.checked = true; toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true })); formControl<HTMLButtonElement>(dom, 'send').click(); formControl<HTMLButtonElement>(dom, 'clear').click(); expect(formControl<HTMLInputElement>(dom, 'light').value).toBe('50'); expect(formControl<HTMLInputElement>(dom, 'quiet').checked).toBe(false); expect(formEvent(dom)[0].detail.value).toEqual({ light: 0, gentle: true }) })
  it('unnamed slider does not add an invented field to the form', async () => { const dom = await sliderForm(sliderFormMarkup.replace('name="light"', '')); slideForm(dom, 0); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ gentle: false }) })
  it('sibling named sliders remain outside the submitting form', async () => { const dom = await sliderForm(sliderFormMarkup + '<form bindsubmit="collect"><slider name="other" min="0" max="100" value="80"/><button id="otherSubmit" form-type="submit">另一格</button></form>'); formControl<HTMLButtonElement>(dom, 'otherSubmit').click(); expect(formEvent(dom)[0].detail.value).toEqual({ other: 80 }) })
  it('each named slider keeps its own numeric value alongside literal text fields', async () => { const dom = await sliderForm(sliderFormMarkup.replace('<button id="send"', '<input name="word" value="0"/><slider name="other" value="90"/><button id="send"')); slideForm(dom, 0); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ light: 0, gentle: false, word: '0', other: 90 }) })
})

describe('Native form buttons dispatch typed named values and reset events', () => {
  it('empty strings and false are present as named form values', async () => { const dom = await nativeForm(); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)).toHaveLength(1); expect(formEvent(dom)[0].detail.value).toEqual({ word: '', note: '', quiet: false }) })
  it('reads current controls at submission without trimming their strings', async () => { const dom = await nativeForm(); editForm(dom, ' 月光 ', true); formControl<HTMLTextAreaElement>(dom, 'note').value = '一句话'; formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ word: ' 月光 ', note: '一句话', quiet: true }) })
  it('reads uncontrolled current field values instead of page data', async () => { const dom = await nativeForm(); formControl<HTMLInputElement>(dom, 'word').value = '窗边'; formControl<HTMLInputElement>(dom, 'quiet').checked = true; formControl<HTMLButtonElement>(dom, 'send').click(); expect(dom.window.eval('getCurrentPages()[0].data.word')).toBe(''); expect(formEvent(dom)[0].detail.value).toEqual({ word: '窗边', note: '', quiet: true }) })
  it('captures an independent value object before later edits', async () => { const dom = await nativeForm(); editForm(dom, '窗边', true); formControl<HTMLButtonElement>(dom, 'send').click(); editForm(dom, '走廊', false); expect(formEvent(dom)[0].detail.value).toEqual({ word: '窗边', note: '', quiet: true }) })
  it.each([['bindsubmit', 1], ['bind:submit', 1], ['catchsubmit', 0], ['catch:submit', 0]])('%s carries form and submitting-button identity with parent count %s', async (binding, parentsExpected) => {
    const dom = await nativeForm(formMarkup.replace('bindsubmit', binding)); let parents = 0; formControl(dom, 'parent').addEventListener('submit', () => parents++); formControl<HTMLButtonElement>(dom, 'send').click(); const event = formEvent(dom)[0]; expect(event.type).toBe('submit'); expect(typeof event.timeStamp).toBe('number'); expect(event.currentTarget).toEqual({ id: 'letter', dataset: { index: 7 } }); expect(event.target).toEqual({ id: 'letter', dataset: { index: 7 } }); expect(event.detail.target).toEqual({ id: 'send', dataset: { index: 3 } }); expect(parents).toBe(parentsExpected)
  })
  it.each([['bindreset', 1], ['bind:reset', 1], ['catchreset', 0], ['catch:reset', 0]])('%s resets only the draft and carries native target with parent count %s', async (binding, parentsExpected) => {
    const dom = await nativeForm(formMarkup.replace('bindreset', binding)); editForm(dom, '窗边', true); formControl<HTMLButtonElement>(dom, 'send').click(); let parents = 0; formControl(dom, 'parent').addEventListener('reset', () => parents++); formControl<HTMLButtonElement>(dom, 'clear').click(); expect(formControl<HTMLInputElement>(dom, 'word').value).toBe(''); expect(formControl<HTMLInputElement>(dom, 'quiet').checked).toBe(false); expect(dom.window.eval('getApp().globalData.resetEvent')).toMatchObject({ type: 'reset' }); expect(dom.window.eval('getApp().globalData.resetEvent.detail')).toEqual({ target: { id: 'clear', dataset: {} } }); expect(formEvent(dom)[0].detail.value).toEqual({ word: '窗边', note: '', quiet: true }); expect(parents).toBe(parentsExpected)
  })
  it.each(['form-type', 'formType'])('%s supports both submit and reset button attributes', async attribute => { const dom = await nativeForm(formMarkup.replaceAll('form-type', attribute)); editForm(dom, '窗边', true); formControl<HTMLButtonElement>(dom, 'send').click(); formControl<HTMLButtonElement>(dom, 'clear').click(); expect(formEvent(dom)[0].detail.value.word).toBe('窗边'); expect(dom.window.eval('getApp().globalData.resetEvent')).toMatchObject({ type: 'reset' }) })
  it('ordinary buttons inside the form never submit', async () => { const dom = await nativeForm(); formControl<HTMLButtonElement>(dom, 'ordinary').click(); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined(); expect(dom.window.eval('getApp().globalData.resetEvent')).toBeUndefined() })
  it('a submit-marked button outside the form has no receiving form', async () => { const dom = await nativeForm(formMarkup + '<button id="outside" form-type="submit">外面</button>'); formControl<HTMLButtonElement>(dom, 'outside').click(); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined() })
  it('only named native fields are submitted', async () => { const dom = await nativeForm(formMarkup.replace('name="word"', '').replace('name="quiet"', '') + '<input name="outside" value="不能混入"/>'); formControl<HTMLButtonElement>(dom, 'send').click(); expect(formEvent(dom)[0].detail.value).toEqual({ note: '' }) })
  it('sibling forms submit only their own fields', async () => { const dom = await nativeForm(formMarkup + '<form bindsubmit="collect"><input name="other" value="另一张"/><button id="second" form-type="submit">第二张</button></form>'); formControl<HTMLButtonElement>(dom, 'second').click(); expect(formEvent(dom)).toHaveLength(1); expect(formEvent(dom)[0].detail.value).toEqual({ other: '另一张' }) })
  it('resetting a sibling form leaves the first form unchanged', async () => { const dom = await nativeForm(formMarkup + '<form bindreset="secondReset"><input id="secondWord" name="other" value="另一张"/><button id="second" form-type="reset">第二张</button></form>', 'secondReset(e){getApp().globalData.otherReset=e}'); editForm(dom, '窗边', true); formControl<HTMLButtonElement>(dom, 'second').click(); expect(dom.window.eval('getApp().globalData.otherReset')).toMatchObject({ type: 'reset' }); expect(formControl<HTMLInputElement>(dom, 'word').value).toBe('窗边'); expect(formControl<HTMLInputElement>(dom, 'quiet').checked).toBe(true) })
  it.each(['send', 'clear'])('disabled %s button does not dispatch', async id => { const dom = await nativeForm(); const button = formControl<HTMLButtonElement>(dom, id); button.disabled = true; button.click(); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined(); expect(dom.window.eval('getApp().globalData.resetEvent')).toBeUndefined() })
  it('a reset button clears uncontrolled unnamed fields without synthetic input changes', async () => { const dom = await nativeForm(formMarkup.replace('bindreset="clear"', '') + '<input id="outside" value="外面"/>'); let edits = 0; editForm(dom, '窗边', true); formControl(dom, 'word').removeAttribute('name'); formControl(dom, 'word').addEventListener('input', () => edits++); formControl(dom, 'quiet').addEventListener('change', () => edits++); formControl<HTMLButtonElement>(dom, 'clear').click(); expect(formControl<HTMLInputElement>(dom, 'word').value).toBe(''); expect(formControl<HTMLInputElement>(dom, 'quiet').checked).toBe(false); expect(formControl<HTMLInputElement>(dom, 'outside').value).toBe('外面'); expect(edits).toBe(0) })
  it('rerender preserves one form listener and fresh typed values', async () => { const dom = await nativeForm(); const button = formControl<HTMLButtonElement>(dom, 'send'); for (let i = 0; i < 3; i++) formControl<HTMLButtonElement>(dom, 'rerender').click(); editForm(dom, '窗边', true); expect(formControl(dom, 'send')).toBe(button); button.click(); expect(formEvent(dom)).toHaveLength(1); expect(formEvent(dom)[0].detail.value.quiet).toBe(true) })
  it('departed-page submit buttons cannot invoke the new page handler', async () => { const dom = await nativeForm(); const button = formControl<HTMLButtonElement>(dom, 'send'); formControl<HTMLButtonElement>(dom, 'leave').click(); button.click(); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined(); expect(dom.window.eval('getCurrentPages().at(-1).route')).toBe('pages/records/index') })
  it('removed submit buttons cannot dispatch', async () => { const dom = await nativeForm(); const button = formControl<HTMLButtonElement>(dom, 'send'); button.remove(); button.click(); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined() })
  it('untrusted browser submit or reset events do not become native form events', async () => { const dom = await nativeForm(); const form = formControl(dom, 'letter'); form.dispatchEvent(new dom.window.CustomEvent('submit', { bubbles: true, detail: { value: { word: '假的' } } })); form.dispatchEvent(new dom.window.CustomEvent('reset', { bubbles: true })); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined(); expect(dom.window.eval('getApp().globalData.resetEvent')).toBeUndefined() })
  it('prototype-named fields are own named values without changing the result prototype', async () => { const dom = await nativeForm(formMarkup.replace('name="word"', 'name="__proto__"')); editForm(dom, '窗边'); formControl<HTMLButtonElement>(dom, 'send').click(); const value = formEvent(dom)[0].detail.value; expect(Object.hasOwn(value, '__proto__')).toBe(true); expect(value.__proto__).toBe('窗边'); expect(Object.getPrototypeOf(value)).not.toBe('窗边') })
  it('the submit handler can open the next native page once using the captured values', async () => { const dom = await nativeForm(formMarkup.replace('bindsubmit="collect"', 'bindsubmit="openCard"'), 'openCard(e){getApp().globalData.card=e.detail.value;wx.navigateTo({url:"/pages/records/index"})}'); editForm(dom, '窗边', true); formControl<HTMLButtonElement>(dom, 'send').click(); expect(dom.window.eval('getCurrentPages().length')).toBe(2); expect(dom.window.eval('getApp().globalData.card')).toEqual({ word: '窗边', note: '', quiet: true }) })
})

async function multiPicker(markup = '<view id="parent"><picker id="moment" mode="multiSelector" range="{{ranges}}" value="{{value}}" disabled="{{locked}}" wx:if="{{show}}" data-index="{{7}}" data-kind="moment" aria-label="取个小名字" bindchange="choose" bindcolumnchange="column" bindcancel="cancel"><button id="entry">选个地方和小东西</button></picker></view><text id="multi-state">{{value[0]}},{{value[1]}} / {{calls}} / {{cancels}} / {{columns}}</text><button id="reset" bindtap="reset">重置</button><button id="lock" bindtap="lock">锁定</button><button id="unlock" bindtap="unlock">解锁</button><button id="hide" bindtap="hide">隐藏</button><button id="open" bindtap="open">下一页</button>', script = 'Page({data:{ranges:[["窗边","走廊","桌角"],["一朵云","一阵风","一束光"]],value:[0,0],calls:0,cancels:0,columns:0,locked:false,show:true},choose(e){getApp().globalData.changeEvent=e;this.setData({value:e.detail.value,calls:this.data.calls+1})},column(e){getApp().globalData.columnEvent=e;this.setData({columns:this.data.columns+1})},cancel(e){getApp().globalData.cancelEvent=e;this.setData({cancels:this.data.cancels+1})},reset(){this.setData({value:[0,0]})},lock(){this.setData({locked:true})},unlock(){this.setData({locked:false})},hide(){this.setData({show:false})},open(){wx.navigateTo({url:"/pages/records/index"})}})') {
  return preview({ 'pages/home/index.js': script, 'pages/records/index.js': 'Page({data:{value:9,depth:1,from:""},choose(){this.setData({value:0})},cancel(){this.setData({value:0})}})' }, '', '', markup)
}
function openMulti(dom: InstanceType<typeof JSDOM>) {
  const entry = dom.window.document.querySelector<HTMLButtonElement>('#entry'); expect(entry).not.toBeNull(); entry!.click()
  const dialog = dom.window.document.querySelector<HTMLDialogElement>('#preview-modal'); expect(dialog).not.toBeNull(); expect(dialog!.open).toBe(true)
  return dialog!
}
function pickerColumns(dialog: HTMLDialogElement) { const columns = Array.from(dialog.querySelectorAll('select')); expect(columns).toHaveLength(2); return columns }
function pickerAction(dialog: HTMLDialogElement, label: string) { const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === label); expect(button).not.toBeUndefined(); return button! }
function multiState(dom: InstanceType<typeof JSDOM>) { const state = dom.window.document.querySelector('#multi-state'); expect(state).not.toBeNull(); return state!.textContent }
function selectColumn(dom: InstanceType<typeof JSDOM>, control: HTMLSelectElement, value: number) { control.value = String(value); control.dispatchEvent(new dom.window.Event('change', { bubbles: true })) }

describe('Native multi-column picker keeps selection pending until confirmation', () => {
  it('retains its native child button and waits for a click before opening two columns', async () => {
    const dom = await multiPicker(); expect(dom.window.document.querySelector('#entry')!.textContent).toBe('选个地方和小东西'); expect(dom.window.document.querySelector('#preview-modal')).toBeNull()
    const dialog = openMulti(dom), controls = pickerColumns(dialog)
    expect(Array.from(controls[0].options, option => option.text)).toEqual(['窗边', '走廊', '桌角']); expect(Array.from(controls[1].options, option => option.text)).toEqual(['一朵云', '一阵风', '一束光']); expect(controls.map(control => control.value)).toEqual(['0', '0']); expect(controls[0].getAttribute('aria-label')).toBe('取个小名字 第1列'); expect(controls[1].getAttribute('aria-label')).toBe('取个小名字 第2列')
  })
  it('a changed column emits columnchange without committing the page selection', async () => {
    const dom = await multiPicker(), controls = pickerColumns(openMulti(dom)); selectColumn(dom, controls[0], 2)
    expect(multiState(dom)).toBe('0,0 / 0 / 0 / 1'); expect(controls[0].value).toBe('2'); expect(dom.window.eval('getApp().globalData.columnEvent.detail')).toEqual({ column: 0, value: 2 }); expect(dom.window.eval('getApp().globalData.columnEvent.type')).toBe('columnchange')
  })
  it.each([['bindchange', 1], ['bind:change', 1], ['catchchange', 0], ['catch:change', 0]])('%s commits one numeric index array with native dataset and parent count %s', async (binding, expectedParents) => {
    const actual = await multiPicker('<view id="parent"><picker id="moment" mode="multiSelector" range="{{ranges}}" value="{{value}}" data-index="{{7}}" data-kind="moment" aria-label="取个小名字" ' + binding + '="choose"><button id="entry">选择</button></picker></view><text id="multi-state">{{value[0]}},{{value[1]}} / {{calls}} / {{cancels}} / {{columns}}</text>'), dialog = openMulti(actual), controls = pickerColumns(dialog); let parents = 0
    actual.window.document.querySelector('#parent')!.addEventListener('change', () => parents++); selectColumn(actual, controls[0], 2); selectColumn(actual, controls[1], 1); expect(parents).toBe(0); pickerAction(dialog, '确定').click()
    expect(multiState(actual)).toBe('2,1 / 1 / 0 / 0'); expect(actual.window.eval('getApp().globalData.changeEvent.detail.value')).toEqual([2, 1]); expect(actual.window.eval('getApp().globalData.changeEvent.currentTarget')).toEqual({ id: 'moment', dataset: { index: 7, kind: 'moment' } }); expect(actual.window.eval('getApp().globalData.changeEvent.type')).toBe('change'); expect(parents).toBe(expectedParents); expect(actual.window.document.querySelector('#preview-modal')).toBeNull()
  })
  it.each([['bindcancel', 1], ['bind:cancel', 1], ['catchcancel', 0], ['catch:cancel', 0]])('%s cancels draft selection with parent count %s and reopens committed values', async (binding, expectedParents) => {
    const dom = await multiPicker('<view id="parent"><picker id="moment" mode="multiSelector" range="{{ranges}}" value="{{value}}" bindchange="choose" ' + binding + '="cancel"><button id="entry">选择</button></picker></view><text id="multi-state">{{value[0]}},{{value[1]}} / {{calls}} / {{cancels}} / {{columns}}</text>'), dialog = openMulti(dom), controls = pickerColumns(dialog); let parents = 0
    dom.window.document.querySelector('#parent')!.addEventListener('cancel', () => parents++); selectColumn(dom, controls[1], 2); pickerAction(dialog, '取消').click()
    expect(multiState(dom)).toBe('0,0 / 0 / 1 / 0'); expect(dom.window.eval('getApp().globalData.cancelEvent.type')).toBe('cancel'); expect(dom.window.eval('getApp().globalData.cancelEvent.detail')).toBeUndefined(); expect(parents).toBe(expectedParents); expect(pickerColumns(openMulti(dom)).map(control => control.value)).toEqual(['0', '0'])
  })
  it.each([['bindcolumnchange', 1], ['bind:columnchange', 1], ['catchcolumnchange', 0], ['catch:columnchange', 0]])('%s reports the numeric column and value with parent count %s', async (binding, expectedParents) => {
    const dom = await multiPicker('<view id="parent"><picker id="moment" mode="multiSelector" range="{{ranges}}" value="{{value}}" ' + binding + '="column"><button id="entry">选择</button></picker></view><text id="multi-state">{{value[0]}},{{value[1]}} / {{calls}} / {{cancels}} / {{columns}}</text>'), controls = pickerColumns(openMulti(dom)); let parents = 0
    dom.window.document.querySelector('#parent')!.addEventListener('columnchange', () => parents++); selectColumn(dom, controls[1], 2)
    expect(multiState(dom)).toBe('0,0 / 0 / 0 / 1'); expect(dom.window.eval('getApp().globalData.columnEvent.detail')).toEqual({ column: 1, value: 2 }); expect(parents).toBe(expectedParents); expect(controls[1].value).toBe('2')
  })
  it.each([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]])('confirmed combination [%s,%s] remains selected when reopened', async (place, thing) => {
    const dom = await multiPicker(), dialog = openMulti(dom), controls = pickerColumns(dialog); selectColumn(dom, controls[0], place); selectColumn(dom, controls[1], thing); pickerAction(dialog, '确定').click()
    expect(dom.window.eval('getCurrentPages()[0].data.value')).toEqual([place, thing]); expect(dom.window.eval('getCurrentPages()[0].data.calls')).toBe(1); expect(pickerColumns(openMulti(dom)).map(control => control.value)).toEqual([String(place), String(thing)])
  })
  it('Escape cancels pending selection once without committing it', async () => {
    const dom = await multiPicker(), dialog = openMulti(dom), controls = pickerColumns(dialog); selectColumn(dom, controls[0], 1); dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true }))
    expect(multiState(dom)).toBe('0,0 / 0 / 1 / 1'); expect(dom.window.document.querySelector('#preview-modal')).toBeNull()
  })
  it('external reset updates an open selection and retains the native picker node', async () => {
    const dom = await multiPicker(), first = openMulti(dom), firstControls = pickerColumns(first), picker = dom.window.document.querySelector('#moment')!; selectColumn(dom, firstControls[0], 2); selectColumn(dom, firstControls[1], 1); pickerAction(first, '确定').click()
    const dialog = openMulti(dom), controls = pickerColumns(dialog); selectColumn(dom, controls[1], 2); dom.window.document.querySelector<HTMLButtonElement>('#reset')!.click()
    expect(dom.window.document.querySelector('#moment')).toBe(picker); expect(controls.map(control => control.value)).toEqual(['0', '0']); expect(dom.window.eval('getCurrentPages()[0].data.value')).toEqual([0, 0])
  })
  it('disabled native picker cannot open until restored by setData', async () => {
    const dom = await multiPicker(); dom.window.document.querySelector<HTMLButtonElement>('#lock')!.click(); dom.window.document.querySelector<HTMLButtonElement>('#entry')!.click(); expect(dom.window.document.querySelector('#preview-modal')).toBeNull(); dom.window.document.querySelector<HTMLButtonElement>('#unlock')!.click(); expect(pickerColumns(openMulti(dom))).toHaveLength(2)
  })
  it('disabling an open picker closes its pending selection and rejects the old confirm button', async () => {
    const dom = await multiPicker(), dialog = openMulti(dom), confirm = pickerAction(dialog, '确定'); selectColumn(dom, pickerColumns(dialog)[0], 2); dom.window.document.querySelector<HTMLButtonElement>('#lock')!.click(); expect(dialog.isConnected).toBe(false); confirm.click(); expect(multiState(dom)).toBe('0,0 / 0 / 0 / 1')
  })
  it('a conditionally removed picker rejects pending confirmation on its current page', async () => {
    const dom = await multiPicker(), dialog = openMulti(dom), confirm = pickerAction(dialog, '确定'); selectColumn(dom, pickerColumns(dialog)[1], 2); dom.window.document.querySelector<HTMLButtonElement>('#hide')!.click(); expect(dialog.isConnected).toBe(false); confirm.click(); expect(multiState(dom)).toBe('0,0 / 0 / 0 / 1')
  })
  it('navigation discards the open picker and a late confirmation cannot update the next page', async () => {
    const dom = await multiPicker(), dialog = openMulti(dom), confirm = pickerAction(dialog, '确定'); selectColumn(dom, pickerColumns(dialog)[0], 2); dom.window.document.querySelector<HTMLButtonElement>('#open')!.click(); expect(dialog.isConnected).toBe(false); confirm.click(); expect(dom.window.document.querySelector('#records')!.textContent).toBe('9 / 1 / ')
  })
  it('range-key labels use text and preserve a zero selection', async () => {
    const dom = await multiPicker('<picker id="moment" mode="multiSelector" range="{{ranges}}" range-key="name" value="{{value}}"><button id="entry">选择</button></picker>', 'Page({data:{ranges:[[{name:"窗<边>"},{name:"桌角"}],[{name:"一朵云"},{name:"一束光"}]],value:[0,0]}})'), controls = pickerColumns(openMulti(dom))
    expect(Array.from(controls[0].options, option => option.text)).toEqual(['窗<边>', '桌角']); expect(controls[0].options[0].children).toHaveLength(0); expect(controls.map(control => control.value)).toEqual(['0', '0'])
  })
  it('an empty column blocks confirmation instead of committing a missing index', async () => {
    const dom = await multiPicker('<picker id="moment" mode="multiSelector" range="{{ranges}}" value="{{value}}" bindchange="choose"><button id="entry">选择</button></picker><text id="multi-state">{{calls}}</text>', 'Page({data:{ranges:[["窗边"],[]],value:[0,0],calls:0},choose(){this.setData({calls:this.data.calls+1})}})'), dialog = openMulti(dom), controls = pickerColumns(dialog), confirm = pickerAction(dialog, '确定')
    expect(controls[1].disabled).toBe(true); expect(confirm.disabled).toBe(true); confirm.click(); expect(multiState(dom)).toBe('0')
  })
  it('dependent column ranges refresh while preserving an uncommitted first-column choice', async () => {
    const dom = await multiPicker('<picker id="moment" mode="multiSelector" range="{{ranges}}" value="{{value}}" bindcolumnchange="column" bindchange="choose"><button id="entry">选择</button></picker><text id="multi-state">{{value[0]}},{{value[1]}}</text>', 'Page({data:{ranges:[["动物","植物"],["猫","狗"]],value:[0,0]},column(e){if(e.detail.column===0)this.setData({"ranges[1]":e.detail.value?["云杉","白桦","银杏"]:["猫","狗"]})},choose(e){this.setData({value:e.detail.value})}})'), dialog = openMulti(dom), controls = pickerColumns(dialog)
    selectColumn(dom, controls[0], 1); expect(controls[0].value).toBe('1'); expect(Array.from(controls[1].options, option => option.text)).toEqual(['云杉', '白桦', '银杏']); expect(multiState(dom)).toBe('0,0'); selectColumn(dom, controls[1], 2); pickerAction(dialog, '确定').click(); expect(multiState(dom)).toBe('1,2')
  })
  it('malformed change events do not bypass native confirmation', async () => {
    const dom = await multiPicker(), picker = dom.window.document.querySelector('#moment')!
    for (const value of [[99, 0], [0.5, 0], [1], ['1', '2'], null]) picker.dispatchEvent(new dom.window.CustomEvent('change', { bubbles: true, detail: { value } }))
    expect(multiState(dom)).toBe('0,0 / 0 / 0 / 0')
  })
  it('a second click reuses the existing dialog rather than opening another picker', async () => {
    const dom = await multiPicker(), dialog = openMulti(dom); dom.window.document.querySelector<HTMLButtonElement>('#entry')!.click(); expect(dom.window.document.querySelectorAll('#preview-modal')).toHaveLength(1); expect(dom.window.document.querySelector('#preview-modal')).toBe(dialog)
  })
})

async function nativeSlider(markup = '<slider id="tempo" min="0" max="4" step="1" value="{{level}}" show-value="{{show}}" disabled="{{disabled}}" bindchanging="changing" bindchange="change"/><text id="live">{{level}} / {{drag}} / {{calls}} / {{parents}}</text><button id="reset" bindtap="reset">重置</button><button id="hide" bindtap="hide">隐藏数值</button><button id="show" bindtap="show">显示数值</button><button id="lock" bindtap="lock">锁定</button><button id="restore" bindtap="restore">恢复</button><button id="open" bindtap="open">打开</button>', script = 'Page({data:{level:2,drag:0,calls:0,parents:0,show:true,disabled:false},changing(e){this.setData({level:e.detail.value,drag:this.data.drag+1});getApp().globalData.valueType=typeof e.detail.value},change(e){this.setData({level:e.detail.value,calls:this.data.calls+1});getApp().globalData.valueType=typeof e.detail.value},ancestor(){this.setData({parents:this.data.parents+1})},reset(){this.setData({level:2})},hide(){this.setData({show:false})},show(){this.setData({show:true})},lock(){this.setData({level:4,disabled:true})},restore(){this.setData({level:1,disabled:false})},open(){wx.navigateTo({url:"/pages/records/index"})}})', modules: Record<string, string> = {}) {
  return preview({ 'pages/home/index.js': script, ...modules }, '', '', markup)
}
function sliderValue(dom: InstanceType<typeof JSDOM>) { const output = dom.window.document.querySelector('output'); expect(output).not.toBeNull(); return output!.textContent }

describe('Native slider value display and event ownership', () => {
  it('show-value exposes one visible number beside its interactive native slider', async () => {
    const dom = await nativeSlider(), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!
    expect(input.type).toBe('range'); expect(input.value).toBe('2'); expect(sliderValue(dom)).toBe('2'); expect(dom.window.document.querySelectorAll('output')).toHaveLength(1); expect(dom.window.document.querySelector('output')!.getAttribute('for')).toBe('tempo')
  })
  it('a slider without show-value has no extra numeric output', async () => {
    const dom = await nativeSlider('<slider id="tempo" value="2"/>'); expect(dom.window.document.querySelector<HTMLInputElement>('#tempo')!.value).toBe('2'); expect(dom.window.document.querySelectorAll('output')).toHaveLength(0)
  })
  it('an explicitly false show-value has no extra numeric output', async () => {
    const dom = await nativeSlider('<slider id="tempo" value="2" show-value="{{false}}"/>'); expect(dom.window.document.querySelector<HTMLInputElement>('#tempo')!.value).toBe('2'); expect(dom.window.document.querySelectorAll('output')).toHaveLength(0)
  })
  it('show-value displays a selected zero without dropping the numeric label', async () => {
    const dom = await nativeSlider('<slider id="tempo" min="0" max="4" value="0" show-value/>'); expect(sliderValue(dom)).toBe('0')
  })
  it('changing updates the visible number before a committed change', async () => {
    const dom = await nativeSlider(), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; input.value = '3'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); expect(sliderValue(dom)).toBe('3'); expect(dom.window.document.querySelector('#live')!.textContent).toBe('3 / 1 / 0 / 0'); expect(dom.window.eval('getApp().globalData.valueType')).toBe('number')
  })
  it('a committed change updates the visible number and sends a numeric value once', async () => {
    const dom = await nativeSlider(), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; input.value = '4'; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(sliderValue(dom)).toBe('4'); expect(dom.window.document.querySelector('#live')!.textContent).toBe('4 / 0 / 1 / 0'); expect(dom.window.eval('getApp().globalData.valueType')).toBe('number')
  })
  it('setData resets the displayed value and retains the existing interactive range node', async () => {
    const dom = await nativeSlider(), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; input.value = '4'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); (dom.window.document.querySelector('#reset') as HTMLElement).click(); expect(dom.window.document.querySelector('#tempo')).toBe(input); expect(input.value).toBe('2'); expect(sliderValue(dom)).toBe('2')
  })
  it('show-value supports the official fifty to two-hundred stepped range example', async () => {
    const dom = await nativeSlider('<slider id="tempo" min="50" max="200" step="5" value="100" show-value/>'), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; expect(input.min).toBe('50'); expect(input.max).toBe('200'); expect(input.step).toBe('5'); expect(input.value).toBe('100'); expect(sliderValue(dom)).toBe('100')
  })
  it('a dynamic show-value can be removed and restored without losing the current value', async () => {
    const dom = await nativeSlider(); expect(sliderValue(dom)).toBe('2'); (dom.window.document.querySelector('#hide') as HTMLElement).click(); expect(dom.window.document.querySelectorAll('output')).toHaveLength(0); expect(dom.window.document.querySelector<HTMLInputElement>('#tempo')!.value).toBe('2'); (dom.window.document.querySelector('#show') as HTMLElement).click(); expect(sliderValue(dom)).toBe('2'); expect(dom.window.document.querySelectorAll('output')).toHaveLength(1)
  })
  it('locked and restored slider values synchronize both control and shown number', async () => {
    const dom = await nativeSlider(); (dom.window.document.querySelector('#lock') as HTMLElement).click(); expect(dom.window.document.querySelector<HTMLInputElement>('#tempo')!.disabled).toBe(true); expect(sliderValue(dom)).toBe('4'); (dom.window.document.querySelector('#restore') as HTMLElement).click(); expect(dom.window.document.querySelector<HTMLInputElement>('#tempo')!.disabled).toBe(false); expect(sliderValue(dom)).toBe('1')
  })
  it('a disabled native slider rejects manually delivered changing and change events', async () => {
    const dom = await nativeSlider(); (dom.window.document.querySelector('#lock') as HTMLElement).click(); const input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; input.value = '0'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(dom.window.document.querySelector('#live')!.textContent).toBe('4 / 0 / 0 / 0'); expect(sliderValue(dom)).toBe('4')
  })
  it('a departed page slider cannot invoke identically named handlers on the next page', async () => {
    const dom = await nativeSlider(undefined, undefined, { 'pages/records/index.js': 'Page({data:{value:9,calls:0,depth:1,from:""},changing(){this.setData({value:0,calls:this.data.calls+1})},change(){this.setData({value:0,calls:this.data.calls+1})}})' }), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; (dom.window.document.querySelector('#open') as HTMLElement).click(); expect(input.isConnected).toBe(false); input.value = '0'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(dom.window.document.querySelector('#records')!.textContent).toBe('9 / 1 / ')
  })
  it('a conditionally detached slider cannot update its still-active page', async () => {
    const dom = await nativeSlider('<slider id="tempo" wx:if="{{show}}" min="0" max="4" value="{{level}}" bindchanging="changing" bindchange="change"/><text id="live">{{level}} / {{drag}} / {{calls}} / {{parents}}</text><button id="hide" bindtap="hide">隐藏</button>'), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; (dom.window.document.querySelector('#hide') as HTMLElement).click(); expect(input.isConnected).toBe(false); input.value = '0'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(dom.window.document.querySelector('#live')!.textContent).toBe('2 / 0 / 0 / 0')
  })
  it.each(['catchchanging', 'catch:changing'])('%s updates one native value without bubbling the input event', async binding => {
    const dom = await nativeSlider(`<view bindinput="ancestor"><slider id="tempo" min="0" max="4" value="{{level}}" show-value ${binding}="changing"/></view><text id="live">{{level}} / {{drag}} / {{calls}} / {{parents}}</text>`), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; input.value = '3'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); expect(dom.window.document.querySelector('#live')!.textContent).toBe('3 / 1 / 0 / 0'); expect(sliderValue(dom)).toBe('3')
  })
  it.each(['catchchange', 'catch:change'])('%s updates one committed value without bubbling the change event', async binding => {
    const dom = await nativeSlider(`<view bindchange="ancestor"><slider id="tempo" min="0" max="4" value="{{level}}" show-value ${binding}="change"/></view><text id="live">{{level}} / {{drag}} / {{calls}} / {{parents}}</text>`), input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!; input.value = '4'; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(dom.window.document.querySelector('#live')!.textContent).toBe('4 / 0 / 1 / 0'); expect(sliderValue(dom)).toBe('4')
  })
})

async function preview(modules: Record<string, string> = {}, css = '', inlineStyle = '', markup?: string, initialize?: (window: InstanceType<typeof JSDOM>['window']) => void) {
  const home = 'pages/home/index'
  const pages = {
    [home]: { wxml: markup ?? `<view id="value" style="${inlineStyle}">{{value}}</view><view id="item">{{items[0].text}}</view><button bindtap="open">记录</button><button bindtap="nested">修改</button>`, css },
    'pages/records/index': { wxml: '<view id="records">{{value}} / {{depth}} / {{from}}</view><button bindtap="save">增加</button><button bindtap="back">返回</button>', css: '' },
  }
  const code = {
    'app.js': 'App({globalData:{moduleLoads:0}})',
    'utils/feed.js': 'getApp().globalData.moduleLoads++; module.exports={read(){return wx.getStorageSync("count") || 0},add(){wx.setStorageSync("count",this.read()+1)}}',
    [home + '.js']: 'const feed=require("../../utils/feed"); Page({data:{value:0,items:[{text:"old"}]},onShow(){this.setData({value:feed.read()})},open(){wx.navigateTo({url:"/pages/records/index?from=home"})},nested(){this.setData({"items[0].text":"new"})}})',
    'pages/records/index.js': 'const feed=require("../../utils/feed.js"); Page({data:{value:0,depth:0,from:""},onLoad(options){this.setData({from:options.from})},onShow(){this.setData({value:feed.read(),depth:getCurrentPages().length})},save(){feed.add();this.setData({value:feed.read()})},back(){wx.navigateBack({delta:1})}})',
    ...modules,
  }
  const source = { page: home, pages, modules: code, storage: { count: 3 } }
  const template = await readFile(new URL('../server/preview.html', import.meta.url), 'utf8')
  const dom = new JSDOM(template.replace('__SOURCE__', JSON.stringify(source).replaceAll('<', '\\u003c')), { runScripts: 'dangerously', url: 'http://preview.local/', beforeParse(window) { initialize?.(window); window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', '') }; window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open') } } })
  windows.push(dom)
  return dom
}

describe('Canvas frame scheduling in the native preview', () => {
  async function framePreview() {
    let next = 0
    const frames = new Map<number, FrameRequestCallback>()
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{tick:0},update(){this.setData({tick:this.data.tick+1})},open(){wx.navigateTo({url:"/pages/records/index"})},onHide(){const state=getApp().globalData;if(state.cancelOnHide)state.canvas.cancelAnimationFrame(state.request)}})' }, '', '', '<canvas id="sky" type="2d"></canvas><view id="plain">文字</view><text id="tick">{{tick}}</text><button id="update" bindtap="update">更新</button><button id="open" bindtap="open">打开</button>', window => {
      window.requestAnimationFrame = function(callback) { const id = ++next; frames.set(id, callback); return id }
      window.cancelAnimationFrame = function(id) { frames.delete(id) }
    })
    dom.window.eval('wx.createSelectorQuery().select("#sky").fields({node:true}).exec(values=>getApp().globalData.canvas=values[0].node)')
    await Promise.resolve()
    return { dom, tick(timestamp: number) { const queued = [...frames]; for (const [id] of queued) frames.delete(id); for (const [, callback] of queued) callback(timestamp) } }
  }
  it('Canvas frame methods are available on a fields node', async () => {
    const { dom } = await framePreview()
    expect(dom.window.eval('typeof getApp().globalData.canvas.requestAnimationFrame')).toBe('function')
    expect(dom.window.eval('typeof getApp().globalData.canvas.cancelAnimationFrame')).toBe('function')
  })
  it('Canvas frame request returns a numeric handle and executes once at the next frame', async () => {
    const { dom, tick } = await framePreview()
    dom.window.eval('getApp().globalData.calls=[];getApp().globalData.request=getApp().globalData.canvas.requestAnimationFrame(time=>getApp().globalData.calls.push(time))')
    expect(dom.window.eval('getApp().globalData.request')).toBe(1); expect(dom.window.eval('getApp().globalData.calls')).toEqual([])
    tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42]); tick(84); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42])
  })
  it('Canvas frame cancellation prevents the queued callback', async () => {
    const { dom, tick } = await framePreview()
    dom.window.eval('getApp().globalData.calls=[];const canvas=getApp().globalData.canvas;const id=canvas.requestAnimationFrame(time=>getApp().globalData.calls.push(time));canvas.cancelAnimationFrame(id)')
    tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual([])
  })
  it('Canvas frame cancellation affects only its returned handle', async () => {
    const { dom, tick } = await framePreview()
    dom.window.eval('getApp().globalData.calls=[];const canvas=getApp().globalData.canvas;getApp().globalData.first=canvas.requestAnimationFrame(()=>getApp().globalData.calls.push("first"));getApp().globalData.second=canvas.requestAnimationFrame(()=>getApp().globalData.calls.push("second"));canvas.cancelAnimationFrame(getApp().globalData.first)')
    expect(dom.window.eval('getApp().globalData.first')).toBe(1); expect(dom.window.eval('getApp().globalData.second')).toBe(2)
    tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual(['second'])
  })
  it('Canvas frame callbacks may request a later frame without running it immediately', async () => {
    const { dom, tick } = await framePreview()
    dom.window.eval('getApp().globalData.calls=[];const canvas=getApp().globalData.canvas;canvas.requestAnimationFrame(time=>{getApp().globalData.calls.push(time);canvas.requestAnimationFrame(next=>getApp().globalData.calls.push(next))})')
    tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42]); tick(84); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42,84]); tick(126); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42,84])
  })
  it('Canvas frame methods are also exposed by the node selector', async () => {
    const { dom, tick } = await framePreview()
    dom.window.eval('getApp().globalData.calls=[];wx.createSelectorQuery().select("#sky").node(value=>getApp().globalData.fromNode=value.node).exec()')
    await Promise.resolve(); expect(dom.window.eval('getApp().globalData.fromNode===getApp().globalData.canvas')).toBe(true); expect(dom.window.eval('typeof getApp().globalData.fromNode.requestAnimationFrame')).toBe('function')
    dom.window.eval('getApp().globalData.fromNode.requestAnimationFrame(time=>getApp().globalData.calls.push(time))'); expect(dom.window.eval('getApp().globalData.calls')).toEqual([])
    tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42])
  })
  it('Canvas frame requests continue on the same node after setData', async () => {
    const { dom, tick } = await framePreview(), canvas = dom.window.document.querySelector('#sky')
    dom.window.document.querySelector<HTMLButtonElement>('#update')!.click(); expect(dom.window.document.querySelector('#sky')).toBe(canvas); expect(dom.window.document.querySelector('#tick')!.textContent).toBe('1')
    dom.window.eval('getApp().globalData.calls=[];getApp().globalData.canvas.requestAnimationFrame(time=>getApp().globalData.calls.push(time))')
    tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual([42])
  })
  it('Canvas frame requests can be canceled by the native page hide handler', async () => {
    const { dom, tick } = await framePreview(), canvas = dom.window.document.querySelector('#sky')
    dom.window.eval('getApp().globalData.calls=[];getApp().globalData.cancelOnHide=true;getApp().globalData.request=getApp().globalData.canvas.requestAnimationFrame(time=>getApp().globalData.calls.push(time))')
    dom.window.document.querySelector<HTMLButtonElement>('#open')!.click(); tick(42); expect(dom.window.eval('getApp().globalData.calls')).toEqual([])
    dom.window.eval('wx.navigateBack()'); expect(dom.window.document.querySelector('#sky')).toBe(canvas)
    dom.window.eval('getApp().globalData.canvas.requestAnimationFrame(time=>getApp().globalData.calls.push(time))'); tick(84); expect(dom.window.eval('getApp().globalData.calls')).toEqual([84])
  })
  it('Canvas frame methods do not modify unrelated DOM nodes or the canvas prototype', async () => {
    const { dom } = await framePreview()
    expect((dom.window.document.querySelector('#plain') as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame).toBeUndefined()
    expect((dom.window.HTMLCanvasElement.prototype as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame).toBeUndefined()
  })
})

describe('Mini program interaction preview', () => {
  function installCanvasPorts(window: InstanceType<typeof JSDOM>['window']) {
    const contexts = new WeakMap<HTMLCanvasElement, object>()
    Object.defineProperty(window, 'devicePixelRatio', {value:2, configurable:true})
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {value:function(type: string) { if(type !== '2d') return null; if(!contexts.has(this))contexts.set(this,{canvas:this,scale:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn()});return contexts.get(this)}})
    window.HTMLCanvasElement.prototype.getBoundingClientRect = function() { return {left:10,top:20,right:250,bottom:220,width:240,height:200,x:10,y:20,toJSON(){return {}}} }
  }
  async function canvasPreview(script = 'Page({data:{tick:0},update(){this.setData({tick:this.data.tick+1})},open(){wx.navigateTo({url:"/pages/records/index"})}})', markup = '<canvas type="2d" id="sky" data-count="{{3}}" style="width:240px;height:200px"></canvas><text id="tick">{{tick}}</text><button id="update" bindtap="update">更新</button><button id="open" bindtap="open">打开</button>') {
    return preview({'pages/home/index.js':script}, '', '', markup, installCanvasPorts)
  }
  it('renders a native Canvas 2D component as a real canvas element', async () => {
    const dom=await canvasPreview(),canvas=dom.window.document.querySelector('#sky')!
    expect(canvas.tagName).toBe('CANVAS');expect(canvas.getAttribute('type')).toBe('2d');expect((canvas as HTMLCanvasElement).getContext('2d')).toHaveProperty('canvas',canvas)
  })
  it('window information reports preview dimensions and its actual pixel ratio', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.getWindowInfo')).toBe('function')
    expect(dom.window.eval('wx.getWindowInfo()')).toEqual({pixelRatio:2,windowWidth:dom.window.innerWidth,windowHeight:dom.window.innerHeight,screenWidth:dom.window.innerWidth,screenHeight:dom.window.innerHeight,screenTop:0,statusBarHeight:0,safeArea:{left:0,top:0,right:dom.window.innerWidth,bottom:dom.window.innerHeight,width:dom.window.innerWidth,height:dom.window.innerHeight}})
  })
  it('window information falls back to one for an invalid pixel ratio', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.getWindowInfo')).toBe('function');Object.defineProperty(dom.window,'devicePixelRatio',{value:0});expect(dom.window.eval('wx.getWindowInfo().pixelRatio')).toBe(1)
  })
  it('fields node returns the actual Canvas 2D node in callback and exec results', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function')
    dom.window.eval('wx.createSelectorQuery().select("#sky").fields({node:true},value=>getApp().globalData.one=value).exec(values=>getApp().globalData.all=values)');await Promise.resolve()
    expect(dom.window.eval('getApp().globalData.one.node')).toBe(dom.window.document.querySelector('#sky'));expect(dom.window.eval('getApp().globalData.all[0].node')).toBe(dom.window.document.querySelector('#sky'));expect(dom.window.eval('Object.keys(getApp().globalData.one)')).toEqual(['node'])
  })
  it('fields returns only requested id and typed dataset metadata', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function')
    dom.window.eval('wx.createSelectorQuery().select("#sky").fields({id:true,dataset:true,node:false,size:false}).exec(values=>getApp().globalData.result=values[0])');await Promise.resolve();expect(dom.window.eval('getApp().globalData.result')).toEqual({id:'sky',dataset:{count:3}})
  })
  it('fields size and rect use the current component bounds', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function')
    dom.window.eval('wx.createSelectorQuery().select("#sky").fields({size:true,rect:true}).exec(values=>getApp().globalData.result=values[0])');await Promise.resolve();expect(dom.window.eval('getApp().globalData.result')).toEqual({width:240,height:200,left:10,top:20,right:250,bottom:220})
  })
  it('fields selectAll and queued selectors retain their order', async () => {
    const dom=await canvasPreview(undefined,'<canvas type="2d" id="first"></canvas><canvas type="2d" id="second"></canvas>');expect(dom.window.eval('typeof wx.createSelectorQuery().select("#first").fields')).toBe('function')
    dom.window.eval('const q=wx.createSelectorQuery();q.selectAll("canvas").fields({id:true});q.select("#second").fields({node:true});q.exec(values=>getApp().globalData.results=values)');await Promise.resolve();expect(dom.window.eval('getApp().globalData.results[0]')).toEqual([{id:'first'},{id:'second'}]);expect(dom.window.eval('getApp().globalData.results[1].node')).toBe(dom.window.document.querySelector('#second'))
  })
  it('fields callbacks run once and an exec drains the query jobs', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function')
    dom.window.eval('getApp().globalData.calls=0;const q=wx.createSelectorQuery();q.select("#sky").fields({node:true},()=>getApp().globalData.calls++);q.exec();q.exec(values=>getApp().globalData.empty=values)');await Promise.resolve();expect(dom.window.eval('getApp().globalData.calls')).toBe(1);expect(dom.window.eval('getApp().globalData.empty')).toEqual([])
  })
  it('node shorthand returns the same Canvas 2D instance', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").node')).toBe('function');dom.window.eval('wx.createSelectorQuery().select("#sky").node(value=>getApp().globalData.canvas=value.node).exec()');await Promise.resolve();expect(dom.window.eval('getApp().globalData.canvas')).toBe(dom.window.document.querySelector('#sky'))
  })
  it('fields from a different page scope do not expose current canvas nodes', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function');dom.window.eval('wx.createSelectorQuery().in({data:{}}).select("#sky").fields({node:true}).exec(values=>getApp().globalData.result=values[0])');await Promise.resolve();expect(dom.window.eval('getApp().globalData.result')).toBeNull()
  })
  it('a fields request queued before navigation cannot return a later page node', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function');dom.window.eval('wx.createSelectorQuery().select("#sky").fields({node:true}).exec(values=>getApp().globalData.result=values[0])');dom.window.document.querySelector<HTMLButtonElement>('#open')!.click();await Promise.resolve();expect(dom.window.eval('getApp().globalData.result')).toBeNull()
  })
  it('setData retains runtime canvas dimensions and the drawing context', async () => {
    const dom=await canvasPreview(),document=dom.window.document,canvas=document.querySelector<HTMLCanvasElement>('#sky')!
    expect(canvas.tagName).toBe('CANVAS');canvas.width=480;canvas.height=400;const context=canvas.getContext('2d');document.querySelector<HTMLButtonElement>('#update')!.click();expect(document.querySelector('#sky')).toBe(canvas);expect(canvas.width).toBe(480);expect(canvas.height).toBe(400);expect(canvas.getContext('2d')).toBe(context);expect(document.querySelector('#tick')!.textContent).toBe('1')
  })
  it('a queried canvas node and its context survive returning to the same page', async () => {
    const dom=await canvasPreview();expect(dom.window.eval('typeof wx.createSelectorQuery().select("#sky").fields')).toBe('function');dom.window.eval('wx.createSelectorQuery().select("#sky").fields({node:true}).exec(values=>getApp().globalData.canvas=values[0].node)');await Promise.resolve();const canvas=dom.window.document.querySelector<HTMLCanvasElement>('#sky')!;expect(canvas.tagName).toBe('CANVAS');const context=canvas.getContext('2d');canvas.width=480;canvas.height=400;dom.window.document.querySelector<HTMLButtonElement>('#open')!.click();dom.window.eval('wx.navigateBack()');expect(dom.window.document.querySelector('#sky')).toBe(canvas);expect(canvas.width).toBe(480);expect(canvas.height).toBe(400);expect(canvas.getContext('2d')).toBe(context)
  })
  it('canvas touch starts provide local x y with original client coordinates', async () => {
    const dom=await canvasPreview('Page({data:{},touch(e){getApp().globalData.event=e}})','<canvas type="2d" id="sky" bindtouchstart="touch"></canvas>'),canvas=dom.window.document.querySelector('#sky')!
    expect(canvas.tagName).toBe('CANVAS');pointer(dom,canvas,'pointerdown',7,53,76);expect(dom.window.eval('getApp().globalData.event.touches[0]')).toMatchObject({identifier:7,x:43,y:56,clientX:53,clientY:76});expect(dom.window.eval('getApp().globalData.event.changedTouches[0]')).toMatchObject({x:43,y:56})
  })
  it('canvas move and end events update their local coordinates', async () => {
    const dom=await canvasPreview('Page({data:{},touch(e){getApp().globalData.events=(getApp().globalData.events||[]).concat(e)}})','<canvas type="2d" id="sky" bindtouchstart="touch" bindtouchmove="touch" bindtouchend="touch"></canvas>'),canvas=dom.window.document.querySelector('#sky')!
    expect(canvas.tagName).toBe('CANVAS');pointer(dom,canvas,'pointerdown',7,53,76);pointer(dom,canvas,'pointermove',7,80,110);pointer(dom,canvas,'pointerup',7,110,130);expect(dom.window.eval('getApp().globalData.events.map(e=>({type:e.type,x:e.changedTouches[0].x,y:e.changedTouches[0].y}))')).toEqual([{type:'touchstart',x:43,y:56},{type:'touchmove',x:70,y:90},{type:'touchend',x:100,y:110}])
  })
  it('detached canvases cannot send touches to the newly active page', async () => {
    const dom=await preview({'pages/home/index.js':'Page({data:{},open(){wx.navigateTo({url:"/pages/records/index"})},touch(){getApp().globalData.old=true}})','pages/records/index.js':'Page({data:{},touch(){getApp().globalData.new=true}})'},'','','<canvas type="2d" id="sky" bindtouchstart="touch"></canvas><button id="open" bindtap="open">打开</button>',installCanvasPorts),canvas=dom.window.document.querySelector('#sky')!
    expect(canvas.tagName).toBe('CANVAS');dom.window.document.querySelector<HTMLButtonElement>('#open')!.click();pointer(dom,canvas,'pointerdown',7,53,76);expect(dom.window.eval('getApp().globalData.old')).toBeUndefined();expect(dom.window.eval('getApp().globalData.new')).toBeUndefined()
  })
  it('canvas touch coordinates use changed layout rather than captured old bounds', async () => {
    const dom=await canvasPreview('Page({data:{},touch(e){getApp().globalData.event=e}})','<canvas type="2d" id="sky" bindtouchstart="touch"></canvas>'),canvas=dom.window.document.querySelector<HTMLCanvasElement>('#sky')!
    expect(canvas.tagName).toBe('CANVAS');pointer(dom,canvas,'pointerdown',7,53,76);pointer(dom,canvas,'pointerup',7,53,76);canvas.getBoundingClientRect=()=>({left:30,top:40,right:270,bottom:240,width:240,height:200,x:30,y:40,toJSON(){return {}}});pointer(dom,canvas,'pointerdown',8,53,76);expect(dom.window.eval('getApp().globalData.event.touches[0]')).toMatchObject({x:23,y:36})
  })
  it('fields node does not pretend an ordinary view is a Canvas 2D node', async () => {
    const dom=await canvasPreview(undefined,'<view id="plain">文字</view>');expect(dom.window.eval('typeof wx.createSelectorQuery().select("#plain").fields')).toBe('function');dom.window.eval('wx.createSelectorQuery().select("#plain").fields({id:true,node:true}).exec(values=>getApp().globalData.result=values[0])');await Promise.resolve();expect(dom.window.eval('getApp().globalData.result')).toEqual({id:'plain'})
  })
  it('radio groups select exactly one string value and repeated clicks do not emit another change', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(e){getApp().globalData.value=e.detail.value;this.setData({calls:this.data.calls+1})}})' }, '', '', '<radio-group bindchange="change"><label><radio id="sun" value="sunny"/>晴天</label><label><radio id="cloud" value="cloudy"/>多云</label><label><radio id="rain" value="rain"/>小雨</label></radio-group><text id="calls">{{calls}}</text>')
    const document = dom.window.document, inputs = document.querySelectorAll<HTMLInputElement>('input[type=radio]')
    expect(inputs).toHaveLength(3); inputs[0].click(); expect(dom.window.eval('getApp().globalData.value')).toBe('sunny'); expect(inputs[0].checked).toBe(true)
    inputs[1].click(); expect(dom.window.eval('getApp().globalData.value')).toBe('cloudy'); expect(inputs[0].checked).toBe(false); expect(inputs[1].checked).toBe(true); inputs[1].click(); expect(document.querySelector('#calls')!.textContent).toBe('2')
    inputs[2].click(); expect([...inputs].filter(input => input.checked).map(input => input.value)).toEqual(['rain'])
  })
  it('radio groups without handlers still select independently from sibling groups', async () => {
    const dom = await preview({}, '', '', '<radio-group><radio id="first-a" value="same"/><radio id="first-b" value="other"/></radio-group><radio-group><radio id="second" value="same"/></radio-group>'), document = dom.window.document
    expect(document.querySelectorAll('input[type=radio]')).toHaveLength(3); document.querySelector<HTMLInputElement>('#first-a')!.click(); document.querySelector<HTMLInputElement>('#second')!.click(); expect(document.querySelector<HTMLInputElement>('#first-a')!.checked).toBe(true); document.querySelector<HTMLInputElement>('#first-b')!.click(); expect(document.querySelector<HTMLInputElement>('#first-a')!.checked).toBe(false); expect(document.querySelector<HTMLInputElement>('#second')!.checked).toBe(true)
  })
  it('native labels select nested and explicitly associated radios exactly once', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(){this.setData({calls:this.data.calls+1})}})' }, '', '', '<radio-group bindchange="change"><label id="nested"><radio id="sun" value="sunny"/>晴天</label><radio id="cloud" value="cloudy"/><label id="linked" for="cloud">多云</label></radio-group><text id="calls">{{calls}}</text>'), document = dom.window.document
    expect(document.querySelectorAll('input[type=radio]')).toHaveLength(2); document.querySelector<HTMLLabelElement>('#nested')!.click(); expect(document.querySelector<HTMLInputElement>('#sun')!.checked).toBe(true); document.querySelector<HTMLLabelElement>('#linked')!.click(); expect(document.querySelector<HTMLInputElement>('#sun')!.checked).toBe(false); expect(document.querySelector<HTMLInputElement>('#cloud')!.checked).toBe(true); expect(document.querySelector('#calls')!.textContent).toBe('2')
  })
  it.each(['bindchange', 'bind:change', 'catchchange', 'catch:change'])('radio group %s receives one string value with its own typed dataset', async binding => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(e){this.setData({calls:this.data.calls+1});getApp().globalData.event={value:e.detail.value,id:e.currentTarget.id,dataset:e.currentTarget.dataset,type:e.type}}})' }, '', '', `<radio-group id="weather" data-count="{{3}}" ${binding}="change"><radio id="pick" value="晴天☀"/></radio-group><text id="calls">{{calls}}</text>`), document = dom.window.document
    expect(document.querySelector('#pick')!.tagName).toBe('INPUT'); document.querySelector<HTMLInputElement>('#pick')!.click(); expect(dom.window.eval('getApp().globalData.event')).toEqual({value:'晴天☀',id:'weather',dataset:{count:3},type:'change'}); expect(document.querySelector('#calls')!.textContent).toBe('1')
  })
  it('radio setData updates bound checks disabled state value and color without emitting change', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{checked:false,locked:false,value:"old",color:"#5275de",calls:0},change(){this.setData({calls:this.data.calls+1})},update(){this.setData({checked:true,locked:true,value:"new",color:"#cc8844"})},reset(){this.setData({checked:false,locked:false,value:"old"})}})' }, '', '', '<radio-group bindchange="change"><radio id="pick" value="{{value}}" color="{{color}}" checked="{{checked}}" disabled="{{locked}}"/></radio-group><button id="update" bindtap="update">更新</button><button id="reset" bindtap="reset">恢复</button><text id="calls">{{calls}}</text>'), document = dom.window.document, input = document.querySelector<HTMLInputElement>('#pick')!
    expect(input.type).toBe('radio'); expect(input.checked).toBe(false); document.querySelector<HTMLButtonElement>('#update')!.click(); expect(document.querySelector('#pick')).toBe(input); expect(input.checked).toBe(true); expect(input.disabled).toBe(true); expect(input.value).toBe('new'); expect(input.style.accentColor).toBe('rgb(204, 136, 68)'); expect(document.querySelector('#calls')!.textContent).toBe('0'); document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(input.checked).toBe(false); expect(input.disabled).toBe(false); expect(input.value).toBe('old')
  })
  it('disabled radios and forced unchecked changes cannot invoke the handler', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(){this.setData({calls:this.data.calls+1})}})' }, '', '', '<radio-group bindchange="change"><label id="locked"><radio id="pick" value="sunny" disabled="{{true}}"/>晴天</label><radio id="free" value="rain"/></radio-group><text id="calls">{{calls}}</text>'), document = dom.window.document, input = document.querySelector<HTMLInputElement>('#pick')!
    expect(input.type).toBe('radio'); input.click(); document.querySelector<HTMLLabelElement>('#locked')!.click(); expect(input.checked).toBe(false); input.checked=true; input.dispatchEvent(new dom.window.Event('change',{bubbles:true})); document.querySelector('#free')!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(document.querySelector('#calls')!.textContent).toBe('0')
  })
  it('nested radio groups isolate values and selection from their outer group', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},outer(e){getApp().globalData.outer=e.detail.value},inner(e){getApp().globalData.inner=e.detail.value}})' }, '', '', '<radio-group bindchange="outer"><radio id="outer" value="outside"/><radio-group bindchange="inner"><radio id="inner" value="inside"/></radio-group></radio-group>'), document = dom.window.document
    expect(document.querySelectorAll('input[type=radio]')).toHaveLength(2); document.querySelector<HTMLInputElement>('#inner')!.click(); expect(dom.window.eval('getApp().globalData.inner')).toBe('inside'); expect(dom.window.eval('getApp().globalData.outer')).toBeUndefined(); document.querySelector<HTMLInputElement>('#outer')!.click(); expect(dom.window.eval('getApp().globalData.outer')).toBe('outside'); expect(document.querySelector<HTMLInputElement>('#inner')!.checked).toBe(true)
  })
  it('radio boolean attributes distinguish bare checked from bound false and defaults', async () => {
    const dom = await preview({}, '', '', '<radio id="bare" checked color="#5275de"/><radio id="empty" checked="{{false}}" disabled="{{false}}"/><radio id="disabled" disabled/>'), document = dom.window.document
    expect(document.querySelectorAll('input[type=radio]')).toHaveLength(3); expect(document.querySelector<HTMLInputElement>('#bare')!.checked).toBe(true); expect(document.querySelector<HTMLInputElement>('#bare')!.value).toBe(''); expect(document.querySelector<HTMLInputElement>('#bare')!.style.accentColor).toBe('rgb(82, 117, 222)'); expect(document.querySelector<HTMLInputElement>('#empty')!.checked).toBe(false); expect(document.querySelector<HTMLInputElement>('#empty')!.disabled).toBe(false); expect(document.querySelector<HTMLInputElement>('#disabled')!.disabled).toBe(true)
  })
  it('changed repeated radio lists use the current values and remain single select', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{items:[{id:"old",label:"旧天空"}]},change(e){getApp().globalData.value=e.detail.value},update(){this.setData({items:[{id:"new",label:"新天空"},{id:"rain",label:"小雨"}]})}})' }, '', '', '<radio-group bindchange="change"><label wx:for="{{items}}"><radio value="{{item.id}}"/>{{item.label}}</label></radio-group><button id="update" bindtap="update">换</button>'), document = dom.window.document
    expect(document.querySelectorAll('input[type=radio]')).toHaveLength(1); document.querySelector<HTMLButtonElement>('#update')!.click(); const inputs = document.querySelectorAll<HTMLInputElement>('input[type=radio]'); expect(inputs).toHaveLength(2); inputs[1].click(); expect(dom.window.eval('getApp().globalData.value')).toBe('rain'); inputs[0].click(); expect(dom.window.eval('getApp().globalData.value')).toBe('new'); expect(inputs[1].checked).toBe(false)
  })
  it('a detached radio cannot update a later page', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},change(){getApp().globalData.calls=(getApp().globalData.calls||0)+1},open(){wx.navigateTo({url:"/pages/records/index"})}})' }, '', '', '<radio-group bindchange="change"><radio id="pick" value="sunny"/></radio-group><button id="open" bindtap="open">下一页</button>'), document = dom.window.document, input = document.querySelector<HTMLInputElement>('#pick')!
    expect(input.type).toBe('radio'); document.querySelector<HTMLButtonElement>('#open')!.click(); expect(input.isConnected).toBe(false); input.click(); input.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.eval('getApp().globalData.calls')).toBeUndefined()
  })
  it('radio catchchange stops an outer change handler', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},group(){getApp().globalData.group=true},outer(){getApp().globalData.outer=true}})' }, '', '', '<view bindchange="outer"><radio-group catchchange="group"><radio id="pick" value="sunny"/></radio-group></view>'), document = dom.window.document
    expect(document.querySelector('#pick')!.tagName).toBe('INPUT'); document.querySelector<HTMLInputElement>('#pick')!.click(); expect(dom.window.eval('getApp().globalData.group')).toBe(true); expect(dom.window.eval('getApp().globalData.outer')).toBeUndefined()
  })
  it('unrelated rendering preserves an uncontrolled radio selection', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{tick:0},change(){this.setData({tick:this.data.tick+1})},redraw(){this.setData({tick:this.data.tick+1})}})' }, '', '', '<radio-group bindchange="change"><radio id="sun" value="sunny"/><radio id="rain" value="rain"/></radio-group><text>{{tick}}</text><button id="redraw" bindtap="redraw">重画</button>'), document = dom.window.document, input = document.querySelector<HTMLInputElement>('#sun')!
    expect(input.type).toBe('radio'); input.click(); document.querySelector<HTMLButtonElement>('#redraw')!.click(); expect(document.querySelector('#sun')).toBe(input); expect(input.checked).toBe(true); document.querySelector<HTMLInputElement>('#rain')!.click(); document.querySelector<HTMLButtonElement>('#redraw')!.click(); expect(input.checked).toBe(false); expect(document.querySelector<HTMLInputElement>('#rain')!.checked).toBe(true)
  })
  it('native removeStorageSync deletes one local key and sends an explicit removal message', async () => {
    const dom = await preview(), post = vi.spyOn(dom.window.parent, 'postMessage').mockImplementation(() => {})
    expect(dom.window.eval('typeof wx.removeStorageSync')).toBe('function'); dom.window.eval('wx.setStorageSync("walk",["sky"]);wx.setStorageSync("other",null);wx.removeStorageSync("walk")')
    expect(dom.window.eval('wx.getStorageSync("walk")')).toBeUndefined(); expect(dom.window.eval('wx.getStorageSync("other")')).toBeNull(); expect(dom.window.eval('wx.getStorageSync("count")')).toBe(3); expect(post.mock.calls.at(-1)).toEqual([{type:'doda-preview-storage',key:'walk',remove:true},'*'])
  })
  it('removing an absent key is idempotent and keeps other stored values', async () => {
    const dom = await preview(), post = vi.spyOn(dom.window.parent, 'postMessage').mockImplementation(() => {})
    expect(dom.window.eval('typeof wx.removeStorageSync')).toBe('function'); dom.window.eval('wx.removeStorageSync("absent");wx.removeStorageSync("absent")')
    expect(dom.window.eval('wx.getStorageSync("absent")')).toBeUndefined(); expect(dom.window.eval('wx.getStorageSync("count")')).toBe(3); expect(post).toHaveBeenCalledTimes(2)
  })
  it('a native reset deletes storage before clearing the visible count', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:3},reset(){wx.removeStorageSync("count");this.setData({value:0})}})' }, '', '', '<text id="count">{{value}}</text><button id="reset" bindtap="reset">清空</button>')
    expect(dom.window.eval('typeof wx.removeStorageSync')).toBe('function'); dom.window.document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(dom.window.document.querySelector('#count')!.textContent).toBe('0'); expect(dom.window.eval('wx.getStorageSync("count")')).toBeUndefined()
  })
  it('checkbox groups emit all selected string values and support independent deselection', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(e){getApp().globalData.values=e.detail.value;this.setData({calls:this.data.calls+1})}})' }, '', '', '<checkbox-group bindchange="change"><label><checkbox id="sky" value="sky"/>看看天空</label><label><checkbox id="walk" value="walk"/>走二十步</label><label><checkbox id="breathe" value="breathe"/>深呼吸一次</label></checkbox-group><text id="calls">{{calls}}</text>')
    const document = dom.window.document, inputs = document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect(inputs).toHaveLength(3); inputs[1].click(); expect(dom.window.eval('getApp().globalData.values')).toEqual(['walk']); expect(inputs[1].checked).toBe(true)
    inputs[0].click(); expect(dom.window.eval('getApp().globalData.values')).toEqual(['sky','walk']); inputs[1].click(); expect(dom.window.eval('getApp().globalData.values')).toEqual(['sky']); expect(document.querySelector('#calls')!.textContent).toBe('3')
  })
  it('checkbox groups keep selected values separate even with identical sibling values', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},first(e){getApp().globalData.first=e.detail.value},second(e){getApp().globalData.second=e.detail.value}})' }, '', '', '<checkbox-group bindchange="first"><checkbox id="first" value="same"/></checkbox-group><checkbox-group bindchange="second"><checkbox id="second" value="same"/></checkbox-group>')
    const document = dom.window.document; expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(2)
    document.querySelector<HTMLInputElement>('#first')!.click(); expect(dom.window.eval('getApp().globalData.first')).toEqual(['same']); expect(dom.window.eval('getApp().globalData.second')).toBeUndefined(); expect(document.querySelector<HTMLInputElement>('#second')!.checked).toBe(false)
    document.querySelector<HTMLInputElement>('#second')!.click(); expect(dom.window.eval('getApp().globalData.second')).toEqual(['same']); document.querySelector<HTMLInputElement>('#first')!.click(); expect(dom.window.eval('getApp().globalData.first')).toEqual([]); expect(document.querySelector<HTMLInputElement>('#second')!.checked).toBe(true)
  })
  it('native labels toggle nested and explicitly associated checkboxes once', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(){this.setData({calls:this.data.calls+1})}})' }, '', '', '<checkbox-group bindchange="change"><label id="nested"><checkbox id="sky" value="sky"/>看看天空</label><checkbox id="walk" value="walk"/><label id="linked" for="walk">走二十步</label></checkbox-group><text id="calls">{{calls}}</text>')
    const document = dom.window.document; expect(document.querySelector('#nested')!.tagName).toBe('LABEL'); expect(document.querySelector('#linked')!.getAttribute('for')).toBe('walk')
    document.querySelector<HTMLLabelElement>('#nested')!.click(); expect(document.querySelector<HTMLInputElement>('#sky')!.checked).toBe(true); expect(document.querySelector('#calls')!.textContent).toBe('1')
    document.querySelector<HTMLLabelElement>('#linked')!.click(); expect(document.querySelector<HTMLInputElement>('#walk')!.checked).toBe(true); expect(document.querySelector('#calls')!.textContent).toBe('2')
  })
  it.each(['bindchange','bind:change','catchchange','catch:change'])('checkbox group %s receives array values once with its own dataset', async binding => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(e){this.setData({calls:this.data.calls+1});getApp().globalData.event={values:e.detail.value,id:e.currentTarget.id,dataset:e.currentTarget.dataset,type:e.type}}})' }, '', '', `<checkbox-group id="tasks" data-count="{{3}}" ${binding}="change"><checkbox id="pick" value="天空☁"/></checkbox-group><text id="calls">{{calls}}</text>`)
    const document = dom.window.document; expect(document.querySelector('#pick')!.tagName).toBe('INPUT'); document.querySelector<HTMLInputElement>('#pick')!.click()
    expect(dom.window.eval('getApp().globalData.event')).toEqual({values:['天空☁'],id:'tasks',dataset:{count:3},type:'change'}); expect(document.querySelector('#calls')!.textContent).toBe('1')
  })
  it('checkbox setData synchronizes bound state disabled value and color without emitting change', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{checked:false,locked:false,value:"old",color:"#36896b",calls:0},change(){this.setData({calls:this.data.calls+1})},update(){this.setData({checked:true,locked:true,value:"new",color:"#cc8844"})},reset(){this.setData({checked:false,locked:false,value:"old"})}})' }, '', '', '<checkbox-group id="group" bindchange="change"><checkbox id="pick" value="{{value}}" color="{{color}}" checked="{{checked}}" disabled="{{locked}}"/></checkbox-group><button id="update" bindtap="update">更新</button><button id="reset" bindtap="reset">恢复</button><text id="calls">{{calls}}</text>')
    const document = dom.window.document, input = document.querySelector<HTMLInputElement>('#pick')!, group = document.querySelector('#group')!; expect(input.tagName).toBe('INPUT'); expect(input.checked).toBe(false)
    document.querySelector<HTMLButtonElement>('#update')!.click(); expect(document.querySelector('#pick')).toBe(input); expect(document.querySelector('#group')).toBe(group); expect(input.checked).toBe(true); expect(input.disabled).toBe(true); expect(input.value).toBe('new'); expect(input.style.accentColor).toBe('rgb(204, 136, 68)'); expect(document.querySelector('#calls')!.textContent).toBe('0')
    document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(input.checked).toBe(false); expect(input.disabled).toBe(false); expect(input.value).toBe('old'); expect(document.querySelector('#calls')!.textContent).toBe('0')
  })
  it('disabled checkboxes and forced change events never invoke the group handler', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{calls:0},change(){this.setData({calls:this.data.calls+1})}})' }, '', '', '<checkbox-group bindchange="change"><label id="locked"><checkbox id="pick" value="sky" disabled="{{true}}"/>天空</label></checkbox-group><text id="calls">{{calls}}</text>')
    const document = dom.window.document, input = document.querySelector<HTMLInputElement>('#pick')!; expect(input.tagName).toBe('INPUT'); expect(input.disabled).toBe(true); input.click(); document.querySelector<HTMLLabelElement>('#locked')!.click(); input.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(input.checked).toBe(false); expect(document.querySelector('#calls')!.textContent).toBe('0')
  })
  it('nested checkbox groups dispatch only to their nearest group and exclude nested values', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},outer(e){getApp().globalData.outer=e.detail.value},inner(e){getApp().globalData.inner=e.detail.value}})' }, '', '', '<checkbox-group bindchange="outer"><checkbox id="outer" value="outside"/><checkbox-group bindchange="inner"><checkbox id="inner" value="inside"/></checkbox-group></checkbox-group>')
    const document = dom.window.document; expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(2); document.querySelector<HTMLInputElement>('#inner')!.click(); expect(dom.window.eval('getApp().globalData.inner')).toEqual(['inside']); expect(dom.window.eval('getApp().globalData.outer')).toBeUndefined(); document.querySelector<HTMLInputElement>('#outer')!.click(); expect(dom.window.eval('getApp().globalData.outer')).toEqual(['outside'])
  })
  it('checkbox boolean attributes distinguish defaults bare checked and bound false', async () => {
    const dom = await preview({}, '', '', '<checkbox id="bare" checked color="#36896b"/><checkbox id="empty" checked="{{false}}" disabled="{{false}}"/><checkbox id="disabled" disabled/>')
    const document = dom.window.document; expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(3); expect(document.querySelector<HTMLInputElement>('#bare')!.checked).toBe(true); expect(document.querySelector<HTMLInputElement>('#bare')!.value).toBe(''); expect(document.querySelector<HTMLInputElement>('#bare')!.style.accentColor).toBe('rgb(54, 137, 107)'); expect(document.querySelector<HTMLInputElement>('#empty')!.checked).toBe(false); expect(document.querySelector<HTMLInputElement>('#empty')!.disabled).toBe(false); expect(document.querySelector<HTMLInputElement>('#disabled')!.disabled).toBe(true)
  })
  it('a changed repeated checkbox list uses current values rather than captured old ones', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{items:[{id:"old",label:"旧天空"}]},change(e){getApp().globalData.values=e.detail.value},update(){this.setData({items:[{id:"new",label:"新天空"},{id:"walk",label:"散步"}]})}})' }, '', '', '<checkbox-group bindchange="change"><label wx:for="{{items}}"><checkbox value="{{item.id}}"/>{{item.label}}</label></checkbox-group><button id="update" bindtap="update">换</button>')
    const document = dom.window.document; expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(1); document.querySelector<HTMLButtonElement>('#update')!.click(); expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(2); document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1].click(); expect(dom.window.eval('getApp().globalData.values')).toEqual(['walk']); document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[0].click(); expect(dom.window.eval('getApp().globalData.values')).toEqual(['new','walk'])
  })
  it('a detached checkbox from a previous page cannot update the current page', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},change(){getApp().globalData.calls=(getApp().globalData.calls||0)+1},open(){wx.navigateTo({url:"/pages/records/index"})}})' }, '', '', '<checkbox-group bindchange="change"><checkbox id="pick" value="sky"/></checkbox-group><button id="open" bindtap="open">去下一页</button>')
    const document = dom.window.document, input = document.querySelector<HTMLInputElement>('#pick')!; expect(input.tagName).toBe('INPUT'); document.querySelector<HTMLButtonElement>('#open')!.click(); expect(input.isConnected).toBe(false); input.click(); input.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.eval('getApp().globalData.calls')).toBeUndefined()
  })
  it('catchchange stops the group event before an outer change listener', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{},group(){getApp().globalData.group=true},outer(){getApp().globalData.outer=true}})' }, '', '', '<view bindchange="outer"><checkbox-group catchchange="group"><checkbox id="pick" value="sky"/></checkbox-group></view>')
    const document = dom.window.document; expect(document.querySelector('#pick')!.tagName).toBe('INPUT'); document.querySelector<HTMLInputElement>('#pick')!.click(); expect(dom.window.eval('getApp().globalData.group')).toBe(true); expect(dom.window.eval('getApp().globalData.outer')).toBeUndefined()
  })
  function pointer(dom: InstanceType<typeof JSDOM>, element: Element, type: string, id = 1, x = 20, y = 30, button = 0) {
    const event = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button })
    Object.defineProperty(event, 'pointerId', { value: id }); element.dispatchEvent(event)
  }
  async function clouds(current = 0) {
    return preview({ 'pages/home/index.js': `Page({data:{current:${current},note:0},change(e){getApp().globalData.changes=(getApp().globalData.changes||[]).concat(e);if(e.detail.source==='touch')this.setData({current:e.detail.current})},reset(){this.setData({current:0})}})` }, '', '', '<swiper id="clouds" data-role="cloud-window" current="{{current}}" autoplay="{{false}}" circular="{{false}}" duration="300" bind:change="change"><swiper-item id="first"><view>天空</view></swiper-item><swiper-item id="second"><view>慢一点</view></swiper-item><swiper-item id="third"><view>这一刻</view></swiper-item></swiper><view id="page">{{current+1}} / 3</view><button id="reset" bindtap="reset">从头看看</button>')
  }
  it.each([
    [1, ['0:0']],
    [3, ['0:0', '1:1', '2:2']],
    [9, ['0:0', '1:1', '2:2', '3:3', '4:4', '5:5', '6:6', '7:7', '8:8']],
  ])('a numeric for-list of %s supplies each native item and index', async (count, expected) => {
    const dom = await preview({ 'pages/home/index.js': `Page({data:{count:${count}}})` }, '', '', '<view class="number" wx:for="{{count}}" wx:key="*this">{{index}}:{{item}}</view>')
    expect([...dom.window.document.querySelectorAll('.number')].map(element => element.textContent)).toEqual(expected)
  })
  it('a numeric nine-cell grid initially displays one dot in the fifth cell', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{pos:4}})' }, '', '', '<view class="cell" wx:for="{{9}}" wx:key="index"><view class="dot" wx:if="{{pos===index}}"></view></view>')
    const cells = dom.window.document.querySelectorAll('.cell')
    expect(cells).toHaveLength(9); expect(dom.window.document.querySelectorAll('.dot')).toHaveLength(1); expect(cells[4].querySelector('.dot')).not.toBeNull()
  })
  it('a numeric grid updates its dot and boundary controls after movement', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{pos:4},up(){if(this.data.pos>2)this.setData({pos:this.data.pos-3})},reset(){this.setData({pos:4})}})' }, '', '', '<view class="cell" wx:for="{{9}}" wx:key="index"><view class="dot" wx:if="{{pos===index}}"></view></view><button id="up" disabled="{{pos<3}}" bindtap="up">上</button><button id="reset" bindtap="reset">重来</button>')
    const document = dom.window.document, up = document.querySelector<HTMLButtonElement>('#up')!
    up.click(); expect(document.querySelectorAll('.cell')).toHaveLength(9); expect(document.querySelectorAll('.dot')).toHaveLength(1); expect(document.querySelectorAll('.cell')[1].querySelector('.dot')).not.toBeNull(); expect(up.disabled).toBe(true)
    up.click(); expect(document.querySelectorAll('.cell')[1].querySelector('.dot')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(document.querySelectorAll('.cell')[4].querySelector('.dot')).not.toBeNull(); expect(up.disabled).toBe(false)
  })
  it('changing a numeric count grows shrinks and clears its repeated nodes', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{count:2},change(){this.setData({count:({2:4,4:1,1:0})[this.data.count]})}})' }, '', '', '<view class="item" wx:for="{{count}}" wx:for-item="entry" wx:for-index="position">{{entry}}/{{position}}</view><button id="change" bindtap="change">换</button>')
    const document = dom.window.document, change = document.querySelector<HTMLButtonElement>('#change')!, words = () => [...document.querySelectorAll('.item')].map(element => element.textContent)
    expect(words()).toEqual(['0/0','1/1']); change.click(); expect(words()).toEqual(['0/0','1/1','2/2','3/3']); change.click(); expect(words()).toEqual(['0/0']); change.click(); expect(words()).toEqual([])
  })
  it('nested numeric lists keep distinct outer and inner index scopes', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{}})' }, '', '', '<view wx:for="{{3}}" wx:for-index="row"><view class="cell" wx:for="{{3}}" wx:for-index="col">{{row}}/{{col}}</view></view>')
    expect([...dom.window.document.querySelectorAll('.cell')].map(element => element.textContent)).toEqual(['0/0','0/1','0/2','1/0','1/1','1/2','2/0','2/1','2/2'])
  })
  it.each(['0','-1','1.5','NaN','Infinity','4294967296'])('an empty or non-repeatable numeric count %s renders no items', async count => {
    const dom = await preview({ 'pages/home/index.js': `Page({data:{count:${count}}})` }, '', '', '<view class="item" wx:for="{{count}}">{{item}}</view>')
    expect(dom.window.document.querySelectorAll('.item')).toHaveLength(0)
  })
  it('bound numeric datasets let a native grid react to a strict numeric index', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{cells:[0,1,2,3,4,5,6,7,8],lit:4},tap(e){if(e.currentTarget.dataset.index===this.data.lit)this.setData({lit:0})}})' }, '', '', '<view wx:for="{{cells}}" wx:key="*this" data-index="{{item}}" class="cell {{item===lit ? \'on\' : \'\'}}" bindtap="tap"></view>')
    const document = dom.window.document, cells = document.querySelectorAll<HTMLElement>('.cell')
    cells[0].click(); expect(document.querySelector('.on')).toBe(cells[4])
    cells[4].click(); expect(document.querySelectorAll('.on')).toHaveLength(1); expect(document.querySelector('.on')).toBe(cells[0])
  })
  it('whole dataset expressions preserve numbers, booleans, null and objects while literals stay strings', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:4,flag:false,nothing:null,item:{title:"mint",values:[0,2]}},tap(e){getApp().globalData.dataset=e.currentTarget.dataset;getApp().globalData.target=e.target.dataset}})' }, '', '', '<button id="values" data-number="{{value}}" data-zero="{{0}}" data-flag="{{flag}}" data-nothing="{{nothing}}" data-item="{{item}}" data-literal="4" data-mixed="cell-{{value}}" data-pair="{{value}}/{{0}}" data-adjacent="{{value}}{{0}}" data-element-type="{{value}}" bindtap="tap">值</button>')
    dom.window.document.querySelector<HTMLButtonElement>('#values')!.click()
    expect(dom.window.eval('getApp().globalData.dataset')).toEqual({number:4,zero:0,flag:false,nothing:null,item:{title:'mint',values:[0,2]},literal:'4',mixed:'cell-4',pair:'4/0',adjacent:'40',elementType:4})
    expect(dom.window.eval('getApp().globalData.target')).toEqual(dom.window.eval('getApp().globalData.dataset'))
  })
  it('a retained native element receives the new dataset type even when its HTML attribute is unchanged', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:4},tap(e){getApp().globalData.values=(getApp().globalData.values||[]).concat([[e.currentTarget.dataset.value,typeof e.currentTarget.dataset.value]])},update(){this.setData({value:"4"})}})' }, '', '', '<button id="value" data-value="{{value}}" bindtap="tap">取值</button><button id="update" bindtap="update">更新</button>')
    const document = dom.window.document, value = document.querySelector<HTMLButtonElement>('#value')!
    value.click(); document.querySelector<HTMLButtonElement>('#update')!.click(); expect(document.querySelector('#value')).toBe(value); expect(value.getAttribute('data-value')).toBe('4'); value.click()
    expect(dom.window.eval('getApp().globalData.values')).toEqual([[4,'number'],['4','string']])
  })
  it.each(['slider', 'switch', 'picker'])('native %s controls expose typed bound datasets alongside their native detail value', async type => {
    const markup = type === 'picker' ? '<picker id="control" data-index="{{4}}" range="{{items}}" bindchange="change"><view>选</view></picker>' : `<${type} id="control" data-index="{{4}}" bindchange="change"/>`
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{items:["一","二"]},change(e){getApp().globalData.event=e}})' }, '', '', markup), document = dom.window.document
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(type === 'picker' ? '#control select' : '#control')!
    if (type === 'switch') (control as HTMLInputElement).checked = true
    else control.value = type === 'picker' ? '1' : '75'
    control.dispatchEvent(new dom.window.Event('change',{bubbles:true}))
    expect(dom.window.eval('getApp().globalData.event.currentTarget.dataset')).toEqual({index:4}); expect(dom.window.eval('getApp().globalData.event.target.dataset')).toEqual({index:4})
    expect(dom.window.eval('getApp().globalData.event.detail.value')).toBe(type === 'switch' ? true : type === 'picker' ? 1 : 75)
  })
  it('native touch handlers preserve a numeric dataset after an in-place data update', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:4},touch(e){getApp().globalData.values=(getApp().globalData.values||[]).concat([e.currentTarget.dataset.value]);this.setData({value:5})}})' }, '', '', '<view id="touch" data-value="{{value}}" bindtouchstart="touch"></view>'), element = dom.window.document.querySelector('#touch')!
    pointer(dom, element, 'pointerdown'); pointer(dom, element, 'pointerup'); pointer(dom, element, 'pointerdown'); pointer(dom, element, 'pointerup')
    expect(dom.window.document.querySelector('#touch')).toBe(element); expect(dom.window.eval('getApp().globalData.values')).toEqual([4,5])
  })
  it('selector query results expose bound native dataset values without internal preview keys', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{index:0},read(){wx.createSelectorQuery().select("#item").boundingClientRect(result=>{getApp().globalData.dataset=result.dataset}).exec()}})' }, '', '', '<view id="item" data-index="{{index}}" data-literal="0"></view><button id="read" bindtap="read">读</button>')
    dom.window.document.querySelector<HTMLButtonElement>('#read')!.click(); await vi.waitFor(() => expect(dom.window.eval('getApp().globalData.dataset')).toEqual({index:0,literal:'0'}))
  })
  it('a native swiper sizes its items and exposes only the selected cloud', async () => {
    const dom = await clouds(1), document = dom.window.document, deck = document.querySelector('#clouds')!
    expect(deck.tagName).toBe('WX-SWIPER'); expect(Array.from(deck.children, item => item.tagName)).toEqual(['WX-SWIPER-ITEM', 'WX-SWIPER-ITEM', 'WX-SWIPER-ITEM'])
    expect(Array.from(deck.children, item => item.getAttribute('aria-hidden'))).toEqual(['true', 'false', 'true']); expect((document.querySelector('#first') as HTMLElement).style.transform).toBe('translateX(-100%)'); expect((document.querySelector('#second') as HTMLElement).style.transform).toBe('translateX(0%)')
    expect(dom.window.eval('getApp().globalData.changes')).toBeUndefined()
  })
  it('a horizontal swipe advances the page once with a native change payload and retains the gesture target', async () => {
    const dom = await clouds(), document = dom.window.document, deck = document.querySelector('#clouds')!, child = deck.querySelector('view,wx-view')!
    pointer(dom, child, 'pointerdown', 7, 200, 50); pointer(dom, child, 'pointermove', 7, 60, 52); pointer(dom, child, 'pointerup', 7, 60, 52)
    expect(document.querySelector('#page')?.textContent).toBe('2 / 3'); expect(document.querySelector('#clouds')).toBe(deck); expect(document.querySelectorAll('#clouds [aria-hidden="false"]')).toHaveLength(1)
    const changes = dom.window.eval('getApp().globalData.changes') as Array<{ type: string, detail: { current: number, source: string }, currentTarget: { id: string, dataset: Record<string, string> } }>
    expect(changes).toHaveLength(1); expect(changes[0].type).toBe('change'); expect(changes[0].detail).toEqual({ current: 1, source: 'touch' }); expect(changes[0].currentTarget).toEqual({ id: 'clouds', dataset: { role: 'cloud-window' } })
    await Promise.resolve(); expect(dom.window.eval('getApp().globalData.changes')).toHaveLength(1)
  })
  it('programmatic current changes reset the visible cloud and report an empty source once', async () => {
    const dom = await clouds(2), document = dom.window.document
    ;(document.querySelector('#reset') as HTMLButtonElement).click(); expect(document.querySelector('#page')?.textContent).toBe('1 / 3'); expect(document.querySelector('#first')?.getAttribute('aria-hidden')).toBe('false')
    await Promise.resolve(); expect(dom.window.eval('getApp().globalData.changes.map(e=>e.detail)')).toEqual([{ current: 0, source: '' }]); (document.querySelector('#reset') as HTMLButtonElement).click(); await Promise.resolve(); expect(dom.window.eval('getApp().globalData.changes')).toHaveLength(1)
  })
  it('finite swiping stays at the first and last clouds without inventing change events', async () => {
    const dom = await clouds(), deck = dom.window.document.querySelector('#clouds')!
    function swipe(from: number, to: number) { pointer(dom, deck, 'pointerdown', 1, from, 50); pointer(dom, deck, 'pointerup', 1, to, 50) }
    swipe(50, 200); expect(dom.window.document.querySelector('#page')?.textContent).toBe('1 / 3'); expect(dom.window.eval('getApp().globalData.changes')).toBeUndefined()
    swipe(200, 50); swipe(200, 50); swipe(200, 50); expect(dom.window.document.querySelector('#page')?.textContent).toBe('3 / 3'); expect(dom.window.eval('getApp().globalData.changes')).toHaveLength(2)
    swipe(50, 200); expect(dom.window.document.querySelector('#page')?.textContent).toBe('2 / 3')
  })
  it('a short tap, vertical motion, hover and secondary click cannot change a horizontal cloud', async () => {
    const dom = await clouds(), deck = dom.window.document.querySelector('#clouds')!
    pointer(dom, deck, 'pointermove', 1, 50, 50); pointer(dom, deck, 'pointerdown', 1, 200, 50, 2); pointer(dom, deck, 'pointerup', 1, 50, 50, 2)
    pointer(dom, deck, 'pointerdown', 1, 200, 50); pointer(dom, deck, 'pointerup', 1, 190, 50)
    pointer(dom, deck, 'pointerdown', 1, 200, 50); pointer(dom, deck, 'pointerup', 1, 150, 250)
    expect(dom.window.document.querySelector('#page')?.textContent).toBe('1 / 3'); expect(dom.window.eval('getApp().globalData.changes')).toBeUndefined()
  })
  it.each(['pointercancel', 'lostpointercapture', 'blur'])('an interrupted swipe %s returns to the current cloud and ignores a stale release', async type => {
    const dom = await clouds(), deck = dom.window.document.querySelector('#clouds')!
    pointer(dom, deck, 'pointerdown', 1, 200, 50); pointer(dom, deck, 'pointermove', 1, 50, 50)
    if (type === 'blur') dom.window.dispatchEvent(new dom.window.Event('blur')); else pointer(dom, deck, type)
    pointer(dom, deck, 'pointerup', 1, 50, 50); expect(dom.window.document.querySelector('#page')?.textContent).toBe('1 / 3'); expect((dom.window.document.querySelector('#first') as HTMLElement).style.transform).toBe('translateX(0%)'); expect(dom.window.eval('getApp().globalData.changes')).toBeUndefined()
  })
  it('a programmatic reset during a drag invalidates that gesture before its late release', async () => {
    const dom = await clouds(1), document = dom.window.document, deck = document.querySelector('#clouds')!
    pointer(dom, deck, 'pointerdown', 1, 200, 50); pointer(dom, deck, 'pointermove', 1, 50, 50); (document.querySelector('#reset') as HTMLButtonElement).click(); pointer(dom, deck, 'pointerup', 1, 50, 50)
    await Promise.resolve(); expect(document.querySelector('#page')?.textContent).toBe('1 / 3'); expect(dom.window.eval('getApp().globalData.changes.map(e=>e.detail)')).toEqual([{ current: 0, source: '' }])
  })
  it('inactive autoplay and unrelated setData leave the current cloud available for the next swipe', async () => {
    vi.useFakeTimers(); const dom = await clouds(1), document = dom.window.document, deck = document.querySelector('#clouds')!
    vi.advanceTimersByTime(30000); dom.window.eval('getCurrentPages()[0].setData({note:1})'); expect(document.querySelector('#page')?.textContent).toBe('2 / 3'); expect(document.querySelector('#second')?.getAttribute('aria-hidden')).toBe('false'); expect(document.querySelector('#clouds')).toBe(deck)
    pointer(dom, deck, 'pointerdown', 1, 200, 50); pointer(dom, deck, 'pointerup', 1, 50, 50); expect(document.querySelector('#page')?.textContent).toBe('3 / 3')
  })
  it('native hold starts, grows through setData and stops on pointer release without replacing the target', async () => {
    vi.useFakeTimers()
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{count:0},start(){this.timer=setInterval(()=>this.setData({count:this.data.count+1}),150)},stop(){clearInterval(this.timer)}})' }, '', '', '<view id="ball" bindtouchstart="start" bindtouchend="stop">{{count}}</view>')
    const ball = dom.window.document.querySelector('#ball')!
    pointer(dom, ball, 'pointerdown'); vi.advanceTimersByTime(149); expect(ball.textContent).toBe('0'); vi.advanceTimersByTime(151); expect(ball.textContent).toBe('2'); expect(dom.window.document.querySelector('#ball')).toBe(ball)
    pointer(dom, ball, 'pointerup'); vi.advanceTimersByTime(600); expect(ball.textContent).toBe('2')
  })
  it('touch payloads carry coordinates, identifiers, target datasets and remaining contacts', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({record(e){getApp().globalData.events=(getApp().globalData.events||[]).concat([{type:e.type,touches:e.touches,changed:e.changedTouches,current:e.currentTarget.dataset.role,target:e.target.dataset.role}])}})' }, '', '', '<view id="ball" data-role="planet" bind:touchstart="record" bind:touchmove="record" bind:touchend="record"><text id="inner" data-role="center">球</text></view>'), ball = dom.window.document.querySelector('#inner')!
    pointer(dom, ball, 'pointerdown', 7, 21, 31); pointer(dom, ball, 'pointerdown', 9, 42, 52); pointer(dom, ball, 'pointermove', 7, 23, 33); pointer(dom, ball, 'pointerup', 7, 24, 34)
    const events = dom.window.eval('getApp().globalData.events') as Array<{ type: string, touches: Array<{ identifier: number, clientX: number, clientY: number }>, changed: Array<{ identifier: number, clientX: number, clientY: number }>, current: string, target: string }>
    expect(events.map((e: { type: string }) => e.type)).toEqual(['touchstart', 'touchstart', 'touchmove', 'touchend']); expect(events.map((e: { touches: unknown[] }) => e.touches.length)).toEqual([1, 2, 2, 1])
    expect(events[2].touches.map((t: { identifier: number, clientX: number, clientY: number }) => [t.identifier, t.clientX, t.clientY])).toEqual([[7, 23, 33], [9, 42, 52]])
    expect(events[3].changed.map((t: { identifier: number, clientX: number, clientY: number }) => [t.identifier, t.clientX, t.clientY])).toEqual([[7, 24, 34]]); expect(events[3].current).toBe('planet'); expect(events[3].target).toBe('center')
  })
  it('catch touch bindings stop parent propagation and ignore disabled or secondary presses', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({record(e){getApp().globalData.events=(getApp().globalData.events||[]).concat(e.currentTarget.dataset.role)}})' }, '', '', '<view data-role="outer" bindtouchstart="record"><view id="ball" data-role="inner" catch:touchstart="record">球</view></view><button id="disabled" disabled bindtouchstart="record">不可按</button>')
    const ball = dom.window.document.querySelector('#ball')!
    pointer(dom, ball, 'pointerdown', 1, 20, 30, 2); pointer(dom, dom.window.document.querySelector('#disabled')!, 'pointerdown'); expect(dom.window.eval('getApp().globalData.events')).toBeUndefined()
    pointer(dom, ball, 'pointerdown'); expect(dom.window.eval('getApp().globalData.events')).toEqual(['inner'])
  })
  it('hover moves and duplicate pointer starts cannot invoke a native hold twice', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{starts:0,moves:0},start(){this.setData({starts:this.data.starts+1})},move(){this.setData({moves:this.data.moves+1})}})' }, '', '', '<view id="ball" bindtouchstart="start" bindtouchmove="move">{{starts}}/{{moves}}</view>'), ball = dom.window.document.querySelector('#ball')!
    pointer(dom, ball, 'pointermove'); expect(ball.textContent).toBe('0/0'); pointer(dom, ball, 'pointerdown'); pointer(dom, ball, 'pointerdown'); pointer(dom, ball, 'pointermove'); expect(ball.textContent).toBe('1/1')
  })
  it('lost capture cancels a native hold once and a later release cannot emit another ending', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{cancelled:0,ended:0},cancel(){this.setData({cancelled:this.data.cancelled+1})},end(){this.setData({ended:this.data.ended+1})}})' }, '', '', '<view id="ball" bindtouchcancel="cancel" bindtouchend="end">{{cancelled}}/{{ended}}</view>'), ball = dom.window.document.querySelector('#ball')!
    pointer(dom, ball, 'pointerdown'); pointer(dom, ball, 'lostpointercapture'); pointer(dom, ball, 'pointerup'); pointer(dom, ball, 'pointercancel'); expect(ball.textContent).toBe('1/0')
  })
  it('window blur cancels an active hold and leaves no growing native interval', async () => {
    vi.useFakeTimers()
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{count:0,cancels:0},start(){this.timer=setInterval(()=>this.setData({count:this.data.count+1}),150)},cancel(){clearInterval(this.timer);this.setData({cancels:this.data.cancels+1})}})' }, '', '', '<view id="ball" bindtouchstart="start" bindtouchcancel="cancel">{{count}}/{{cancels}}</view>'), ball = dom.window.document.querySelector('#ball')!
    pointer(dom, ball, 'pointerdown'); vi.advanceTimersByTime(300); expect(ball.textContent).toBe('2/0'); dom.window.dispatchEvent(new dom.window.Event('blur')); dom.window.dispatchEvent(new dom.window.Event('blur')); vi.advanceTimersByTime(900); expect(ball.textContent).toBe('2/1')
  })
  it('selector measurement is asynchronous and returns live geometry with the native callback order', async () => {
    const dom = await preview({}, '', '', '<view id="ball" data-role="planet">球</view>'), ball = dom.window.document.querySelector('#ball')!
    let width = 80
    ball.getBoundingClientRect = () => ({ left: 100, top: 120, right: 100 + width, bottom: 120 + width, width, height: width, x: 100, y: 120, toJSON() {} })
    dom.window.eval('getApp().globalData.calls=[]; const q=wx.createSelectorQuery().in(getCurrentPages()[0]); q.select("#ball").boundingClientRect(r=>{getApp().globalData.calls.push("node");getApp().globalData.rect=r}); getApp().globalData.execResult=q.exec(r=>{getApp().globalData.calls.push("batch");getApp().globalData.results=r});')
    expect(dom.window.eval('getApp().globalData.calls')).toEqual([]); expect(dom.window.eval('getApp().globalData.execResult')).toBeUndefined(); width = 120; await Promise.resolve()
    expect(dom.window.eval('getApp().globalData.calls')).toEqual(['node', 'batch']); expect(dom.window.eval('getApp().globalData.rect')).toEqual({ id: 'ball', dataset: { role: 'planet' }, left: 100, top: 120, right: 220, bottom: 240, width: 120, height: 120 }); expect(dom.window.eval('getApp().globalData.results.length')).toBe(1)
  })
  it('selector queries preserve single and multiple results, null misses and queue order', async () => {
    const dom = await preview({}, '', '', '<view id="one" class="balls">一</view><view id="two" class="balls">二</view>')
    dom.window.eval('const q=wx.createSelectorQuery(); q.select(".balls").boundingClientRect().selectAll(".balls").boundingClientRect().select("#missing").boundingClientRect().selectAll("#missing").boundingClientRect().exec(r=>getApp().globalData.results=r);')
    await Promise.resolve(); const result = dom.window.eval('getApp().globalData.results') as [{ id: string }, Array<{ id: string }>, null, unknown[]]
    expect(result[0].id).toBe('one'); expect(result[1].map((r: { id: string }) => r.id)).toEqual(['one', 'two']); expect(result[2]).toBeNull(); expect(result[3]).toEqual([])
  })
  it('selector queries exclude preview chrome and an obsolete page scope', async () => {
    const dom = await preview(); dom.window.eval('wx.showToast({title:"预览提示"}); wx.createSelectorQuery().select("#toast").boundingClientRect().exec(r=>getApp().globalData.results=r);')
    await Promise.resolve(); expect(dom.window.eval('getApp().globalData.results')).toEqual([null])
    dom.window.eval('const owner=getCurrentPages()[0]; const q=wx.createSelectorQuery().in(owner); q.select("#records").boundingClientRect().exec(r=>getApp().globalData.results=r); wx.navigateTo({url:"/pages/records/index"});')
    await Promise.resolve(); expect(dom.window.eval('getApp().globalData.results')).toEqual([null])
  })
  it('native progress advances through six values and resets without replacing its element', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{stage:0},water(){if(this.data.stage<5)this.setData({stage:this.data.stage+1})},reset(){this.setData({stage:0})}})' }, '', '', '<progress id="growth" percent="{{stage*20}}"/><button id="water" bindtap="water">浇一点灵感</button><button id="reset" bindtap="reset">重新种</button>')
    const document = dom.window.document, bar = document.querySelector('#growth')!
    expect(bar.getAttribute('role')).toBe('progressbar'); expect(bar.getAttribute('aria-valuemin')).toBe('0'); expect(bar.getAttribute('aria-valuemax')).toBe('100')
    for (const value of ['0', '20', '40', '60', '80', '100']) {
      expect(bar.getAttribute('aria-valuenow')).toBe(value); expect((bar.firstElementChild!.firstElementChild as HTMLElement).style.width).toBe(`${value}%`); expect(document.querySelector('#growth')).toBe(bar)
      document.querySelector<HTMLButtonElement>('#water')!.click()
    }
    document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(bar.getAttribute('aria-valuenow')).toBe('0'); expect((bar.firstElementChild!.firstElementChild as HTMLElement).style.width).toBe('0%')
  })
  it('native progress defaults render a static six-pixel bar without a percentage label', async () => {
    const dom = await preview({}, '', '', '<progress id="growth" percent="40"/>'), bar = dom.window.document.querySelector('#growth')!
    expect(bar.getAttribute('role')).toBe('progressbar'); expect(bar.textContent).toBe(''); expect(bar.children.length).toBe(1)
    const track = bar.firstElementChild as HTMLElement, fill = track.firstElementChild as HTMLElement
    expect(track.style.height).toBe('6px'); expect(track.style.borderRadius).toBe('0px'); expect(track.style.backgroundColor).toBe('rgb(235, 235, 235)'); expect(fill.style.backgroundColor).toBe('rgb(9, 187, 7)'); expect(fill.style.transition).toBe('')
  })
  it('native progress appearance and optional percentage text follow setData', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{p:40,show:true,color:"pink",background:"lavender",stroke:12,radius:10,font:18},update(){this.setData({p:100,show:false,color:"navy",background:"#eee",stroke:6,radius:3,font:14})}})' }, '', '', '<progress id="growth" percent="{{p}}" show-info="{{show}}" activeColor="{{color}}" backgroundColor="{{background}}" stroke-width="{{stroke}}" border-radius="{{radius}}" font-size="{{font}}"/><button id="update" bindtap="update">更新</button>')
    const document = dom.window.document, bar = document.querySelector('#growth')!, track = bar.firstElementChild as HTMLElement, fill = track?.firstElementChild as HTMLElement
    expect(bar.getAttribute('role')).toBe('progressbar'); expect(bar.textContent).toBe('40%'); expect((bar.lastElementChild as HTMLElement).style.fontSize).toBe('18px'); expect(track.style.height).toBe('12px'); expect(track.style.borderRadius).toBe('10px'); expect(track.style.backgroundColor).toBe('lavender'); expect(fill.style.backgroundColor).toBe('pink')
    document.querySelector<HTMLButtonElement>('#update')!.click(); expect(bar.getAttribute('aria-valuenow')).toBe('100'); expect(bar.textContent).toBe(''); expect(track.style.height).toBe('6px'); expect(track.style.borderRadius).toBe('3px'); expect(track.style.backgroundColor).toBe('rgb(238, 238, 238)'); expect(fill.style.backgroundColor).toBe('navy'); expect(fill.style.width).toBe('100%')
  })
  it('preview progress clamps numeric overflow and treats invalid percentage as zero', async () => {
    const dom = await preview({}, '', '', '<progress id="high" percent="150"/><progress id="low" percent="-20"/><progress id="invalid" percent="oops"/>')
    for (const [id, value] of [['high', '100'], ['low', '0'], ['invalid', '0']]) { const bar = dom.window.document.querySelector(`#${id}`)!; expect(bar.getAttribute('role')).toBe('progressbar'); expect(bar.getAttribute('aria-valuenow')).toBe(value); expect((bar.firstElementChild!.firstElementChild as HTMLElement).style.width).toBe(`${value}%`) }
  })
  it('preview progress string dimensions reuse the existing rpx conversion', async () => {
    const dom = await preview({}, '', '', '<progress id="growth" percent="60" show-info stroke-width="15rpx" border-radius="7.5rpx" font-size="22.5rpx"/>'), bar = dom.window.document.querySelector('#growth')!
    expect(bar.getAttribute('role')).toBe('progressbar'); expect((bar.firstElementChild as HTMLElement).style.height).toBe('2vw'); expect((bar.firstElementChild as HTMLElement).style.borderRadius).toBe('1vw'); expect((bar.lastElementChild as HTMLElement).style.fontSize).toBe('3vw'); expect(bar.textContent).toBe('60%')
  })
  it('native buttons with matching height and line-height do not gain extra vertical padding', async () => {
    const dom = await preview({}, '.native { height:48px; line-height:48px }', '', '<button class="native">换个剧情</button>')
    const style = dom.window.getComputedStyle(dom.window.document.querySelector('button')!)
    expect(style.height).toBe('48px'); expect(style.lineHeight).toBe('48px'); expect(style.paddingTop).toBe('0px'); expect(style.paddingBottom).toBe('0px'); expect(style.boxSizing).toBe('border-box')
  })
  it('explicit native button padding keeps precedence over preview defaults', async () => {
    const dom = await preview({}, '.native { padding:8px 12px; line-height:24px }', '', '<button class="native">明确留白</button>')
    const style = dom.window.getComputedStyle(dom.window.document.querySelector('button')!)
    expect(style.paddingTop).toBe('8px'); expect(style.paddingBottom).toBe('8px'); expect(style.paddingLeft).toBe('12px'); expect(style.lineHeight).toBe('24px')
  })
  it('date picker retains its visible children with a day input and native boundaries', async () => {
    const dom = await preview({}, '', '', '<picker id="day" mode="date" fields="day" start="2000-01-01" end="2099-12-31"><view id="day-label">挑一个日子</view></picker>'), picker = dom.window.document.querySelector('#day')!, input = picker.querySelector<HTMLInputElement>('input')
    expect(input?.type).toBe('date'); expect(input?.min).toBe('2000-01-01'); expect(input?.max).toBe('2099-12-31'); expect(input?.value).toBe(''); expect(input?.getAttribute('aria-label')).toBe('挑一个日子'); expect(picker.querySelector('#day-label')!.textContent).toBe('挑一个日子')
  })
  it('date picker uses day precision when fields is omitted and respects an explicit label', async () => {
    const dom = await preview({}, '', '', '<picker id="day" mode="date" aria-label="选择留住的日子" value="2024-02-29"><view>日期</view></picker>'), input = dom.window.document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); expect(input?.value).toBe('2024-02-29'); expect(input?.getAttribute('aria-label')).toBe('选择留住的日子')
  })
  it.each(['bindchange','bind:change','catchchange','catch:change'])('date picker %s delivers one native date string and typed picker dataset', async binding => {
    const dom = await preview({'pages/home/index.js':'Page({data:{calls:0},choose(e){getApp().globalData.event=e;this.setData({calls:this.data.calls+1})}})'}, '', '', `<picker id="day" mode="date" data-index="{{7}}" data-kind="kept-day" ${binding}="choose"><view>挑一个日子</view></picker><text id="calls">{{calls}}</text>`), input = dom.window.document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); input!.value='2024-02-29'; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.document.querySelector('#calls')!.textContent).toBe('1'); expect(dom.window.eval('getApp().globalData.event.detail.value')).toBe('2024-02-29'); expect(dom.window.eval('typeof getApp().globalData.event.detail.value')).toBe('string'); expect(dom.window.eval('getApp().globalData.event.currentTarget.dataset')).toEqual({index:7,kind:'kept-day'})
  })
  it('date selection updates native bound copy and keeps the same control after setData', async () => {
    const dom = await preview({'pages/home/index.js':'Page({data:{day:"",calls:0},choose(e){this.setData({day:e.detail.value,calls:this.data.calls+1})}})'}, '', '', '<picker id="day" mode="date" value="{{day}}" bindchange="choose"><view id="day-label">{{day || "挑一个日子"}}</view></picker><button id="keep" disabled="{{!day}}">装进小盒</button><text id="calls">{{calls}}</text>'), document=dom.window.document, input=document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); expect(document.querySelector<HTMLButtonElement>('#keep')!.disabled).toBe(true); input!.value='2031-07-09'; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(document.querySelector('#day-label')!.textContent).toBe('2031-07-09'); expect(document.querySelector<HTMLButtonElement>('#keep')!.disabled).toBe(false); expect(document.querySelector('#day input')).toBe(input); expect(input!.value).toBe('2031-07-09'); expect(document.querySelector('#calls')!.textContent).toBe('1')
  })
  it('external date updates restore selection and empty reset restores the placeholder', async () => {
    const dom = await preview({'pages/home/index.js':'Page({data:{day:"2024-02-29"},update(){this.setData({day:"2040-01-02"})},reset(){this.setData({day:""})}})'}, '', '', '<picker id="day" mode="date" value="{{day}}"><view id="day-label">{{day || "挑一个日子"}}</view></picker><button id="update" bindtap="update">换日子</button><button id="reset" bindtap="reset">清空选择</button><button id="keep" disabled="{{!day}}">装进小盒</button>'), document=dom.window.document, input=document.querySelector<HTMLInputElement>('#day input')
    expect(input?.value).toBe('2024-02-29'); document.querySelector<HTMLButtonElement>('#update')!.click(); expect(input!.value).toBe('2040-01-02'); document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(input!.value).toBe(''); expect(document.querySelector('#day-label')!.textContent).toBe('挑一个日子'); expect(document.querySelector<HTMLButtonElement>('#keep')!.disabled).toBe(true)
  })
  it('date picker applies changed native bounds before restoring a new selected value', async () => {
    const dom = await preview({'pages/home/index.js':'Page({data:{day:"2000-01-01",start:"2000-01-01",end:"2099-12-31"},update(){this.setData({day:"2042-05-06",start:"2040-01-01",end:"2050-12-31"})}})'}, '', '', '<picker id="day" mode="date" value="{{day}}" start="{{start}}" end="{{end}}"><view>{{day}}</view></picker><button id="update" bindtap="update">更新</button>'), document=dom.window.document, input=document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); document.querySelector<HTMLButtonElement>('#update')!.click(); expect(input!.min).toBe('2040-01-01'); expect(input!.max).toBe('2050-12-31'); expect(input!.value).toBe('2042-05-06'); expect(input!.validity.valid).toBe(true)
  })
  it('disabled date picker ignores forced changes and re-enables through native setData', async () => {
    const dom = await preview({'pages/home/index.js':'Page({data:{locked:true,calls:0},choose(){this.setData({calls:this.data.calls+1})},unlock(){this.setData({locked:false})}})'}, '', '', '<picker id="day" mode="date" disabled="{{locked}}" bindchange="choose"><view>日子</view></picker><text id="calls">{{calls}}</text><button id="unlock" bindtap="unlock">解锁</button>'), document=dom.window.document, input=document.querySelector<HTMLInputElement>('#day input')
    expect(input?.disabled).toBe(true); input!.value='2030-01-01'; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(document.querySelector('#calls')!.textContent).toBe('0'); document.querySelector<HTMLButtonElement>('#unlock')!.click(); expect(input!.disabled).toBe(false); input!.value='2030-01-01'; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(document.querySelector('#calls')!.textContent).toBe('1')
  })
  it.each(['1999-12-31','2100-01-01','','2023-02-29'])('date picker rejects invalid or unavailable selection %s without changing page state', async value => {
    const dom = await preview({'pages/home/index.js':'Page({data:{calls:0},choose(e){getApp().globalData.date=e.detail.value;this.setData({calls:this.data.calls+1})}})'}, '', '', '<picker id="day" mode="date" start="2000-01-01" end="2099-12-31" bindchange="choose"><view>日子</view></picker><text id="calls">{{calls}}</text>'), input=dom.window.document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); input!.value=value; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.document.querySelector('#calls')!.textContent).toBe('0'); expect(dom.window.eval('getApp().globalData.date')).toBeUndefined()
  })
  it.each(['2000-01-01','2099-12-31'])('date picker accepts the inclusive boundary %s without changing its format', async value => {
    const dom = await preview({'pages/home/index.js':'Page({data:{},choose(e){getApp().globalData.date=e.detail.value}})'}, '', '', '<picker id="day" mode="date" start="2000-01-01" end="2099-12-31" bindchange="choose"><view>日子</view></picker>'), input=dom.window.document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); input!.value=value; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.eval('getApp().globalData.date')).toBe(value)
  })
  it('detached date controls cannot dispatch their handler on the next page', async () => {
    const dom = await preview({'pages/home/index.js':'Page({data:{},choose(){getApp().globalData.old=true},open(){wx.navigateTo({url:"/pages/records/index"})}})','pages/records/index.js':'Page({data:{},choose(){getApp().globalData.new=true}})'}, '', '', '<picker id="day" mode="date" bindchange="choose"><view>日子</view></picker><button id="open" bindtap="open">打开卡</button>'), input=dom.window.document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); dom.window.document.querySelector<HTMLButtonElement>('#open')!.click(); expect(input!.isConnected).toBe(false); input!.value='2030-01-01'; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.eval('getApp().globalData.old')).toBeUndefined(); expect(dom.window.eval('getApp().globalData.new')).toBeUndefined()
  })
  it('date picker catchchange stops an ancestor change handler', async () => {
    const dom = await preview({'pages/home/index.js':'Page({data:{},choose(){getApp().globalData.dateCalls=(getApp().globalData.dateCalls||0)+1},outer(){getApp().globalData.outer=true}})'}, '', '', '<view bindchange="outer"><picker id="day" mode="date" catchchange="choose"><view>日子</view></picker></view>'), input=dom.window.document.querySelector<HTMLInputElement>('#day input')
    expect(input?.type).toBe('date'); input!.value='2030-01-01'; input!.dispatchEvent(new dom.window.Event('change',{bubbles:true})); expect(dom.window.eval('getApp().globalData.dateCalls')).toBe(1); expect(dom.window.eval('getApp().globalData.outer')).toBeUndefined()
  })

  it('selector picker preserves its visual children and dispatches the selected numeric index', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{roles:["小机器人","猫咪","纸飞机"],index:1,calls:0},choose(e){getApp().globalData.valueType=typeof e.detail.value;getApp().globalData.target=e.currentTarget.dataset.category;this.setData({index:e.detail.value,calls:this.data.calls+1})}})' }, '', '', '<picker id="actor" mode="selector" range="{{roles}}" value="{{index}}" data-category="role" aria-label="选角色" bindchange="choose"><view id="actor-label">当前角色：{{roles[index]}}</view></picker><text id="calls">{{calls}}</text>')
    const document = dom.window.document, picker = document.querySelector('#actor')!, select = picker.querySelector<HTMLSelectElement>('select')
    expect(select).not.toBeNull(); expect(select!.getAttribute('aria-label')).toBe('选角色'); expect(Array.from(select!.options, option => option.text)).toEqual(['小机器人', '猫咪', '纸飞机']); expect(select!.value).toBe('1')
    expect(document.querySelector('#actor-label')!.textContent).toBe('当前角色：猫咪')
    select!.value = '2'; select!.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(document.querySelector('#actor-label')!.textContent).toBe('当前角色：纸飞机'); expect(document.querySelector('#calls')!.textContent).toBe('1'); expect(dom.window.eval('getApp().globalData.valueType')).toBe('number'); expect(dom.window.eval('getApp().globalData.target')).toBe('role'); expect(picker.querySelector('select')).toBe(select)
  })
  it('selector picker defaults to index zero and renders range-key object labels as text', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{roles:[{title:"机器人"},{title:"猫<咪>"}]}})' }, '', '', '<picker id="actor" range="{{roles}}" range-key="title"><view>角色</view></picker>')
    const select = dom.window.document.querySelector<HTMLSelectElement>('#actor select')
    expect(select).not.toBeNull(); expect(Array.from(select!.options, option => option.text)).toEqual(['机器人', '猫<咪>']); expect(select!.value).toBe('0'); expect(select!.options[1].children).toHaveLength(0); expect(select!.getAttribute('aria-label')).toBe('角色')
  })
  it('selector picker applies a new range before restoring an externally changed selection', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{roles:["旧角色","猫咪","纸飞机"],index:2},update(){this.setData({roles:["新角色","月亮"],index:1})},reset(){this.setData({roles:["小机器人","猫咪","纸飞机"],index:0})}})' }, '', '', '<picker id="actor" range="{{roles}}" value="{{index}}"><view>{{roles[index]}}</view></picker><button id="update" bindtap="update">更换</button><button id="reset" bindtap="reset">恢复</button>')
    const document = dom.window.document, select = document.querySelector<HTMLSelectElement>('#actor select')
    expect(select).not.toBeNull(); expect(select!.value).toBe('2')
    document.querySelector<HTMLButtonElement>('#update')!.click(); expect(Array.from(select!.options, option => option.text)).toEqual(['新角色', '月亮']); expect(select!.value).toBe('1'); expect(document.querySelector('#actor select')).toBe(select)
    document.querySelector<HTMLButtonElement>('#reset')!.click(); expect(Array.from(select!.options, option => option.text)).toEqual(['小机器人', '猫咪', '纸飞机']); expect(select!.value).toBe('0')
  })
  it('disabled selector picker ignores forced changes and re-enables after native setData', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{roles:["机器人","猫咪"],index:0,locked:true,calls:0},choose(e){this.setData({index:e.detail.value,calls:this.data.calls+1})},unlock(){this.setData({locked:false,index:0})}})' }, '', '', '<picker id="actor" range="{{roles}}" value="{{index}}" disabled="{{locked}}" bind:change="choose"><view>{{roles[index]}}</view></picker><text id="calls">{{calls}}</text><button id="unlock" bindtap="unlock">解锁</button>')
    const document = dom.window.document, select = document.querySelector<HTMLSelectElement>('#actor select')
    expect(select).not.toBeNull(); expect(select!.disabled).toBe(true)
    select!.value = '1'; select!.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(document.querySelector('#calls')!.textContent).toBe('0')
    document.querySelector<HTMLButtonElement>('#unlock')!.click(); expect(select!.disabled).toBe(false); expect(select!.value).toBe('0')
    select!.value = '1'; select!.dispatchEvent(new dom.window.Event('change', { bubbles: true })); expect(document.querySelector('#calls')!.textContent).toBe('1')
  })
  it('renders native slider limits, live value and numeric changing versus committed events', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{bpm:90,calls:0,drag:0},changing(e){this.setData({bpm:e.detail.value,drag:this.data.drag+1});getApp().globalData.valueType=typeof e.detail.value},change(e){this.setData({bpm:e.detail.value,calls:this.data.calls+1})}})' }, '', '', '<slider id="tempo" min="60" max="120" step="10" value="{{bpm}}" bindchanging="changing" bindchange="change"/><text id="tempo-value">{{bpm}} / {{drag}} / {{calls}}</text>')
    const input = dom.window.document.querySelector<HTMLInputElement>('#tempo')!
    expect(input.tagName).toBe('INPUT'); expect(input.type).toBe('range'); expect(input.min).toBe('60'); expect(input.max).toBe('120'); expect(input.step).toBe('10'); expect(input.value).toBe('90')
    input.value = '110'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(dom.window.document.querySelector('#tempo-value')!.textContent).toBe('110 / 1 / 0'); expect(dom.window.eval('getApp().globalData.valueType')).toBe('number')
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(dom.window.document.querySelector('#tempo-value')!.textContent).toBe('110 / 1 / 1')
    expect(dom.window.document.querySelector('#tempo')).toBe(input)
  })
  it.each(['switch', 'checkbox'])('renders native %s checked state and boolean change values', async type => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{accent:true,calls:0},change(e){this.setData({accent:e.detail.value,calls:this.data.calls+1});getApp().globalData.valueType=typeof e.detail.value}})' }, '', '', `<switch id="accent" type="${type}" checked="{{accent}}" bindchange="change"/><text id="accent-value">{{accent}} / {{calls}}</text>`)
    const input = dom.window.document.querySelector<HTMLInputElement>('#accent')!
    expect(input.type).toBe('checkbox'); expect(input.checked).toBe(true); expect(input.getAttribute('role')).toBe(type)
    input.click()
    expect(input.checked).toBe(false); expect(dom.window.document.querySelector('#accent-value')!.textContent).toBe('false / 1'); expect(dom.window.eval('getApp().globalData.valueType')).toBe('boolean')
    input.click()
    expect(input.checked).toBe(true); expect(dom.window.document.querySelector('#accent-value')!.textContent).toBe('true / 2'); expect(dom.window.document.querySelector('#accent')).toBe(input)
  })
  it('synchronizes checked, slider value and disabled properties after native setData', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{accent:true,bpm:90,disabled:false},update(){this.setData({accent:false,bpm:120,disabled:true})},restore(){this.setData({accent:true,bpm:60,disabled:false})}})' }, '', '', '<switch id="accent" checked="{{accent}}" disabled="{{disabled}}"/><slider id="tempo" min="60" max="120" value="{{bpm}}" disabled="{{disabled}}"/><button id="update" bindtap="update">锁定</button><button id="restore" bindtap="restore">恢复</button>')
    const document = dom.window.document, accent = document.querySelector<HTMLInputElement>('#accent')!, tempo = document.querySelector<HTMLInputElement>('#tempo')!
    accent.click(); expect(accent.checked).toBe(false)
    document.querySelector<HTMLButtonElement>('#update')!.click()
    expect(accent.checked).toBe(false); expect(accent.disabled).toBe(true); expect(tempo.value).toBe('120'); expect(tempo.disabled).toBe(true)
    document.querySelector<HTMLButtonElement>('#restore')!.click()
    expect(accent.checked).toBe(true); expect(accent.disabled).toBe(false); expect(tempo.value).toBe('60'); expect(tempo.disabled).toBe(false)
  })
  it('disabled native parameter controls cannot emit changes or alter page state', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{bpm:90,accent:true,calls:0},tempo(e){this.setData({bpm:e.detail.value,calls:this.data.calls+1})},accent(e){this.setData({accent:e.detail.value,calls:this.data.calls+1})}})' }, '', '', '<slider id="tempo" value="{{bpm}}" disabled="{{true}}" bindchanging="tempo" bindchange="tempo"/><switch id="accent" checked="{{accent}}" disabled="{{true}}" bindchange="accent"/><text id="calls">{{bpm}} / {{accent}} / {{calls}}</text>')
    const tempo = dom.window.document.querySelector<HTMLInputElement>('#tempo')!, accent = dom.window.document.querySelector<HTMLInputElement>('#accent')!
    expect(tempo.disabled).toBe(true); expect(accent.disabled).toBe(true)
    tempo.value = '100'; tempo.dispatchEvent(new dom.window.Event('input', { bubbles: true })); tempo.dispatchEvent(new dom.window.Event('change', { bubbles: true })); accent.click(); accent.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(dom.window.document.querySelector('#calls')!.textContent).toBe('90 / true / 0')
  })
  it('bare and interpolated false Boolean attributes have distinct native meanings', async () => {
    const dom = await preview({}, '', '', '<switch id="bare" checked/><switch id="unchecked" checked="{{false}}" disabled="{{false}}"/><slider id="enabled" disabled="{{false}}"/>')
    expect(dom.window.document.querySelector<HTMLInputElement>('#bare')!.checked).toBe(true)
    expect(dom.window.document.querySelector<HTMLInputElement>('#unchecked')!.checked).toBe(false); expect(dom.window.document.querySelector<HTMLInputElement>('#unchecked')!.disabled).toBe(false); expect(dom.window.document.querySelector<HTMLInputElement>('#enabled')!.disabled).toBe(false)
  })
  it('hides an existing toast immediately and completes native callbacks once', async () => {
    const dom = await preview()
    dom.window.eval('wx.showToast({title:"先写一句吧"}); getApp().globalData.toastCalls=[]; wx.hideToast({success(res){getApp().globalData.toastCalls.push(res.errMsg)},complete(res){getApp().globalData.toastCalls.push(res.errMsg)}})')
    expect(dom.window.document.querySelector('#toast')).toBeNull()
    expect(dom.window.eval('getApp().globalData.toastCalls')).toEqual(['hideToast:ok','hideToast:ok'])
    dom.window.eval('wx.hideToast()')
    expect(dom.window.document.querySelector('#toast')).toBeNull()
  })
  it('expires toast prompts at their requested duration and the fifteen hundred millisecond default', async () => {
    vi.useFakeTimers()
    const dom = await preview()
    dom.window.eval('wx.showToast({title:"短提示",duration:120})')
    vi.advanceTimersByTime(119)
    expect(dom.window.document.querySelector('#toast')?.textContent).toBe('短提示')
    vi.advanceTimersByTime(1)
    expect(dom.window.document.querySelector('#toast')).toBeNull()
    dom.window.eval('wx.showToast({title:"默认提示"})')
    vi.advanceTimersByTime(1499)
    expect(dom.window.document.querySelector('#toast')?.textContent).toBe('默认提示')
    vi.advanceTimersByTime(1)
    expect(dom.window.document.querySelector('#toast')).toBeNull()
  })
  it('a removed old toast cannot remove its replacement when the old duration expires', async () => {
    vi.useFakeTimers()
    const dom = await preview()
    dom.window.eval('wx.showToast({title:"旧提示",duration:100})')
    vi.advanceTimersByTime(20)
    dom.window.eval('wx.hideToast(); wx.showToast({title:"新提示",duration:200})')
    vi.advanceTimersByTime(80)
    expect(dom.window.document.querySelector('#toast')?.textContent).toBe('新提示')
    vi.advanceTimersByTime(119)
    expect(dom.window.document.querySelector('#toast')?.textContent).toBe('新提示')
    vi.advanceTimersByTime(1)
    expect(dom.window.document.querySelector('#toast')).toBeNull()
  })
  it('renders controls after a self-closing WXML textarea and updates their bindings', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{content:"",count:0},input(e){this.setData({content:e.detail.value,count:Array.from(e.detail.value).length})},send(){this.setData({content:"收到",count:2})}})' }, '', '', '<view><textarea id="note" value="{{content}}" bindinput="input" /><text id="count">{{count}}/20</text><button bindtap="send">送走</button></view>')
    const document = dom.window.document
    expect(document.querySelectorAll('button')).toHaveLength(1)
    expect(document.querySelector('#count')!.textContent).toBe('0/20')
    const input = document.querySelector<HTMLTextAreaElement>('#note')!
    expect(input.value).toBe(''); input.value = '🙂字'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(document.querySelector('#count')!.textContent).toBe('2/20')
    document.querySelector<HTMLButtonElement>('button')!.click()
    expect(document.querySelector<HTMLTextAreaElement>('#note')!.value).toBe('收到')
  })
  it('keeps greater-than and self-closing text inside quoted WXML attributes intact', async () => {
    const dom = await preview({}, '', '', '<view><textarea id="note" placeholder="输入 >/> 内容" data-note=\'a /> b > c\' /><view id="marker" wx:if="{{value > 0}}" data-value="x/>y" /><button id="tail">后面</button></view>')
    const document = dom.window.document
    expect(document.querySelector<HTMLTextAreaElement>('#note')!.placeholder).toBe('输入 >/> 内容')
    expect(document.querySelector('#note')!.getAttribute('data-note')).toBe('a /> b > c')
    expect(document.querySelector('#marker')!.getAttribute('data-value')).toBe('x/>y')
    expect(document.querySelector('#tail')!.textContent).toBe('后面')
    expect(document.querySelector('#tail')!.parentElement).toBe(document.querySelector('#marker')!.parentElement)
  })
  it('keeps a self-closing WXML view separate from its following sibling', async () => {
    const dom = await preview({}, '', '', '<view id="first"/><view id="second">{{value}}</view>')
    const document = dom.window.document
    expect(document.querySelector('#first')!.textContent).toBe('')
    expect(document.querySelector('#second')!.textContent).toBe('3')
    expect(document.querySelector('#first')!.parentElement).toBe(document.querySelector('#second')!.parentElement)
  })
  it('scales WXSS rpx with the preview viewport instead of a fixed phone width', async () => {
    const dom = await preview({}, '#value { width: 375rpx; padding: 15rpx; margin-left: -7.5rpx; font-size: 16px }')
    const rule = dom.window.document.styleSheets[1].cssRules[0] as CSSStyleRule
    expect(rule.style.getPropertyValue('width')).toBe('50vw')
    expect(rule.style.getPropertyValue('padding')).toBe('2vw')
    expect(rule.style.getPropertyValue('margin-left')).toBe('-1vw')
    expect(rule.style.getPropertyValue('font-size')).toBe('16px')
  })
  it('scales interpolated inline rpx styles using the same viewport', async () => {
    const dom = await preview({}, '', 'width: {{value * 125}}rpx; padding: 15rpx')
    expect(dom.window.document.querySelector<HTMLElement>('#value')!.style.width).toBe('50vw')
    expect(dom.window.document.querySelector<HTMLElement>('#value')!.style.padding).toBe('2vw')
  })
  it('loads a shared CommonJS module and invokes the initial onShow', async () => {
    const dom = await preview()
    expect(dom.window.document.querySelector('#value')?.textContent).toBe('3')
    expect(dom.window.eval('getApp().globalData.moduleLoads')).toBe(1)
  })
  it('pushes a page with query data and returns to the previous live instance', async () => {
    const dom = await preview()
    dom.window.document.querySelector<HTMLButtonElement>('button')!.click()
    expect(dom.window.document.querySelector('#records')?.textContent).toBe('3 / 2 / home')
    dom.window.document.querySelector<HTMLButtonElement>('button')!.click()
    dom.window.document.querySelectorAll<HTMLButtonElement>('button')[1].click()
    expect(dom.window.document.querySelector('#value')?.textContent).toBe('4')
    expect(dom.window.eval('getCurrentPages().length')).toBe(1)
    expect(dom.window.eval('getApp().globalData.moduleLoads')).toBe(1)
  })
  it('updates a nested array field through native setData path syntax', async () => {
    const dom = await preview()
    dom.window.document.querySelectorAll<HTMLButtonElement>('button')[1].click()
    expect(dom.window.document.querySelector('#item')?.textContent).toBe('new')
  })
  it('rejects a module path that escapes the preview project', async () => {
    const dom = await preview({ 'pages/home/index.js': 'require("../../../outside.js")' })
    expect(dom.window.document.querySelector('#app')?.textContent).toContain('PREVIEW_MODULE_PATH_OUTSIDE_PROJECT')
  })
  it('returns an independent copy from getStorageSync', async () => {
    const dom = await preview()
    dom.window.eval('wx.setStorageSync("items",["saved"]); const values=wx.getStorageSync("items"); values.push("unsaved")')
    expect(dom.window.eval('wx.getStorageSync("items")')).toEqual(['saved'])
  })
  it('scrolls to the start after a native page action and acknowledges completion', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:0},open(){this.setData({value:1});wx.pageScrollTo({scrollTop:0,duration:0,success(res){getApp().globalData.scrollResult=res.errMsg},complete(){getApp().globalData.scrollComplete=true}})}})' })
    dom.window.scrollTo = vi.fn()
    dom.window.document.querySelector<HTMLButtonElement>('button')!.click()
    expect(dom.window.document.querySelector('#value')?.textContent).toBe('1')
    expect(dom.window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    expect(dom.window.eval('getApp().globalData.scrollResult')).toBe('pageScrollTo:ok')
    expect(dom.window.eval('getApp().globalData.scrollComplete')).toBe(true)
  })
  it('reports invalid page scrolling without silently claiming success', async () => {
    const dom = await preview(); dom.window.scrollTo = vi.fn()
    dom.window.eval('wx.pageScrollTo({scrollTop:NaN,success(){getApp().globalData.scrolled=true},fail(res){getApp().globalData.scrollFailure=res.errMsg},complete(res){getApp().globalData.scrollComplete=res.errMsg}})')
    expect(dom.window.scrollTo).not.toHaveBeenCalled()
    expect(dom.window.eval('getApp().globalData.scrolled')).toBeUndefined()
    expect(dom.window.eval('getApp().globalData.scrollFailure')).toMatch(/^pageScrollTo:fail/)
    expect(dom.window.eval('getApp().globalData.scrollComplete')).toBe(dom.window.eval('getApp().globalData.scrollFailure'))
  })
  it('waits for modal cancellation before returning a native cancel result', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:"original"},open(){wx.showModal({title:"重开故事",content:"清空这一局",cancelText:"再想想",confirmText:"重新开始",success:res=>this.setData({value:res.confirm?"reset":"original"}),complete:res=>{getApp().globalData.modalResult=res}})}})' })
    dom.window.document.querySelector<HTMLButtonElement>('button')!.click()
    expect(dom.window.document.querySelector('#value')?.textContent).toBe('original')
    expect(dom.window.eval('getApp().globalData.modalResult')).toBeUndefined()
    const dialog = dom.window.document.querySelector<HTMLDialogElement>('dialog')!
    expect(dialog.open).toBe(true); expect(dialog.textContent).toContain('清空这一局')
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === '再想想')!.click()
    expect(dom.window.document.querySelector('#value')?.textContent).toBe('original')
    expect(dom.window.eval('getApp().globalData.modalResult')).toEqual({ errMsg: 'showModal:ok', confirm: false, cancel: true })
    expect(dom.window.document.querySelector('dialog')).toBeNull()
  })
  it('returns modal confirmation once and applies the requested reset', async () => {
    const dom = await preview({ 'pages/home/index.js': 'Page({data:{value:4},open(){wx.showModal({title:"重开故事",content:"清空这一局",confirmText:"重新开始",success:res=>{if(res.confirm)this.setData({value:0});getApp().globalData.modalCalls=(getApp().globalData.modalCalls||0)+1},complete:res=>{getApp().globalData.modalResult=res}})}})' })
    dom.window.document.querySelector<HTMLButtonElement>('button')!.click()
    const button = Array.from(dom.window.document.querySelectorAll('dialog button')).find(button => button.textContent === '重新开始') as HTMLButtonElement
    button.click(); button.click()
    expect(dom.window.document.querySelector('#value')?.textContent).toBe('0')
    expect(dom.window.eval('getApp().globalData.modalCalls')).toBe(1)
    expect(dom.window.eval('getApp().globalData.modalResult')).toEqual({ errMsg: 'showModal:ok', confirm: true, cancel: false })
    expect(dom.window.document.querySelector('dialog')).toBeNull()
  })
})

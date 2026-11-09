import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, ref, h } from 'vue'
import { pageId, pageUrl, readPageLocation } from '../src/page-history.ts'
import { usePageHistory } from '../src/usePageHistory.ts'

test('page locations round trip without losing escaped names and reject invalid IDs', () => {
  const location = { project: '12', section: 'tasks', task: '42', editorTab: 'steps' }
  assert.deepEqual(readPageLocation(pageUrl(location).slice(1)), location)
  for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) assert.equal(pageId(value), undefined)
  assert.equal(pageId('42'), 42)
  assert.equal(pageUrl({}), '/')
})

test('history supports nested navigation, back/forward, deep links, busy requests and cancelled departure', async () => {
  const original = globalThis.window
  const entries = ['/?project=7&section=tasks&task=42']
  let index = 0
  const listeners = new Set<() => void>()
  const location = { pathname: '/', search: entries[0]!.slice(1) }
  const update = () => { location.search = entries[index]!.includes('?') ? entries[index]!.slice(entries[index]!.indexOf('?')) : '' }
  globalThis.window = { location, history: { pushState: (_: unknown, __: string, url: string) => {
    entries.splice(++index); entries.push(url); update()
  } }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) } as never
  const move = (delta: number) => { index += delta; update(); listeners.forEach(listener => listener()) }
  const project = ref(''), task = ref(''), busy = ref(false), allow = ref(true)
  const settle = () => new Promise(resolve => setTimeout(resolve, 45))
  const Child = defineComponent({ setup() {
    usePageHistory({ capture: () => task.value ? { task: task.value } : {}, busy: () => false,
      allow: () => allow.value, restore: async target => { task.value = target.task || '' } })
    return () => null
  } })
  const Root = defineComponent({ setup() {
    usePageHistory({ capture: () => project.value ? { project: project.value, section: 'tasks' } : {}, busy: () => busy.value,
      restore: async target => { project.value = target.project || '' } }, true)
    return () => project.value ? h(Child) : null
  } })
  const renderer = createRenderer({ insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
  const app = renderer.createApp(Root)
  try {
    app.mount({}); await settle()
    assert.equal(project.value, '7'); assert.equal(task.value, '42'); assert.equal(entries.length, 1)
    task.value = '43'; await settle(); assert.match(location.search, /task=43/)
    assert.equal(entries.length, 2)
    move(-1); await settle(); assert.equal(task.value, '42'); assert.equal(entries.length, 2)
    move(1); await settle(); assert.equal(task.value, '43')
    busy.value = true; task.value = '44'; await settle(); assert.equal(entries.length, 2)
    busy.value = false; await settle(); assert.match(location.search, /task=44/)
    busy.value = true; move(-1); await settle(); assert.equal(task.value, '44')
    busy.value = false; await settle(); assert.equal(task.value, '43')
    move(1); await settle(); assert.equal(task.value, '44')
    allow.value = false; move(-1); await settle(); assert.equal(task.value, '44'); assert.match(location.search, /task=44/)
    allow.value = true; project.value = ''; await settle(); assert.equal(location.search, '')
    move(-1); await settle(); assert.equal(project.value, '7'); assert.equal(task.value, '44')
  } finally { app.unmount(); globalThis.window = original }
})

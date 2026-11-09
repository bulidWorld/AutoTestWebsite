import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTask, controlDraft, expressionReferences, field, key, parameterDraft, stepDraft, type Draft, type StepDraft, type TaskModel } from '../src/task-editor.ts'
import { buildParameterPreview } from '../src/parameter-preview.ts'
import { buildStepTest } from '../src/step-test.ts'
import type { Model } from '../src/api.ts'

function fixture(): Draft {
  const compute = controlDraft('compute'); compute.position = 1
  compute.options!.expressions = [{ name: 'order_key', expression: 'concat("order-", str(param("id")))' }]
  const sql = controlDraft('sql'); sql.position = 2
  sql.options!.sql = { driver: 'postgresql', datasource: 'dbname=test', statement: 'INSERT INTO orders (id, name, alias) VALUES (%s, %s, %s)', parameters: ['id', 'order_key', 'order_key'] }
  const rest: StepDraft = { key: key(), step_type: 'rest', position: 3, interface_id: 9, file_id: 3, version: 1, file_name: 'orders', method: 'GET', path: '/orders', has_new_version: false, fields: [], definition: { parameters: [] } as unknown as Model<'InterfaceDetail'>, options: { poll: { max_attempts: 10, interval_milliseconds: 1000, timeout_seconds: 60 } } }
  return { name: 'capabilities', description: '', base_url: 'http://localhost', timeout_seconds: 30, steps: [compute, sql, rest], parameters: [
    { key: key(), name: 'id', value_type: 'integer', source_type: 'fixed', sensitive: false, text: '12' },
    { key: key(), name: 'order_key', value_type: 'string', source_type: 'expression', step_key: compute.key, sensitive: false, text: 'cached value must not be saved' },
  ] }
}

test('compute → SQL → polling REST serializes new source indexes and round trips stable IDs without evaluating', () => {
  const d = fixture(), result = buildTask(d)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.body.global_parameters[1], { name: 'order_key', value_type: 'string', source_type: 'expression', sensitive: false, expression_source: { step_index: 0 } })
  assert.deepEqual(result.body.steps[1]!.options!.sql!.parameters, ['id', 'order_key', 'order_key'])
  assert.equal(result.body.steps[1]!.options!.sql!.statement, d.steps[1]!.options!.sql!.statement)
  assert.deepEqual(result.body.steps[2]!.options!.poll, d.steps[2]!.options!.poll)
  const saved = { ...result.body.steps[0], id: 15, parent_step_id: null } as TaskModel<'Step'>
  const loaded = stepDraft(saved)
  assert.equal(loaded.step_type, 'compute')
  assert.deepEqual(loaded.options, saved.options)
  d.steps[0] = loaded
  d.parameters[1] = parameterDraft({ name: 'order_key', source_type: 'expression', expression_source: { step_id: 15 }, sensitive: false, value_type: 'string', position: 2, redacted: false } as TaskModel<'GlobalParameter'>, d.steps)
  assert.equal(d.parameters[1]!.step_key, loaded.key)
  const roundtrip = buildTask(d)
  assert.deepEqual(roundtrip.issues, [])
  const p = roundtrip.body.global_parameters[1]!
  assert.equal(p.source_type, 'expression')
  if (p.source_type === 'expression') assert.deepEqual(p.expression_source, { step_id: 15 })
  assert(!Object.hasOwn(p, 'value'))
})

test('expression dependencies reject self, missing names, later nodes and same parallel siblings; quoted text is ignored', () => {
  const d = fixture(), compute = d.steps[0]!
  assert.deepEqual(expressionReferences('concat("param(\'fake\')", str(param("id")), param(\'order_key\'))'), ['id', 'order_key'])
  compute.options!.expressions![0]!.expression = 'param("order_key")'
  assert(buildTask(d).issues.some(i => i.location.endsWith('.expression')))
  compute.options!.expressions![0]!.expression = 'param("missing")'
  assert(buildTask(d).issues.some(i => i.reason.includes('不存在')))
  compute.options!.expressions![0]!.expression = 'str(param("id"))'
  compute.position = 4
  assert(buildTask(d).issues.some(i => i.location.includes('sql.parameters')))
  const group = controlDraft('parallel'); group.position = 1; compute.position = 1
  compute.parent_key = group.key; d.steps[1]!.parent_key = group.key
  d.steps.push(group)
  assert(buildTask(d).issues.some(i => i.location.includes('sql.parameters')))
  const wait = controlDraft('wait'); wait.parent_key = group.key; wait.position = 2; d.steps.push(wait)
  d.steps[1]!.parent_key = undefined; d.steps[1]!.position = 2
  assert.deepEqual(buildTask(d).issues, [])
})

test('compute requires matching declarations, nonempty expressions and valid timezone', () => {
  const d = fixture(), compute = d.steps[0]!
  compute.options!.expressions = []
  assert(buildTask(d).issues.some(i => i.location.includes('expressions')))
  compute.options!.expressions = [{ name: 'unknown', expression: '' }]
  compute.options!.timezone = 'Unknown/Zone'
  const issues = buildTask(d).issues
  for (const suffix of ['.name', '.expression', '.timezone']) assert(issues.some(i => i.location.endsWith(suffix)))
  d.parameters[1]!.step_key = d.steps[2]!.key
  assert(buildTask(d).issues.some(i => i.location.endsWith('expression_source')))
})

test('SQL rejects missing, object and excessive bindings and accepts SQLite positional order', () => {
  const d = fixture(), sql = d.steps[1]!.options!.sql!
  sql.parameters = ['unknown']
  assert(buildTask(d).issues.some(i => i.location.endsWith('parameters[0]')))
  d.parameters[0]!.value_type = 'object'; d.parameters[0]!.text = '{}'; sql.parameters = ['id']
  assert(buildTask(d).issues.some(i => i.reason.includes('标量')))
  sql.parameters = Array(101).fill('order_key')
  assert(buildTask(d).issues.some(i => i.location.endsWith('sql.parameters')))
  d.parameters[0]!.value_type = 'integer'; d.parameters[0]!.text = '12'
  sql.driver = 'sqlite'; sql.statement = 'INSERT INTO orders VALUES (?, ?)'; sql.parameters = ['order_key', 'id']
  assert.deepEqual(buildTask(d).issues, [])
  assert.deepEqual(buildTask(d).body.steps[1]!.options!.sql!.parameters, ['order_key', 'id'])
})

test('poll supports omitted defaults, validates all bounds, and is removed when disabled', () => {
  const d = fixture(), rest = d.steps[2]!
  rest.options!.poll = {}
  assert.deepEqual(buildTask(d).issues, [])
  for (const [name, max] of [['max_attempts', 1000], ['interval_milliseconds', 3600000], ['timeout_seconds', 86400]] as const) {
    for (const invalid of [0, max + 1, 1.5, NaN]) {
      rest.options!.poll = { [name]: invalid }
      assert(buildTask(d).issues.some(i => i.location.endsWith('.poll.' + name)))
    }
    rest.options!.poll = { [name]: max }
    assert.deepEqual(buildTask(d).issues, [])
  }
  delete rest.options!.poll
  assert(!Object.hasOwn(buildTask(d).body.steps[2]!.options!, 'poll'))
  d.steps[0]!.options!.poll = {}
  assert(buildTask(d).issues.some(i => i.reason.includes('REST')))
})

test('REST flow preview preserves compute, function, ordered SQL bindings and polling without treating dynamic values as hidden literals', () => {
  const d = fixture(), rest = d.steps[2]!
  d.steps.forEach((s,i) => s.id = i+1)
  d.parameters.push({ key: key(), name: 'uuid', source_type: 'function', value_type: 'string', text: '', sensitive: false })
  d.parameters.push({ key: key(), name: 'result', source_type: 'rest', step_key: rest.key, extract_expression: 'data.id', value_type: 'integer', text: '', sensitive: false })
  const preview = buildParameterPreview(d, 'result')
  assert.equal(preview.steps[0]!.step_type, 'compute')
  assert.deepEqual(preview.steps[1]!.options!.sql!.parameters, ['id', 'order_key', 'order_key'])
  assert.equal(preview.steps[2]!.options!.poll!.max_attempts, 10)
  const fn = preview.global_parameters.find(p => p.name === 'uuid')!
  assert.equal(fn.source_type, 'function')
  assert.equal('value' in fn && fn.value, 'generateUUID()')
  const f = field('query', 'key'); f.enabled = true; f.kind = 'global'; f.parameter_name = 'order_key'; rest.fields.push(f)
  assert.throws(() => buildStepTest(d, rest, new Map()), /保存并运行/)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { appendCollectionTasks, buildCollection, toggleCollectionTask } from '../src/task-collection.ts'

test('任务按勾选先后分配独立执行批次，重新勾选排在末尾', () => {
  let ids: number[] = []
  for (const id of [12, 3, 8, 3, 3]) ids = toggleCollectionTask(ids, id)
  assert.deepEqual(buildCollection(' 测试组 ', '', ids), {
    name: '测试组', description: '', members: [
      { task_id: 12, position: 1 }, { task_id: 8, position: 2 }, { task_id: 3, position: 3 },
    ],
  })
})

test('移除任务后批次连续，允许 API 支持的空组草稿', () => {
  assert.deepEqual(buildCollection('空组', '', []).members, [])
  assert.deepEqual(buildCollection('测试', '', toggleCollectionTask([8, 4, 9], 4)).members, [
    { task_id: 8, position: 1 }, { task_id: 9, position: 2 },
  ])
})

test('拒绝空白名称、超长字段和重复任务', () => {
  assert.throws(() => buildCollection('  ', '', []))
  assert.throws(() => buildCollection('a'.repeat(121), '', []))
  assert.throws(() => buildCollection('测试', 'a'.repeat(2001), []))
  assert.throws(() => buildCollection('测试', '', [1, 1]))
})

test('显式批次允许同批并发与非连续排序，完整保存保留批次原值', async () => {
 const {buildCollectionMembers}=await import('../src/task-collection.ts')
 assert.deepEqual(buildCollectionMembers(' 并发组 ','',[{task_id:3,position:10},{task_id:7,position:10},{task_id:2,position:50}]).members,[{task_id:3,position:10},{task_id:7,position:10},{task_id:2,position:50}])
 for(const position of [0,-1,1.5,2147483648]) assert.throws(()=>buildCollectionMembers('组','',[{task_id:1,position}]))
 assert.throws(()=>buildCollectionMembers('组','',[{task_id:1,position:1},{task_id:1,position:2}]))
})


test('加入已有任务组保留名称、描述及并发批次，跳过重复任务并按选择顺序追加', () => {
  const original = { name: '回归组', description: '保留说明', members: [
    { task_id: 8, position: 10 }, { task_id: 4, position: 10 }, { task_id: 9, position: 50 },
  ] }
  const snapshot = structuredClone(original)
  assert.deepEqual(appendCollectionTasks(original, [4, 12, 3, 12, 8]), {
    name: '回归组', description: '保留说明', members: [
      ...original.members, { task_id: 12, position: 51 }, { task_id: 3, position: 52 },
    ],
  })
  assert.deepEqual(original, snapshot)
})

test('加入空任务组从第一批次开始，全为已有成员时保持批次', () => {
  assert.deepEqual(appendCollectionTasks({ name: '空组', members: [] }, [5, 2]).members, [
    { task_id: 5, position: 1 }, { task_id: 2, position: 2 },
  ])
  const original = { name: '组', description: '', members: [{ task_id: 5, position: 8 }] }
  assert.deepEqual(appendCollectionTasks(original, [5]), original)
})

test('追加批次溢出时拒绝保存，重复任务无需新增批次', () => {
  const original = { name: '组', members: [{ task_id: 5, position: 2147483647 }] }
  assert.throws(() => appendCollectionTasks(original, [2]), /正 int32/)
  assert.deepEqual(appendCollectionTasks(original, [5]).members, original.members)
})

test('加入已有任务组时保留组运行地址和全局数据源', () => {
  const original = { name: '组', members: [{ task_id: 5, position: 1 }], base_url: 'https://example.com/api', datasource: { driver: 'postgresql' as const, datasource: 'host=db dbname=test', username: 'runner', password: 'secret' } }
  const result = appendCollectionTasks(original, [6])
  assert.equal(result.base_url, original.base_url)
  assert.deepEqual(result.datasource, original.datasource)
  assert.notEqual(result.datasource, original.datasource)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteSelectedTasks } from '../src/task-bulk.ts'

test('batch deletion records partial failures and continues with remaining tasks', async () => {
  const tasks = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
  const calls: number[] = []
  const result = await deleteSelectedTasks(tasks, async id => {
    calls.push(id)
    if (id === 2) throw new Error('任务正在运行')
  })
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(result.deleted.map(t => t.id), [1, 3])
  assert.deepEqual(result.failed, [{ task: tasks[1], reason: '任务正在运行' }])
  const retried: number[] = []
  await deleteSelectedTasks(result.failed.map(f => f.task), async id => { retried.push(id) })
  assert.deepEqual(retried, [2])
})

test('empty batch sends no requests and successful batch returns all deleted tasks', async () => {
  assert.deepEqual(await deleteSelectedTasks([], async () => { assert.fail('unexpected deletion') }), { deleted: [], failed: [] })
  const tasks = [{ id: 1, name: 'A' }]
  assert.deepEqual(await deleteSelectedTasks(tasks, async () => {}), { deleted: tasks, failed: [] })
})

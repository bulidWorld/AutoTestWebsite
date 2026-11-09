import type { components } from './task-collection-api-schema'

export function toggleCollectionTask(selected: readonly number[], taskId: number): number[] {
  return selected.includes(taskId) ? selected.filter(id => id !== taskId) : [...selected, taskId]
}

export function buildCollection(name: string, description: string, selected: readonly number[]): components['schemas']['CollectionInput'] {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 120) throw new Error('任务组名称不能为空，且不能超过 120 个字符。')
  if (description.length > 2000) throw new Error('任务组描述不能超过 2000 个字符。')
  if (new Set(selected).size !== selected.length) throw new Error('任务组中不能重复添加同一任务。')
  return { name: trimmed, description, members: selected.map((task_id, index) => ({ task_id, position: index + 1 })) }
}

export function buildCollectionMembers(name: string, description: string, members: readonly components['schemas']['Member'][]): components['schemas']['CollectionInput'] {
  const body = buildCollection(name, description, members.map(m => m.task_id))
  if (members.some(m => !Number.isInteger(m.task_id) || m.task_id < 1 || m.task_id > 2147483647 || !Number.isInteger(m.position) || m.position < 1 || m.position > 2147483647)) throw new Error('成员任务 ID 和批次必须为正 int32。')
  return { ...body, members: members.map(m => ({ ...m })) }
}

export function appendCollectionTasks(
  collection: components['schemas']['CollectionInput'],
  taskIds: readonly number[],
): components['schemas']['CollectionInput'] {
  const members = collection.members.map(member => ({ ...member }))
  const included = new Set(members.map(member => member.task_id))
  let position = members.reduce((last, member) => Math.max(last, member.position), 0)
  for (const task_id of taskIds) {
    if (included.has(task_id)) continue
    members.push({ task_id, position: ++position })
    included.add(task_id)
  }
  return { ...buildCollectionMembers(collection.name, collection.description || '', members), ...(collection.base_url ? { base_url: collection.base_url } : {}), ...(collection.datasource ? { datasource: { ...collection.datasource } } : {}) }
}

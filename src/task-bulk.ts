export async function deleteSelectedTasks<T extends { id: number; name: string }>(tasks: T[], remove: (id: number) => Promise<unknown>) {
  const deleted: T[] = []
  const failed: { task: T; reason: string }[] = []
  for (const task of tasks) {
    try { await remove(task.id); deleted.push(task) }
    catch (error) { failed.push({ task, reason: error instanceof Error ? error.message : '删除失败' }) }
  }
  return { deleted, failed }
}

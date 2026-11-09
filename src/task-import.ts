// XML 任务导入：一次 1-100 个文件，每个不超过 5 MiB，整批原子导入。
export const MAX_IMPORT_FILES = 100
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024

export function validateImportFiles(files: File[]): void {
  if (!files.length) throw new Error('请选择 .xml 任务文件。')
  if (files.length > MAX_IMPORT_FILES) throw new Error(`一次最多导入 ${MAX_IMPORT_FILES} 个文件。`)
  for (const file of files) {
    if (!/\.xml$/i.test(file.name)) throw new Error(`「${file.name}」不是 .xml 文件。`)
    if (!file.size) throw new Error(`任务文件「${file.name}」不能为空。`)
    if (file.size > MAX_IMPORT_FILE_SIZE) throw new Error(`任务文件「${file.name}」不能超过 5 MiB。`)
  }
}

export function buildImportBody(files: File[], baseUrl: string): FormData {
  validateImportFiles(files)
  const body = new FormData()
  for (const file of files) body.append('file', file)
  body.append('base_url', baseUrl)
  return body
}

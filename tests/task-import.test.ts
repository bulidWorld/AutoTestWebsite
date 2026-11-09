import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImportBody, validateImportFiles } from '../src/task-import.ts'

const xml = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'text/xml' })

test('接受 1-100 个非空 .xml 文件并按原顺序拼装表单', () => {
  const files = [xml('a.xml'), xml('b.xml', 5 * 1024 * 1024)]
  assert.doesNotThrow(() => validateImportFiles(files))
  const body = buildImportBody(files, 'https://api.example.com')
  assert.equal(body.get('base_url'), 'https://api.example.com')
  assert.deepEqual((body.getAll('file') as File[]).map(f => f.name), ['a.xml', 'b.xml'])
})

test('拒绝空选择、超过 100 个文件、非 XML 后缀、空文件和超过 5 MiB 的文件', () => {
  assert.throws(() => validateImportFiles([]), /请选择/)
  assert.throws(() => validateImportFiles(Array.from({ length: 101 }, (_, i) => xml(`t${i}.xml`))), /最多导入 100 个/)
  assert.throws(() => validateImportFiles([xml('note.txt')]), /不是 \.xml 文件/)
  assert.throws(() => validateImportFiles([xml('empty.xml', 0)]), /不能为空/)
  assert.throws(() => validateImportFiles([xml('big.xml', 5 * 1024 * 1024 + 1)]), /不能超过 5 MiB/)
})

test('拼装表单时同样校验文件，失败不产出 body', () => {
  assert.throws(() => buildImportBody([], 'https://api.example.com'))
  assert.throws(() => buildImportBody([xml('a.yaml')], 'https://api.example.com'))
})

test('接受上限 100 个 XML 文件并保留完整上传顺序', () => {
  const files = Array.from({ length: 100 }, (_, i) => xml(`task-${i}.xml`))
  assert.doesNotThrow(() => validateImportFiles(files))
  const body = buildImportBody(files, 'https://api.example.com')
  assert.deepEqual((body.getAll('file') as File[]).map(f => f.name), files.map(f => f.name))
})

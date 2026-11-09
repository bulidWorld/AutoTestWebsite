import assert from 'node:assert/strict'
import test from 'node:test'
import { logicalNameForFile } from '../src/yaml-import.ts'

test('从文件名推导逻辑文件名，去掉 .yaml/.yml 后缀', () => {
  assert.equal(logicalNameForFile('订单接口.yaml'), '订单接口')
  assert.equal(logicalNameForFile('order-service.yml'), 'order-service')
  assert.equal(logicalNameForFile('ORDER.API.YAML'), 'ORDER.API')
  assert.equal(logicalNameForFile('接口.定义.v1.yaml'), '接口.定义.v1')
})

test('无 YAML 后缀时原样返回文件名', () => {
  assert.equal(logicalNameForFile('notes.txt'), 'notes.txt')
  assert.equal(logicalNameForFile('Makefile'), 'Makefile')
})

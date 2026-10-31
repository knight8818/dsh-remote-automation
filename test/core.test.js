import test from 'node:test'
import assert from 'node:assert/strict'
import { percentEncode } from '../lib/aliyun.js'
import { validCron } from '../lib/tasks.js'

test('percentEncode follows Aliyun RPC rules', () => {
  assert.equal(percentEncode('a b'), 'a%20b')
  assert.equal(percentEncode('a+b'), 'a%2Bb')
  assert.equal(percentEncode('a*b'), 'a%2Ab')
  assert.equal(percentEncode('a~b'), 'a~b')
  assert.equal(percentEncode("a!'()b"), 'a%21%27%28%29b')
  assert.equal(percentEncode('中文'), '%E4%B8%AD%E6%96%87')
})

test('validCron accepts 5-field expressions', () => {
  assert.equal(validCron('0 9 * * *'), true)
  assert.equal(validCron('*/5 1-3 * * 1,2'), true)
  assert.equal(validCron(' 0  9 * * * '), true)
})

test('validCron rejects malformed expressions', () => {
  assert.equal(validCron('0 9 * *'), false)
  assert.equal(validCron('0 9 * * * *'), false)
  assert.equal(validCron('0 9 * * *; rm -rf /'), false)
  assert.equal(validCron(''), false)
  assert.equal(validCron(null), false)
})

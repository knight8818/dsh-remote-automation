import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import YAML from 'yaml'

import { percentEncode } from '../lib/aliyun.js'
import { shellQuote, validCron } from '../lib/tasks.js'
import { PROVIDER_IDS, providerState } from '../lib/providers.js'
import {
  normalizeTaskCommand,
  normalizeTaskName,
  validRegion,
  validServerDir,
  validTencentInstanceId,
} from '../lib/validate.js'

test('percentEncode follows Aliyun RPC rules', () => {
  assert.equal(percentEncode('a b'), 'a%20b')
  assert.equal(percentEncode('a+b'), 'a%2Bb')
  assert.equal(percentEncode('a*b'), 'a%2Ab')
  assert.equal(percentEncode('a~b'), 'a~b')
  assert.equal(percentEncode("a!'()b"), 'a%21%27%28%29b')
  assert.equal(percentEncode('中文'), '%E4%B8%AD%E6%96%87')
})

test('validCron accepts valid 5-field expressions', () => {
  assert.equal(validCron('0 9 * * *'), true)
  assert.equal(validCron('*/5 1-3 * * 1,2'), true)
  assert.equal(validCron(' 0  9 * * * '), true)
  assert.equal(validCron('0 0 1 1 0'), true)
  assert.equal(validCron('5/10 * * * *'), true)
})

test('validCron rejects malformed or out-of-range expressions', () => {
  assert.equal(validCron('0 9 * *'), false)
  assert.equal(validCron('0 9 * * * *'), false)
  assert.equal(validCron('0 9 * * *; rm -rf /'), false)
  assert.equal(validCron('60 * * * *'), false)
  assert.equal(validCron('0 24 * * *'), false)
  assert.equal(validCron('0 9 0 * *'), false)
  assert.equal(validCron('0 9 * 13 *'), false)
  assert.equal(validCron('0 9 * * 8'), false)
  assert.equal(validCron('*/0 * * * *'), false)
  assert.equal(validCron('5-1 * * * *'), false)
  assert.equal(validCron('0 9\n* * *'), false)
  assert.equal(validCron('0 9 * * *\rrm -rf /'), false)
  assert.equal(validCron(''), false)
  assert.equal(validCron(null), false)
})

test('shellQuote produces a single POSIX word', () => {
  assert.equal(shellQuote('/opt/automation'), "'/opt/automation'")
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
  assert.equal(shellQuote('a b;rm'), "'a b;rm'")
})

test('validRegion accepts Aliyun regions and rejects URL tricks', () => {
  assert.equal(validRegion('cn-shenzhen'), true)
  assert.equal(validRegion('ap-southeast-1'), true)
  assert.equal(validRegion('evil.com/'), false)
  assert.equal(validRegion('cn shenzhen'), false)
  assert.equal(validRegion(''), false)
})

test('validServerDir rejects traversal, root and shell metacharacters', () => {
  assert.equal(validServerDir('/opt/automation'), true)
  assert.equal(validServerDir('/opt'), true)
  assert.equal(validServerDir('/opt/a-b/c_d.1'), true)
  assert.equal(validServerDir('/opt/../etc'), false)
  assert.equal(validServerDir('/opt/a;rm -rf'), false)
  assert.equal(validServerDir('relative'), false)
  assert.equal(validServerDir('/'), false)
  assert.equal(validServerDir('//opt'), false)
  assert.equal(validServerDir('/opt/'), false)
  assert.equal(validServerDir(''), false)
})

test('validTencentInstanceId accepts CVM and Lighthouse ids', () => {
  assert.equal(validTencentInstanceId('ins-abc12345'), true)
  assert.equal(validTencentInstanceId('lhins-ar5wyn4x'), true)
  assert.equal(validTencentInstanceId('i-abc123'), false)
  assert.equal(validTencentInstanceId('ins-abc;rm'), false)
  assert.equal(validTencentInstanceId(''), false)
})

test('provider metadata exposes all providers and masks credentials', () => {
  assert.deepEqual(PROVIDER_IDS, ['aliyun', 'tencent', 'aws'])
  const aliyun = providerState('aliyun', {
    accessKeyId: 'LTAI1234567890',
    accessKeySecret: 'secret',
    region: 'cn-shenzhen',
    instanceId: 'i-abc12345',
  })
  assert.equal(aliyun.configured, true)
  assert.equal(aliyun.maskedId, 'LTAI****7890')
  assert.equal(aliyun.secretConfigured, true)
  const tencent = providerState('tencent', { secretId: 'AKIDexample1234', secretKey: 'x'.repeat(12) })
  assert.equal(tencent.configured, false)
  assert.ok(tencent.missing.includes('region'))
  const aws = providerState('aws', {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    instanceId: 'i-abc12345',
  })
  assert.equal(aws.configured, true)
  const badToken = providerState('aws', {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'x'.repeat(20),
    region: 'us-east-1',
    instanceId: 'i-abc12345',
    sessionToken: 'short',
  })
  assert.equal(badToken.invalid.includes('sessionToken'), true)
})

test('task input normalization enforces limits', () => {
  assert.equal(normalizeTaskName('  daily-report  '), 'daily-report')
  assert.equal(normalizeTaskName('bad\nname'), null)
  assert.equal(normalizeTaskName('x'.repeat(81)), null)
  assert.equal(normalizeTaskCommand('  echo hi  '), 'echo hi')
  assert.equal(normalizeTaskCommand('x'.repeat(12 * 1024 + 1)), null)
})

test('the package is an installable DSH bundle', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.ok(pkg.exports['./cordis.patch.yml'])
  assert.ok(pkg.engines.dsh)
})

test('bundled cordis layer inserts exactly one remote-automation row', () => {
  const text = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const doc = YAML.parse(text)
  assert.ok(Array.isArray(doc))
  const rows = doc.flatMap((entry) => (Array.isArray(entry?.insert) ? entry.insert : []))
  const matches = rows.filter((row) => row?.id === 'remote-automation')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].name, 'dsh-remote-automation')
})

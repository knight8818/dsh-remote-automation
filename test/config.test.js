import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-ra-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'remote-automation'), { recursive: true })
const configPath = join(home, 'remote-automation', 'config.json')

const baseline = {
  accessKeyId: 'LTAIfile',
  accessKeySecret: 'file-secret',
  region: 'cn-hangzhou',
  instanceId: 'i-file',
}

beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('DSH_RA_') || name === 'ALIYUN_REGION' || name === 'ALIYUN_INSTANCE_ID') {
      delete process.env[name]
    }
  }
  writeFileSync(configPath, JSON.stringify(baseline))
})

const { configPatchErrors, loadConfig, saveConfig, publicConfig } = await import('../lib/config.js')

test('v1 flat config is read as an Aliyun provider', () => {
  const { configured, provider, providers, serverDir } = loadConfig()
  assert.equal(configured, true)
  assert.equal(provider, 'aliyun')
  assert.equal(providers.aliyun.region, 'cn-hangzhou')
  assert.equal(providers.aliyun.accessKeyId, 'LTAIfile')
  assert.equal(serverDir, '/opt/automation')
})

test('env overrides file per provider', () => {
  process.env.DSH_RA_REGION = 'cn-shenzhen'
  process.env.DSH_RA_INSTANCE_ID = 'i-env'
  const { providers } = loadConfig()
  assert.equal(providers.aliyun.region, 'cn-shenzhen')
  assert.equal(providers.aliyun.instanceId, 'i-env')
})

test('missing fields are reported', () => {
  saveConfig({ provider: 'aliyun', values: { accessKeySecret: null } })
  const result = loadConfig()
  assert.equal(result.configured, false)
  assert.ok(result.missing.includes('accessKeySecret'))
  saveConfig({ provider: 'aliyun', values: { accessKeySecret: 'file-secret' } })
  assert.equal(loadConfig().configured, true)
})

test('invalid values are reported instead of silently used', () => {
  saveConfig({ provider: 'aliyun', values: { region: 'not a region' } })
  const result = loadConfig()
  assert.equal(result.configured, false)
  assert.ok(result.invalid.includes('region'))
  saveConfig({ provider: 'aliyun', values: { region: 'cn-hangzhou' } })
  assert.deepEqual(loadConfig().invalid, [])
})

test('publicConfig masks secrets and never returns them', () => {
  const pub = publicConfig()
  assert.equal(pub.providers.aliyun.maskedId, 'LTAI****file')
  assert.equal(pub.providers.aliyun.secretConfigured, true)
  assert.equal(JSON.stringify(pub).includes('file-secret'), false)
})

test('saveConfig writes v2 shape and ignores unknown or empty keys', () => {
  saveConfig({ provider: 'aliyun', values: { evilKey: 'x', region: '' } })
  const saved = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(saved.version, 2)
  assert.equal('evilKey' in saved.providers.aliyun, false)
  assert.equal(saved.providers.aliyun.region, 'cn-hangzhou')
  assert.equal('accessKeyId' in saved, false)
})

test('tencent provider can be configured alongside Aliyun', () => {
  saveConfig({
    provider: 'tencent',
    values: {
      secretId: 'AKIDexample1234',
      secretKey: 'tencent-secret-value',
      region: 'ap-guangzhou',
      instanceId: 'ins-abc12345',
    },
  })
  const result = loadConfig()
  assert.equal(result.provider, 'tencent')
  assert.equal(result.configured, true)
  assert.equal(result.state.aliyun.configured, true)
  assert.equal(result.state.tencent.region, 'ap-guangzhou')
  const pub = publicConfig()
  assert.equal(pub.providers.tencent.maskedId, 'AKID****1234')
  assert.equal(JSON.stringify(pub).includes('tencent-secret-value'), false)
})

test('invalid serverDir blocks both providers', () => {
  saveConfig({ provider: 'aliyun', serverDir: 'relative/dir' })
  const result = loadConfig()
  assert.equal(result.configured, false)
  assert.ok(result.invalid.includes('serverDir'))
})

test('configPatchErrors validates per provider', () => {
  assert.deepEqual(configPatchErrors('aliyun', { region: 'cn-shenzhen', instanceId: 'i-abc123' }), [])
  assert.deepEqual(configPatchErrors('aliyun', { region: 'cn shenzhen' }), ['region'])
  assert.deepEqual(configPatchErrors('aliyun', { instanceId: 'abc' }), ['instanceId'])
  assert.deepEqual(configPatchErrors('tencent', { instanceId: 'ins-abc123' }), [])
  assert.deepEqual(configPatchErrors('tencent', { instanceId: 'i-abc123' }), ['instanceId'])
  assert.deepEqual(configPatchErrors('tencent', { secretId: 'x' }), ['secretId'])
  assert.deepEqual(configPatchErrors('nope', {}), ['provider'])
  assert.deepEqual(configPatchErrors('aliyun', { region: null }), [])
})

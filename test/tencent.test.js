import test from 'node:test'
import assert from 'node:assert/strict'

import { TencentTatClient, TENCENT_TERMINAL_STATES, tencentEndpoint } from '../lib/tencent.js'

function client(overrides = {}) {
  return new TencentTatClient({
    secretId: 'AKIDexample1234',
    secretKey: 'example-secret-key',
    region: 'ap-guangzhou',
    instanceId: 'ins-abc12345',
    ...overrides,
  })
}

test('Tencent client validates credentials and identifiers', () => {
  assert.throws(() => client({ secretId: '' }), /SecretId/)
  assert.throws(() => client({ region: 'bad region' }), /region/)
  assert.throws(() => client({ instanceId: 'i-abc123' }), /实例 ID/)
  assert.ok(client())
})

test('Tencent endpoint follows the region', () => {
  assert.equal(tencentEndpoint('ap-guangzhou'), 'tat.tencentcloudapi.com')
  assert.equal(tencentEndpoint('ap-singapore'), 'tat.intl.tencentcloudapi.com')
  assert.equal(client({ region: 'ap-singapore' }).endpoint, 'tat.intl.tencentcloudapi.com')
})

test('Tencent exec maps RunCommand + DescribeInvocationTasks to output', async () => {
  const c = client()
  const calls = []
  c.client = {
    async RunCommand(params) {
      calls.push(['RunCommand', params])
      return { InvocationId: 'inv-1vll7hda' }
    },
    async DescribeInvocationTasks(params) {
      calls.push(['DescribeInvocationTasks', params])
      return {
        InvocationTaskSet: [
          {
            InstanceId: 'ins-abc12345',
            TaskStatus: 'SUCCESS',
            TaskResult: { ExitCode: 0, Output: Buffer.from('hello\n', 'utf8').toString('base64') },
          },
        ],
      }
    },
  }
  const result = await c.exec('echo hello', { interval: 1 })
  assert.equal(result.exitCode, 0)
  assert.equal(result.output, 'hello\n')
  assert.equal(result.invocationId, 'inv-1vll7hda')
  assert.equal(calls[0][1].CommandType, 'SHELL')
  assert.equal(calls[0][1].Content, Buffer.from('echo hello').toString('base64'))
  assert.equal(calls[1][1].HideOutput, false)
})

test('Tencent exec surfaces the exit code and status of a failed task', async () => {
  const c = client()
  c.client = {
    async RunCommand() {
      return { InvocationId: 'inv-failed' }
    },
    async DescribeInvocationTasks() {
      return {
        InvocationTaskSet: [
          {
            InstanceId: 'ins-abc12345',
            TaskStatus: 'FAILED',
            TaskResult: { ExitCode: 2, Output: Buffer.from('boom').toString('base64') },
          },
        ],
      }
    },
  }
  const result = await c.exec('false', { interval: 1 })
  assert.equal(result.exitCode, 2)
  assert.equal(result.status, 'FAILED')
  assert.equal(result.output, 'boom')
})

test('Tencent agent status is projected from the SDK response', async () => {
  const c = client()
  c.client = {
    async DescribeAutomationAgentStatus() {
      return {
        AutomationAgentSet: [{ InstanceId: 'ins-abc12345', AgentStatus: 'Online', Environment: 'Linux' }],
      }
    },
  }
  const status = await c.agentStatus()
  assert.equal(status.AgentStatus, 'Online')
})

test('terminal states include success and failure variants', () => {
  for (const state of ['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED']) {
    assert.equal(TENCENT_TERMINAL_STATES.has(state), true)
  }
  assert.equal(TENCENT_TERMINAL_STATES.has('RUNNING'), false)
})

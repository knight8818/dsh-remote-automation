import test from 'node:test'
import assert from 'node:assert/strict'

import { AwsSsmClient, AWS_TERMINAL_STATES } from '../lib/aws.js'

function client(overrides = {}) {
  return new AwsSsmClient({
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    instanceId: 'i-abc12345',
    ...overrides,
  })
}

test('AWS client validates credentials and identifiers', () => {
  assert.throws(() => client({ accessKeyId: '' }), /Access Key/)
  assert.throws(() => client({ region: 'bad region' }), /region/)
  assert.throws(() => client({ instanceId: 'not-an-instance' }), /实例 ID/)
  assert.ok(client())
})

test('AWS exec maps SendCommand + GetCommandInvocation to output', async () => {
  const c = client()
  const sent = []
  c.client = {
    async send(command) {
      sent.push(command.constructor.name)
      if (command.constructor.name === 'SendCommandCommand') {
        assert.equal(command.input.DocumentName, 'AWS-RunShellScript')
        assert.deepEqual(command.input.Parameters.commands, ['echo hello'])
        return { Command: { CommandId: 'cmd-1' } }
      }
      return {
        Status: 'Success',
        ResponseCode: 0,
        StandardOutputContent: 'hello\n',
        StandardErrorContent: '',
      }
    },
  }
  const result = await c.exec('echo hello', { interval: 1 })
  assert.equal(result.exitCode, 0)
  assert.equal(result.output, 'hello\n')
  assert.equal(result.commandId, 'cmd-1')
  assert.deepEqual(sent, ['SendCommandCommand', 'GetCommandInvocationCommand'])
})

test('AWS exec includes stderr and failure exit code', async () => {
  const c = client()
  c.client = {
    async send(command) {
      if (command.constructor.name === 'SendCommandCommand') return { Command: { CommandId: 'cmd-2' } }
      return {
        Status: 'Failed',
        ResponseCode: 2,
        StandardOutputContent: 'partial',
        StandardErrorContent: 'boom',
      }
    },
  }
  const result = await c.exec('false', { interval: 1 })
  assert.equal(result.status, 'Failed')
  assert.equal(result.exitCode, 2)
  assert.equal(result.output, 'partial\nboom')
})

test('AWS invocation treats InvocationDoesNotExist as not ready', async () => {
  const c = client()
  c.client = {
    async send() {
      const error = new Error('not found yet')
      error.name = 'InvocationDoesNotExist'
      throw error
    },
  }
  assert.equal(await c.invocation('cmd-x'), null)
})

test('AWS agent status is projected from DescribeInstanceInformation', async () => {
  const c = client()
  c.client = {
    async send() {
      return {
        InstanceInformationList: [{ InstanceId: 'i-abc12345', PingStatus: 'Online', PlatformType: 'Linux' }],
      }
    },
  }
  const status = await c.agentStatus()
  assert.equal(status.PingStatus, 'Online')
})

test('AWS terminal states include success and failure variants', () => {
  for (const state of ['Success', 'Failed', 'Cancelled', 'TimedOut']) {
    assert.equal(AWS_TERMINAL_STATES.has(state), true)
  }
  assert.equal(AWS_TERMINAL_STATES.has('InProgress'), false)
})

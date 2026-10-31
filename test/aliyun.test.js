import test from 'node:test'
import assert from 'node:assert/strict'

import { AliyunEcsClient } from '../lib/aliyun.js'

function client() {
  return new AliyunEcsClient({
    accessKeyId: 'LTAI1234567890',
    accessKeySecret: 'example-secret',
    region: 'cn-shenzhen',
    instanceId: 'i-abc12345',
  })
}

test('Aliyun sendFile posts base64 content and polls the result', async () => {
  const c = client()
  const calls = []
  c.call = async (action, params) => {
    calls.push([action, params])
    if (action === 'SendFile') return { InvokeId: 'f-1' }
    if (action === 'DescribeSendFileResults') {
      return {
        Invocations: {
          Invocation: [
            {
              InvokeId: 'f-1',
              InvocationStatus: 'Success',
              InvokeInstances: {
                InvokeInstance: [{ InstanceId: 'i-abc12345', InvocationStatus: 'Success' }],
              },
            },
          ],
        },
      }
    }
    throw new Error(`unexpected ${action}`)
  }
  const result = await c.sendFile({
    name: 't-123.sh',
    content: 'echo hi\n',
    targetDir: '/opt/automation/scripts',
    mode: '0755',
  })
  assert.equal(result.invokeId, 'f-1')
  const send = calls.find(([action]) => action === 'SendFile')[1]
  assert.equal(send.ContentType, 'Base64')
  assert.equal(send.Content, Buffer.from('echo hi\n').toString('base64'))
  assert.equal(send.TargetDir, '/opt/automation/scripts')
  assert.equal(send.FileMode, '0755')
  assert.equal(send['InstanceId.1'], 'i-abc12345')
})

test('Aliyun sendFile surfaces failure details', async () => {
  const c = client()
  c.call = async (action) => {
    if (action === 'SendFile') return { InvokeId: 'f-2' }
    return {
      Invocations: {
        Invocation: [
          {
            InvokeId: 'f-2',
            InvocationStatus: 'Failed',
            InvokeInstances: {
              InvokeInstance: [
                {
                  InstanceId: 'i-abc12345',
                  InvocationStatus: 'Failed',
                  ErrorCode: 'FileContentInvalid',
                  ErrorInfo: 'file content invalid',
                },
              ],
            },
          },
        ],
      },
    }
  }
  await assert.rejects(
    () => c.sendFile({ name: 'x', content: 'x', targetDir: '/tmp' }),
    /FileContentInvalid|file content invalid|SendFile Failed/,
  )
})

test('Aliyun client exposes a safe chunk size for double base64', () => {
  assert.equal(client().chunkSize, 8 * 1024)
})

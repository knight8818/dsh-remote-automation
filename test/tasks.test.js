import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-ra-tasks-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'remote-automation'), { recursive: true })

const { addTask, buildTaskScript, loadState, newTask, saveState, shellQuote, taskDir, taskStatuses } = await import('../lib/tasks.js')
const { sha256Hex } = await import('../lib/artifact.js')
const { statePath } = await import('../lib/config.js')

function sampleTask(overrides = {}) {
  return {
    id: 't-1a2b3c4d',
    name: 'daily-report',
    command: 'echo hello',
    schedule: '0 9 * * *',
    provider: 'aliyun',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('buildTaskScript quotes the server directory and embeds the command', () => {
  const script = buildTaskScript(sampleTask(), '/opt/automation')
  assert.match(script, /^#!\/usr\/bin\/env bash/)
  assert.ok(script.includes(`mkdir -p ${shellQuote('/opt/automation')}/logs`))
  assert.ok(script.includes('\necho hello\n'))
  assert.ok(script.includes(`echo $$ > ${shellQuote('/opt/automation')}/state/t-1a2b3c4d.pid`))
  assert.ok(script.includes('echo "[$(date -Is)] EXIT $rc"'))
})

test('buildTaskScript wraps the command in a subshell to keep the exit code', () => {
  const script = buildTaskScript(sampleTask({ command: 'exit 3' }), '/opt/automation')
  assert.ok(script.includes('\n(\nexit 3\n)\nrc=$?\n'))
})

test('buildTaskScript sanitizes the task name in the START marker', () => {
  const script = buildTaskScript(sampleTask({ name: 'bad name!\nrm -rf /' }), '/opt/automation')
  const startLine = script.split('\n').find((line) => line.includes('START'))
  assert.ok(startLine.includes('START bad_name__rm_-rf_'))
  assert.equal(startLine.includes('\n'), false)
})

test('buildTaskScript refuses an unsafe server directory', () => {
  assert.throws(() => buildTaskScript(sampleTask(), '/opt/../etc'), /脚本目录不合法/)
  assert.throws(() => buildTaskScript(sampleTask(), '/opt/a;b'), /脚本目录不合法/)
})

test('artifact tasks cd into the extracted directory', () => {
  const task = sampleTask({
    command: 'bash run.sh',
    artifact: { sha256: 'a'.repeat(64), entry: 'bash run.sh', size: 12 },
  })
  const script = buildTaskScript(task, '/opt/automation')
  assert.ok(script.includes("cd '/opt/automation/tasks/t-1a2b3c4d'"))
  assert.ok(script.includes('\n(\nbash run.sh\n)\nrc=$?\n'))
})

test('addTask uploads, verifies and extracts an artifact in chunks', async () => {
  const bytes = Buffer.from('fake tar gz bytes')
  const sha = sha256Hex(bytes)
  const task = newTask({
    name: 'artifact',
    command: 'bash run.sh',
    provider: 'aliyun',
    serverDir: '/opt/automation',
    artifact: { sha256: sha, entry: 'bash run.sh', size: bytes.length },
  })
  const calls = []
  const runtime = {
    provider: 'aliyun',
    serverDir: '/opt/automation',
    providers: { aliyun: {} },
    state: { aliyun: { configured: true, missing: [], invalid: [] } },
    clientFactory: () => ({
      chunkSize: 4,
      async exec(command) {
        calls.push(command)
        if (command.includes('sha256sum')) return { exitCode: 0, output: `${sha}\n` }
        return { exitCode: 0, output: 'ok\n' }
      },
    }),
  }
  await addTask(runtime, task, { artifactBytes: bytes })
  assert.ok(calls.some((command) => command.includes('chunk-00000')))
  assert.ok(calls.some((command) => command.includes('tar -xzf')))
  assert.ok(calls.some((command) => command.includes('printf') && command.includes(`${task.id}.sh`)))
})

test('newTask keeps valid artifact metadata only', () => {
  const good = newTask({
    name: 'x',
    command: 'bash run.sh',
    provider: 'aliyun',
    serverDir: '/opt/automation',
    artifact: { sha256: 'b'.repeat(64), entry: 'bash run.sh', size: 10 },
  })
  assert.equal(good.artifact.entry, 'bash run.sh')
  const bad = newTask({
    name: 'x',
    command: 'bash run.sh',
    provider: 'aliyun',
    serverDir: '/opt/automation',
    artifact: { sha256: 'not-a-hash', entry: 'bash run.sh' },
  })
  assert.equal(bad.artifact, null)
})

test('loadState drops malformed rows and normalizes schedules', () => {
  writeFileSync(
    statePath(),
    JSON.stringify({
      target: 'cloud',
      tasks: [
        sampleTask(),
        sampleTask({ id: 'not-a-task' }),
        sampleTask({ id: 't-00000000', command: '' }),
        sampleTask({ id: 't-11111111', schedule: '0 9 * * *; curl evil' }),
        sampleTask({ id: 't-33333333', provider: 'tencent' }),
        sampleTask({ id: 't-44444444', provider: 'not-a-cloud' }),
        { id: 't-22222222', name: 42, command: 'echo x' },
        null,
      ],
    }),
  )
  const { tasks } = loadState()
  assert.deepEqual(
    tasks.map((task) => task.id),
    ['t-1a2b3c4d', 't-11111111', 't-33333333', 't-44444444'],
  )
  assert.equal(tasks[1].schedule, null)
  assert.equal(tasks[2].provider, 'tencent')
  assert.equal(tasks[3].provider, 'aliyun')
  assert.equal('target' in loadState(), false)
})

test('newTask records provider and server directory, rejecting bad values', () => {
  const task = newTask({ name: 'x', command: 'echo x', schedule: null, provider: 'tencent', serverDir: '/srv/tasks' })
  assert.equal(task.provider, 'tencent')
  assert.equal(task.serverDir, '/srv/tasks')
  const fallback = newTask({ name: 'x', command: 'echo x', schedule: null, provider: 'nope' })
  assert.equal(fallback.provider, 'aliyun')
  const unsafe = newTask({ name: 'x', command: 'echo x', schedule: null, serverDir: '/srv/../etc' })
  assert.equal(unsafe.serverDir, null)
})

test('taskDir prefers the task directory and validates it', () => {
  const runtime = { provider: 'aliyun', serverDir: '/opt/automation' }
  assert.equal(taskDir(runtime, { serverDir: '/srv/one' }), '/srv/one')
  assert.equal(taskDir(runtime, { serverDir: null }), '/opt/automation')
  assert.throws(() => taskDir({ serverDir: '/bad/../dir' }, {}), /脚本目录不合法/)
})

test('taskStatuses groups tasks by provider and skips unconfigured ones', async () => {
  const calls = []
  const runtime = {
    provider: 'aliyun',
    serverDir: '/opt/automation',
    providers: { aliyun: { accessKeyId: 'x' }, tencent: {} },
    state: {
      aliyun: { configured: true, missing: [], invalid: [] },
      tencent: { configured: false, missing: ['secretId'], invalid: [] },
    },
    clientFactory: (id) => {
      calls.push(id)
      return {
        async exec(script) {
          assert.ok(script.includes('t-1a2b3c4d'))
          return { exitCode: 0, output: 't-1a2b3c4d|1|123|0|2026-01-01 00:00:00\n' }
        },
      }
    },
  }
  const tasks = [
    { id: 't-1a2b3c4d', provider: 'aliyun', serverDir: '/opt/automation' },
    { id: 't-22222222', provider: 'tencent', serverDir: '/opt/automation' },
  ]
  const statuses = await taskStatuses(runtime, tasks)
  assert.deepEqual(calls, ['aliyun'])
  assert.equal(statuses['t-1a2b3c4d'].state, 'running')
  assert.equal(statuses['t-22222222'].state, 'unconfigured')
})

test('loadState backs up a corrupt state file instead of losing tasks', () => {
  writeFileSync(statePath(), '{ this is not json')
  const { tasks } = loadState()
  assert.deepEqual(tasks, [])
  const backups = readdirSync(dirname(statePath())).filter((name) => name.startsWith('state.json.bad-'))
  assert.ok(backups.length >= 1)
})

test('saveState round-trips and persists only tasks', () => {
  const task = newTask({ name: '  nightly  ', command: '  echo ok  ', schedule: null })
  assert.match(task.id, /^t-[0-9a-f]{8}$/)
  assert.equal(task.name, 'nightly')
  assert.equal(task.command, 'echo ok')
  saveState({ tasks: [task] })
  assert.ok(existsSync(statePath()))
  const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
  assert.deepEqual(Object.keys(raw), ['tasks'])
  assert.equal(raw.tasks[0].id, task.id)
  assert.deepEqual(loadState().tasks, [task])
})

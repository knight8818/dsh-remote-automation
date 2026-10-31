import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-ra-tasks-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'remote-automation'), { recursive: true })

const { buildTaskScript, loadState, newTask, saveState, shellQuote } = await import('../lib/tasks.js')
const { statePath } = await import('../lib/config.js')

function sampleTask(overrides = {}) {
  return {
    id: 't-1a2b3c4d',
    name: 'daily-report',
    command: 'echo hello',
    schedule: '0 9 * * *',
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
        { id: 't-22222222', name: 42, command: 'echo x' },
        null,
      ],
    }),
  )
  const { tasks } = loadState()
  assert.deepEqual(
    tasks.map((task) => task.id),
    ['t-1a2b3c4d', 't-11111111'],
  )
  assert.equal(tasks[1].schedule, null)
  assert.equal('target' in loadState(), false)
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

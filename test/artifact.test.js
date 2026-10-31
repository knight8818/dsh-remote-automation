import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultEntry, formatBytes, packArtifact, sha256Hex } from '../lib/artifact.js'

test('packArtifact packs a single file with a verifiable checksum', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ra-pack-'))
  const file = join(dir, 'run.sh')
  writeFileSync(file, '#!/usr/bin/env bash\necho hi\n')
  const pack = await packArtifact(file)
  try {
    assert.ok(pack.bytes.length > 0)
    assert.equal(pack.sha256, sha256Hex(pack.bytes))
    assert.equal(pack.isDirectory, false)
    assert.equal(pack.name, 'run.sh')
    assert.equal(defaultEntry(pack), "bash 'run.sh'")
  } finally {
    pack.cleanup()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('packArtifact packs a directory and requires an explicit entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ra-pack-'))
  mkdirSync(join(dir, 'bin'))
  writeFileSync(join(dir, 'bin', 'run.sh'), 'echo hi\n')
  mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'node_modules', 'ignored.txt'), 'ignored')
  const pack = await packArtifact(dir)
  try {
    assert.equal(pack.isDirectory, true)
    assert.equal(defaultEntry(pack), null)
    assert.ok(pack.bytes.length > 0)
  } finally {
    pack.cleanup()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('formatBytes is stable', () => {
  assert.equal(formatBytes(12), '12 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB')
})

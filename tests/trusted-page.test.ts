import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sameLocalPage } from '../src/main/trusted-page.ts'

test('trusted page comparison resolves file aliases without trusting another file or file origin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-origin-'))
  try {
    const file = join(dir, 'index.html'), other = join(dir, 'other.html')
    writeFileSync(file, 'same'); writeFileSync(other, 'same')
    const expected = pathToFileURL(file).href
    assert.equal(sameLocalPage(expected, expected), true)
    for (const actual of [pathToFileURL(other).href, `${expected}?x=1`, `${expected}#fragment`, 'https://example.com/index.html', 'file://remote/index.html', 'not-a-url', pathToFileURL(join(dir, 'missing')).href]) assert.equal(sameLocalPage(actual, expected), false)
    if (process.platform !== 'win32') {
      const alias = join(dir, 'alias.html'); symlinkSync(file, alias)
      assert.equal(sameLocalPage(pathToFileURL(alias).href, expected), true)
    }
    // Windows CI's extracted path may use RUNNER~1 while Node resolves the long name.
    const resolver = (path: string) => path.includes('RUNNER~1') ? path.replace('RUNNER~1', 'runneradmin') : path
    assert.equal(sameLocalPage('file:///C:/Users/RUNNER~1/app.asar/index.html', 'file:///C:/Users/runneradmin/app.asar/index.html', resolver), true)
    assert.equal(sameLocalPage('file:///C:/Users/RUNNER~1/app.asar/other.html', 'file:///C:/Users/runneradmin/app.asar/index.html', resolver), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

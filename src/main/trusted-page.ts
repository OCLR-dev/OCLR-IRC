import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Compare the actual file, including Windows short/long paths, never just file: origin. */
export function sameLocalPage(actual: string, expected: string, resolve: (file: string) => string = realpathSync.native) {
  try {
    const source = new URL(actual), target = new URL(expected)
    if (source.protocol !== 'file:' || target.protocol !== 'file:' || source.host || target.host || source.search || source.hash || target.search || target.hash) return false
    if (source.href === target.href) return true
    return resolve(fileURLToPath(source)) === resolve(fileURLToPath(target))
  } catch { return false }
}

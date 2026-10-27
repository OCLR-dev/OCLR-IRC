import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { credentials } from './protocol.ts'

interface Encryption {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}
/** Only encrypted bytes reach disk. Operations serialize so forget/new saves win over older writes. */
export class CredentialStore {
  private file: string
  private encryption: Encryption
  private tail: Promise<unknown> = Promise.resolve()
  constructor(file: string, encryption: Encryption) { this.file = file; this.encryption = encryption }
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => {})
    return next
  }
  private async available() { try { return await this.encryption.available() } catch { return false } }
  status() { return this.run(async () => {
    let saved = false
    try { const info = await stat(this.file); saved = info.isFile() && info.size > 0 && info.size <= 16384 } catch { /* No saved credentials. */ }
    return { available: await this.available(), saved }
  }) }
  private async write(value: { username: string; password: string }) {
    if (!await this.available()) throw new Error('系統安全儲存不可用，未保存密碼。')
    const encrypted = await this.encryption.encrypt(JSON.stringify(value))
    if (!encrypted.length || encrypted.length > 16384) throw new Error('無法安全保存密碼。')
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = this.file + '.tmp'
    try { await writeFile(temp, encrypted, { mode: 0o600 }); await rename(temp, this.file) }
    finally { await rm(temp, { force: true }) }
  }
  save(input: unknown) { const value = credentials(input); return this.run(() => this.write(value)) }
  load() { return this.run(async () => {
    if (!await this.available()) throw new Error('系統安全儲存不可用，請手動登入。')
    const info = await stat(this.file)
    if (!info.isFile() || info.size <= 0 || info.size > 16384) throw new Error('已保存的登入資料無法讀取。')
    const decrypted = await this.encryption.decrypt(await readFile(this.file))
    const value = credentials(JSON.parse(decrypted.result))
    if (decrypted.shouldReEncrypt) await this.write(value)
    return value
  }) }
  forget() { return this.run(async () => { await rm(this.file, { force: true }); await rm(this.file + '.tmp', { force: true }) }) }
}

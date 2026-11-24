import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { NsisUpdater } from 'electron-updater'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import type { AppUpdateState } from '../shared/app-updates.ts'
import type { NetworkProxy } from '../shared/network-proxy.ts'
import { decodeUpdatePublicKey, publicRelease, windowsUpdate } from './update-feed.ts'

type WindowsInfo = Awaited<ReturnType<typeof windowsUpdate>>
type Sparkle = { start(): void; check(): boolean }

export class AppUpdates {
  state: AppUpdateState = { mode: 'manual', status: 'idle', version: null, progress: null }
  private windows: NsisUpdater | null = null
  private sparkle: Sparkle | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private verifiedFile: { path: string; info: WindowsInfo['files'][number] } | null = null

  constructor(private readonly fetcher: typeof fetch, private readonly proxy: () => NetworkProxy, private readonly version: string, private readonly publish: (state: AppUpdateState) => void) {}

  start() {
    try {
      if (process.platform === 'darwin') {
        this.sparkle = require(join(process.resourcesPath, 'oclr-sparkle.node')) as Sparkle
        this.sparkle.start()
        this.update({ mode: 'sparkle' })
      } else if (process.platform === 'win32' && process.arch === 'x64') {
        this.startWindows()
      }
    } catch { this.sparkle = null; this.windows = null }
  }

  private startWindows() {
    const installDirectory = dirname(process.execPath)
    if (!existsSync(join(installDirectory, 'Uninstall OCLR IRC.exe'))) return
    const publicKey = decodeUpdatePublicKey(readFileSync(join(process.resourcesPath, 'oclr-update-key.txt'), 'utf8'))
    const { NsisUpdater, Provider } = require('electron-updater') as typeof import('electron-updater')
    const fetcher = this.fetcher
    class GitHubUpdates extends Provider<WindowsInfo> {
      constructor(_options: unknown, _updater: unknown, options: ProviderRuntimeOptions) { super(options) }
      getLatestVersion() { return windowsUpdate(fetcher, publicKey) }
      resolveFiles(info: WindowsInfo) { return info.files.map(file => ({ url: new URL(file.url), info: file })) }
    }
    const windows = new NsisUpdater({ provider: 'custom', updateProvider: GitHubUpdates })
    windows.logger = null
    windows.allowPrerelease = false
    windows.allowDowngrade = false
    windows.disableDifferentialDownload = true
    windows.disableWebInstaller = true
    windows.autoDownload = false
    windows.autoInstallOnAppQuit = false
    windows.installDirectory = installDirectory
    windows.on('error', () => this.update({ status: 'error', progress: null }))
    windows.on('download-progress', progress => this.update({ progress: Math.min(100, Math.max(0, Math.floor(progress.percent))) }))
    this.windows = windows
    this.update({ mode: 'windows' })
    const schedule = (delay: number) => {
      this.timer = setTimeout(() => {
        if (['idle', 'current', 'error', 'available'].includes(this.state.status)) void this.check()
        schedule(6 * 60 * 60 * 1000)
      }, delay).unref()
    }
    schedule(15000)
  }

  stop() { if (this.timer) clearTimeout(this.timer) }

  private update(patch: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...patch }
    this.publish(this.state)
  }

  async check() {
    if (this.sparkle) { this.sparkle.check(); return }
    if (['checking', 'downloading', 'ready', 'installing'].includes(this.state.status)) return
    this.update({ status: 'checking', version: null, progress: null })
    try {
      let version: string | null
      if (this.windows) {
        const result = await this.windows.checkForUpdates()
        version = result?.isUpdateAvailable ? result.updateInfo.version : null
      } else version = await publicRelease(this.fetcher, this.version)
      this.update({ status: version ? 'available' : 'current', version })
    } catch { this.update({ status: 'error' }) }
  }

  async download() {
    if (!this.windows || this.state.status !== 'available') return
    this.update({ status: 'downloading', progress: 0 })
    try {
      const result = await this.windows.checkForUpdates()
      if (!result?.isUpdateAvailable) { this.update({ status: 'current', version: null, progress: null }); return }
      this.update({ version: result.updateInfo.version })
      const [info] = result.updateInfo.files
      if (!info?.size) throw new Error('Incomplete update file metadata')
      const proxy = this.proxy()
      const session = this.windows.netSession
      if (proxy.mode === 'direct') await session.setProxy({ mode: 'direct' })
      else {
        const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host
        await session.setProxy({ mode: 'fixed_servers', proxyRules: `${proxy.mode}://${host}:${proxy.port}` })
      }
      await session.closeAllConnections()
      const [path] = await this.windows.downloadUpdate()
      this.verifiedFile = { path, info: { url: info.url, size: info.size, sha512: info.sha512 } }
      this.update({ status: 'ready', progress: null })
    } catch { this.update({ status: 'error', progress: null }) }
  }

  async install() {
    if (!this.windows || !this.verifiedFile || this.state.status !== 'ready') return
    const { path, info } = this.verifiedFile
    this.update({ status: 'installing' })
    try {
      const stat = statSync(path)
      if (!stat.isFile() || stat.size !== info.size) throw new Error('Invalid update size')
      const hash = createHash('sha512')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      if (hash.digest('base64') !== info.sha512) throw new Error('Invalid update checksum')
      this.windows.quitAndInstall(true, true)
    } catch { this.update({ status: 'error' }) }
  }
}

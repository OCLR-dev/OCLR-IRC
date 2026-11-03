import { app, Menu, Tray } from 'electron'
import { createTrayIcon } from './app-icon.ts'
import type { BrowserWindow } from 'electron'

export class DesktopBackground {
  private tray: Tray | null = null
  private getWindow: () => BrowserWindow | null
  private foreground: (value: boolean) => void
  constructor(getWindow: () => BrowserWindow | null, foreground: (value: boolean) => void) {
    this.getWindow = getWindow; this.foreground = foreground
    try {
      this.tray = new Tray(createTrayIcon())
      this.tray.setToolTip('OCLR IRC')
      this.setLocale('zh-Hant')
      this.tray.on('click', () => this.show())
      this.tray.on('double-click', () => this.show())
    } catch { this.tray?.destroy(); this.tray = null }
  }
  setLocale(locale: string) {
    this.tray?.setContextMenu(Menu.buildFromTemplate([
      { label: locale === 'en' ? 'Open OCLR IRC' : locale === 'zh-Hans' ? '打开 OCLR IRC' : '開啟 OCLR IRC', click: () => this.show() },
      { type: 'separator' },
      { label: locale === 'en' ? 'Quit' : locale === 'zh-Hans' ? '退出程序' : '退出程式', click: () => app.quit() }
    ]))
  }
  hide() {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    this.foreground(false)
    // Linux desktops may accept Tray construction without displaying an indicator.
    // Keep a taskbar entry so GNOME/Wayland users can always recover the window.
    if (process.platform === 'linux' || !this.tray) window.minimize()
    else window.hide()
  }
  show() {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus(); this.foreground(true)
  }
  destroy() { this.tray?.destroy(); this.tray = null }
}

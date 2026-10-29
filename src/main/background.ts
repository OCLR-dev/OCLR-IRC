import { Menu, Tray, nativeImage } from 'electron'
import type { BrowserWindow } from 'electron'

// Native bitmap avoids external icon files disappearing from packaged builds.
function trayIcon() {
  const size = 32, pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - 15.5, y - 15.5)
    const coverage = Math.max(0, Math.min(1, 14 - radius, radius - 9))
    const dot = Math.max(0, Math.min(1, 4 - Math.hypot(x - 15.5, y - 18)))
    const offset = (y * size + x) * 4
    const color = process.platform === 'darwin' ? [0, 0, 0] : [180, 160, 255]
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]
    pixels[offset + 3] = Math.round(Math.max(coverage, dot) * 255)
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 2 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon
}

export class DesktopBackground {
  private tray: Tray | null = null
  private getWindow: () => BrowserWindow | null
  private foreground: (value: boolean) => void
  constructor(getWindow: () => BrowserWindow | null, foreground: (value: boolean) => void, quit: () => void) {
    this.getWindow = getWindow; this.foreground = foreground
    try {
      this.tray = new Tray(trayIcon())
      this.tray.setToolTip('OCLR ref tools')
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: '開啟 OCLR ref tools', click: () => this.show() },
        { type: 'separator' },
        { label: '退出程式', click: quit }
      ]))
      this.tray.on('click', () => this.show())
      this.tray.on('double-click', () => this.show())
    } catch { this.tray?.destroy(); this.tray = null }
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

import { nativeImage } from 'electron'
import { join } from 'node:path'

// resources is retained beside out/ in both development and packaged applications.
export const appIconPath = join(__dirname, '../../resources/icons/icon.png')
export function createTrayIcon() {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icons/', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-color.png'))
  if (icon.isEmpty()) throw new Error('Application icon is missing')
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon
}

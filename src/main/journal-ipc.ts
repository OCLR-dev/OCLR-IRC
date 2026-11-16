import { localize } from '../shared/localization.ts'
import type { AppLocale } from '../shared/preferences.ts'
import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { EncryptedJournal, JournalEvent } from './encrypted-journal.ts'
import type { OclrSession } from './oclr.ts'
import type { IrcSession } from './irc.ts'
import { normalize } from './protocol.ts'

/** IRC-only history. Never accepts renderer event bodies, account IDs or paths. */
export function registerJournal(journal: EncryptedJournal | null, irc: IrcSession, trusted: (event: IpcMainInvokeEvent) => void, isQuitting: () => boolean, oclr: OclrSession, invalidate: () => void, locale: () => AppLocale = () => 'zh-Hant') {
  let account: string | null = null
  let generation = 0
  const privateRooms = new Set<string>()
  // Main marks player chat at the IRC input boundary. Older rows have no marker.
  const visible = (entry: JournalEvent) => entry.matchChat === true || !privateRooms.has(normalize(entry.room))
  const markPrivateScope = (room: string) => {
    const scope = normalize(room)
    if (!privateRooms.has(scope)) {
      privateRooms.add(scope); generation++; invalidate()
      void journal?.clear(room, entry => !entry.matchChat).catch(() => {})
    }
  }
  const markPrivate = (roomId: number) => markPrivateScope(`#mp_${roomId}`)
  oclr.on('private-room', markPrivate)
  irc.on('private-room', markPrivate)
  irc.on('private-conversation', markPrivateScope)
  oclr.on('state', value => {
    if (value.relay.roomId && ['connecting', 'connected'].includes(value.relay.status)) {
      markPrivate(value.relay.roomId)
    }
  })
  const state = () => ({ enabled: journal?.isEnabled ?? true, status: journal?.status ?? 'failed', account })
  irc.on('authenticated', () => {
    const name = irc.state.username
    if (name === account) return
    generation++; account = name
    void journal?.authenticate(name).catch(() => {})
  })
  irc.on('state', value => {
    if (account && !value.username) {
      generation++; account = null; privateRooms.clear(); invalidate()
      if (!isQuitting()) void journal?.logout().catch(() => {})
    }
  })
  irc.on('message', ({ roomId, roomEpoch, message, matchChat }) => {
    if (!account || !journal) return
    const room = irc.state.rooms.find(item => item.id === roomId && item.epoch === roomEpoch)
    if (!room) return
    const entry: JournalEvent = { time: Date.parse(message.time), room: room.channel, text: `${message.sender}: ${message.text}`, ...(matchChat === true ? { matchChat: true } : {}) }
    if (visible(entry)) void journal.append(entry).catch(() => {})
  })
  function scope(value: unknown) {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !value || value.length > 128 || /[\s\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid scope')
    return value
  }
  ipcMain.handle('journal:status', event => { trusted(event); return state() })
  ipcMain.handle('journal:enabled', async (event, enabled: unknown) => {
    trusted(event)
    try {
      if (typeof enabled !== 'boolean' || !journal) throw new Error('Unavailable')
      if (enabled) await journal.enable(account ?? undefined)
      else { invalidate(); await journal.disable() }
      return { ok: true }
    } catch { return { ok: false, error: '無法更新日誌保存設定。' } }
  })
  for (const operation of ['read', 'clear', 'export'] as const) {
    ipcMain.handle(`journal:${operation}`, async (event, input: unknown) => {
      trusted(event)
      const expectedGeneration = generation
      try {
        const room = scope(input)
        if (!account || !journal) throw new Error('Unavailable')
        if (operation === 'clear') { invalidate(); await journal.clear(room); return { ok: true } }
        let entries = await journal.read(room, visible)
        if (expectedGeneration !== generation || journal.status !== 'saving') throw new Error('Unavailable')
        if (operation === 'read') return { ok: true, entries }
        const result = await dialog.showSaveDialog({ title: room ? localize(locale(), '匯出 {{v0}} 日誌（最多 1,000 則）', { v0: room }) : localize(locale(), '匯出本帳號日誌（最多 1,000 則）'), defaultPath: 'oclr-irc-history.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
        if (result.canceled || !result.filePath) return { ok: true, cancelled: true }
        if (expectedGeneration !== generation) throw new Error('Session changed')
        // Re-read after the dialog: deletion/disable/expiry while it was open must win.
        entries = await journal.read(room, visible)
        if (expectedGeneration !== generation || journal.status !== 'saving') throw new Error('Unavailable')
        await writeFile(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), scope: room ?? 'account', entries }, null, 2), { mode: 0o600 })
        return { ok: true }
      } catch { return { ok: false, error: '日誌不可用或登入已變更。' } }
    })
  }
}

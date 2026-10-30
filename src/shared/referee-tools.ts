import type { MpIntent } from './mp-command.ts'
export const MP_ACTIONS: readonly { value: MpIntent['kind']; label: string; keywords: string; risk: 'change' | 'interrupt' }[] = [
  { value: 'map', label: '換圖', keywords: 'map beatmap 地圖', risk: 'change' },
  { value: 'mods', label: '設定 Mods', keywords: 'mods 模組 freemod', risk: 'change' },
  { value: 'start', label: '開始比賽', keywords: 'start 開賽 倒數', risk: 'change' },
  { value: 'timer', label: '一般計時', keywords: 'timer 計時 倒數', risk: 'change' },
  { value: 'aborttimer', label: '取消倒數', keywords: 'aborttimer 停止計時', risk: 'interrupt' },
  { value: 'abort', label: '中止比賽', keywords: 'abort 停止比賽', risk: 'interrupt' }
]
export function searchMpActions(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return MP_ACTIONS.filter(action => terms.every(term => `${action.label} ${action.keywords}`.toLowerCase().includes(term)))
}
export const PANEL_ACTIONS = [
  { value: 'profile', label: '手動圖池與連續換圖', keywords: 'pool profile freemod 圖池 槽位 連續 mods', target: '.profile-controls' },
  { value: 'lobby', label: '房間設定', keywords: 'name rename configure size password lock unlock host close 房名 規則 容量 密碼 鎖定 房主 關房', target: '.lobby-controls' },
  { value: 'initialization', label: '連續設定房名與規則', keywords: '初始化 initialization 計畫 房名 規則', target: '.room-initialization' },
  { value: 'player', label: '手動玩家操作', keywords: 'invite move team kick 邀請 移位 分隊 移出 玩家', target: '.player-controls' },
  { value: 'lineup', label: '手動陣容核對', keywords: 'lineup roster 陣容 名單 出賽 替補', target: '.manual-lineup' }
] as const
export type WorkspaceAction = typeof MP_ACTIONS[number] | typeof PANEL_ACTIONS[number]
export function searchWorkspaceActions(query: string): WorkspaceAction[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return [...MP_ACTIONS, ...PANEL_ACTIONS].filter(action => terms.every(term => `${action.label} ${action.keywords}`.toLowerCase().includes(term)))
}
export const MESSAGE_TEMPLATES = [
  { value: 'ready', label: '確認準備', text: '請確認地圖與 Mods，準備完成後請按 Ready。' },
  { value: 'wait', label: '稍候開賽', text: '請稍候，確認完成後會通知開賽。' },
  { value: 'room', label: '目前房間', text: '本場比賽房間：{room}' },
  { value: 'thanks', label: '比賽結束', text: '感謝參賽，請等待裁判核對比賽結果。' }
] as const
export function messageTemplate(id: string, room: string) {
  const template = MESSAGE_TEMPLATES.find(item => item.value === id)
  if (!template || !/^#mp_[1-9]\d{0,15}$/.test(room)) throw new Error('無效的常用訊息或房間。')
  return template.text.replace('{room}', room)
}
export function commandSearchShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; keyCode: number; repeat: boolean }, editing: boolean, composing: boolean) {
  return !editing && !composing && !event.isComposing && event.keyCode !== 229 && !event.repeat && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
}

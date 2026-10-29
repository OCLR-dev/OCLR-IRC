import { randomUUID } from 'node:crypto'
import { redact } from './protocol.ts'
import type { Room } from '../shared/types.ts'

export function blankObservation(): Pick<Room, 'syncState' | 'observedAt' | 'beatmap' | 'mods' | 'slots' | 'phase'> {
  return { syncState: 'unknown', observedAt: null, beatmap: null, mods: null, slots: [], phase: 'unknown' }
}
export interface FieldObservation<T> {
  value: T | null
  knowledge: 'known' | 'unknown' | 'invalid'
  observedAt: string
  connectionGeneration: number
  roomEpoch: number
  source: 'settings'
  queryId: string
}

/** A bounded, query-scoped snapshot. No inferred mods, player membership or UID. */
export class SettingsCollector {
  private header = false
  private malformed = false
  private count: number | null = null
  private result: Pick<Room, 'binding' | 'name' | 'mode' | 'players' | 'beatmap' | 'mods' | 'slots'> = {
    binding: 'unknown', name: null, mode: null, players: null, beatmap: null, mods: null, slots: []
  }
  private id: number
  private readonly queryId = randomUUID()
  private readonly connectionGeneration: number
  constructor(id: number, connectionGeneration = 0) { this.id = id; this.connectionGeneration = connectionGeneration }
  observations(roomEpoch: number, timedOut = false) {
    const observedAt = new Date().toISOString()
    const field = <T>(value: T | null): FieldObservation<T> => ({
      value, knowledge: this.malformed || this.result.binding === 'mismatch' ? 'invalid' : timedOut || value === null ? 'unknown' : 'known',
      observedAt, connectionGeneration: this.connectionGeneration, roomEpoch, source: 'settings', queryId: this.queryId
    })
    return {
      name: field(this.result.name), mode: field(this.result.mode), beatmap: field(this.result.beatmap),
      mods: field(this.result.mods), players: field(this.result.players),
      slots: field(this.count !== null && this.result.slots.length === this.count ? this.result.slots.map(slot => ({ ...slot })) : null),
      capacity: field<number>(null), individualMods: field<string[]>(null), phase: field<string>(null), timer: field<number>(null)
    }
  }
  feed(body: string): boolean {
    const header = /^Room name: (.*), History: https:\/\/osu\.ppy\.sh\/(?:mp|community\/matches)\/(\d+)$/.exec(body)
    if (header) {
      if (this.header) this.malformed = true
      this.header = true; this.result.name = redact(header[1]); this.result.binding = Number(header[2]) === this.id ? 'verified' : 'mismatch'
      return false
    }
    if (!this.header) return false
    const map = /^Beatmap: https:\/\/osu\.ppy\.sh\/(?:b|beatmaps)\/(\d+) (.+)$/.exec(body)
    if (map) { if (this.result.beatmap) this.malformed = true; const id = Number(map[1]); if (Number.isSafeInteger(id) && id > 0) this.result.beatmap = { id, title: redact(map[2]) }; else this.malformed = true }
    const mode = /^Team mode: (.+), Win condition: (.+)$/.exec(body)
    if (mode) { if (this.result.mode) this.malformed = true; this.result.mode = `${mode[1]} · ${mode[2]}` }
    const mods = /^Active mods: (.*)$/.exec(body)
    if (mods) {
      if (this.result.mods !== null) this.malformed = true
      const value = mods[1].trim()
      if (/^(?:None|NoMod|No Mod)$/i.test(value)) this.result.mods = []
      else if (value) { const list = value.split(/,\s*|\s+/); if (list.length <= 32) this.result.mods = list; else this.malformed = true }
      else this.malformed = true
    }
    const count = /^Players: (\d+)$/.exec(body)
    if (count) { if (this.count !== null) this.malformed = true; const n = Number(count[1]); if (n <= 16) { this.count = n; this.result.players = n } else this.malformed = true }
    const slot = /^Slot\s+(\d+)\s+(.+?)\s+https:\/\/osu\.ppy\.sh\/(?:u|users)\/(\d+)\s+(.+?)(?:\s+\[([^\]]+)\])?$/.exec(body)
    if (slot) {
      const n = Number(slot[1]), osuId = Number(slot[3])
      if (n < 1 || n > 16 || !Number.isSafeInteger(osuId) || osuId < 1 || this.result.slots.some(s => s.slot === n || s.osuId === osuId)) this.malformed = true
      else this.result.slots.push({ slot: n, osuId, username: redact(slot[4].trim()), status: redact(slot[2].trim()), team: /Team Red/i.test(slot[5] || '') ? 'red' : /Team Blue/i.test(slot[5] || '') ? 'blue' : null, host: /\bHost\b/.test(slot[5] || '') })
    } else if (body.startsWith('Slot ')) this.malformed = true
    if (!map && !mode && !mods && !count && !slot) this.malformed = true
    return this.count !== null && this.result.slots.length === this.count
  }
  apply(room: Room, timedOut = false) {
    Object.assign(room, this.result)
    room.slots.sort((a, b) => a.slot - b.slot)
    room.observedAt = new Date().toISOString()
    room.syncState = !timedOut && !this.malformed && room.binding === 'verified' && room.mode !== null && room.beatmap !== null && room.mods !== null && this.count !== null && room.slots.length === this.count ? 'complete' : 'partial'
  }
}

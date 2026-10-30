import type { MapProfile } from './map-profile.ts'
export interface ManualPoolEntry { id: string; label: string; profile: MapProfile | null; error: string | null }
export interface ManualPoolState { revision: string; entries: ManualPoolEntry[] }
export interface ManualPoolUpdate { revision: string; entries: { id: string; label: string; profile: unknown }[] }

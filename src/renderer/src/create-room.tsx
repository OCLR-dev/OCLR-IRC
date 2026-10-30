import { roomNameSource } from '../../shared/room-name-source'
import { WorkspaceCheckbox } from './controls'
import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Label, Spinner, TextField } from '@heroui/react'
import type { Snapshot } from '../../shared/types'
export function CreateRoom({ state, onClose }: { state: Snapshot; onClose: () => void }) {
  const [name, setName] = useState('')
  const [source, setSource] = useState<ReturnType<typeof roomNameSource>>(null)
  const sourceRef = useRef<ReturnType<typeof roomNameSource>>(null)
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceError, setSourceError] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  // A form opened on a previous connection must never submit on a new one.
  const [requestId] = useState(state.creation.requestId)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waiting = state.creation.status === 'awaiting'
  const blocked = ['blocked', 'unknown'].includes(state.creation.status)
  const stale = requestId !== state.creation.requestId
  const disabled = state.connection !== 'online' || waiting || blocked || busy || stale || sourceLoading || sourceError
  useEffect(() => { if (submitted && state.creation.status === 'created') onClose() }, [submitted, state.creation.status, onClose])
  useEffect(() => {
    const api = window.oclr?.website
    if (!api) { setSourceLoading(false); return }
    let alive = true, arrived = false
    const accept = (value: Parameters<typeof roomNameSource>[0]) => {
      if (!alive) return
      const next = roomNameSource(value), previous = sourceRef.current
      if (next?.key !== previous?.key) {
        setName(next?.name ?? ''); setReviewed(false)
        setError(previous ? '場次資料已變更，請重新核對房名。' : null)
      }
      sourceRef.current = next; setSource(next); setSourceLoading(false); setSourceError(false)
    }
    const off = api.onState(value => { arrived = true; accept(value) })
    void api.snapshot().then(value => { if (!arrived) accept(value) }).catch(() => { if (alive && !arrived) { setSourceLoading(false); setSourceError(true) } })
    return () => { alive = false; off() }
  }, [])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!window.oclr || disabled || !reviewed) return
    setError(null); setBusy(true); setSubmitted(true)
    try {
      if (source) {
        const latest = window.oclr.website && roomNameSource(await window.oclr.website.snapshot())
        if (latest?.key !== source.key || sourceRef.current?.key !== source.key) {
          setReviewed(false); setSubmitted(false); setError('場次資料已變更，請關閉並重新核對。'); return
        }
      }
      const result = await window.oclr.createRoom({ name, requestId, reviewed })
      if (!result.ok) { setError(result.error || '未能建立房間。'); setSubmitted(false) }
    } catch { setError('桌面服務無法回應。請先核對房間，勿重複開房。'); setSubmitted(false) }
    finally { setBusy(false) }
  }
  return <form className="create-room-form enter" aria-label="新建比賽房間" onSubmit={submit}>
    <div className="create-room-heading"><h2>新建比賽房間</h2><Button type="button" size="sm" variant="ghost" onPress={onClose}>{waiting ? '隱藏' : '取消'}</Button></div>
    {source && <p className="create-room-help" data-room-name-source>房名來源：{source.label}</p>}
    {sourceLoading && <p role="status">正在讀取場次房名…</p>}
    {sourceError && <p role="alert">無法讀取場次，請關閉並重新開啟。</p>}
    <TextField name="matchName" value={name} onChange={value => { setName(value); setReviewed(false) }} isRequired isDisabled={disabled} className="field">
      <Label>比賽房間名稱</Label><Input autoFocus placeholder="例如 OCLR: (Team A) vs (Team B)" />
    </TextField>
    {state.creation.roomId && <p className="create-room-help">最近建立的房間：{state.creation.roomId}</p>}
    {state.creation.message && <p className={blocked ? 'error-message' : 'create-room-help'} role="status">{state.creation.message}</p>}
    {stale && !submitted && <p className="error-message" role="alert">連線或開房狀態已更新，請關閉並重新開啟此表單。</p>}
    {!blocked && <WorkspaceCheckbox name="reviewedCreation" selected={reviewed} disabled={disabled} onChange={setReviewed}>我已核對既有房間，確認需要另開新房間</WorkspaceCheckbox>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {!blocked && <Button type="submit" className="primary-button" isDisabled={disabled || !reviewed || !name.trim() || [...name.trim()].length > 50}>{waiting || busy ? <><Spinner size="sm" />等待 Bancho 確認…</> : '建立並加入'}</Button>}
  </form>
}

import React, { useRef, useState } from 'react'
import { Button, Input, TextField } from '@heroui/react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import Linkify from 'linkify-react'
import type { Snapshot } from '../../shared/types'

export function MessageList({ state, onError }: { state: Snapshot; onError: (message: string) => void }) {
  const list = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  async function openLink(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    try {
      const result = await window.oclr?.openMessageLink(event.currentTarget.href)
      if (!result?.ok) onError(result?.error || '無法開啟此連結。')
    } catch { onError('無法開啟此連結。') }
  }
  if (!state.messages.length) return <div className="message-area empty-state"><h2>連接你的比賽房間</h2><p>貼上 MP 連結，讀取設定、裁判名單並聊天。<br />比賽變更指令尚未開放。</p></div>
  return <div className="message-area" role="region" aria-label="IRC 訊息">
    <Virtuoso ref={list} className="message-list" data={state.messages}
      firstItemIndex={state.messageStartIndex}
      computeItemKey={(_index, message) => message.id}
      initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
      defaultItemHeight={32} minOverscanItemCount={2} followOutput="auto" atBottomStateChange={setAtBottom} atBottomThreshold={50}
      itemContent={(_index, message) => <div className={`message-row ${message.kind}`}>
        <time dateTime={message.time}>{new Date(message.time).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <span className="message-sender" title={message.sender}>{message.sender}</span>
        <span className="message-text"><Linkify options={{ validate: { email: false, url: (value: string) => !/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(value) }, attributes: { onClick: openLink, onAuxClick: (event: React.MouseEvent) => event.preventDefault() } }}>{message.text}</Linkify>
          {message.delivery === 'unconfirmed' && <span className="delivery-note" title="已交給本機連線，伺服器尚未確認送達">未確認送達</span>}
        </span>
      </div>} />
    {!atBottom && <button type="button" className="jump-latest" onClick={() => list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })}>回到最新訊息 ↓</button>}
  </div>
}

export function Composer({ state, onError }: { state: Snapshot; onError: (message: string | null) => void }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const locked = useRef(false)
  const composing = useRef(false)
  const room = state.room
  const available = state.connection === 'online' && room?.joined
  const bytes = new TextEncoder().encode(`PRIVMSG ${room?.channel || ''} :${draft.trim()}`).length
  const prohibited = /^[!／/]/u.test(draft.trim()) || /[\x00-\x1f\x7f]/.test(draft)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!window.oclr || !available || !room || locked.current || composing.current || !draft.trim() || prohibited || bytes > 510) return
    locked.current = true; setSending(true); onError(null)
    const submitted = draft
    try {
      const result = await window.oclr.chat({ roomId: room.id, roomEpoch: room.epoch, text: submitted })
      if (result.ok) setDraft(current => current === submitted ? '' : current)
      else onError(result.error || '訊息未送出。')
    } catch { onError('送出結果不明，請先核對房間訊息；不會自動重送。') }
    finally { locked.current = false; setSending(false) }
  }
  return <form className="composer" onSubmit={submit}>
    <div className="composer-controls"><TextField aria-label="房間聊天訊息" value={draft} onChange={setDraft} isDisabled={!available || sending} className="chat-field">
      <Input name="chat" placeholder={available ? `傳送至 ${room.channel}` : '加入房間後即可聊天'} maxLength={510} autoComplete="off"
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || composing.current || event.keyCode === 229)) event.preventDefault() }} />
    </TextField><Button type="submit" className="primary-button" isDisabled={!available || sending || Boolean(state.pending) || !draft.trim() || prohibited || bytes > 510}>{sending ? '傳送中…' : '傳送'}</Button></div>
    <div className="composer-help"><span>{prohibited ? '僅支援一般聊天，不接受指令或換行。' : 'Enter 傳送 · 指令尚未開放'}</span><span className={bytes > 510 ? 'over-limit' : ''}>{bytes} / 510 bytes</span></div>
  </form>
}

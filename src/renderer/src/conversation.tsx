import { chatLines, chatBytes, MAX_CHAT_DRAFT } from '../../shared/chat'
import { tr, uiLocale } from './i18n'
import { MESSAGE_TEMPLATES, messageTemplate } from '../../shared/referee-tools'
import { WorkspaceSelect } from './controls'
import React, { useEffect, useRef, useState } from 'react'
import { Button, TextArea, TextField } from '@heroui/react'
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
  if (!state.messages.length) return <div className="message-area empty-state"><h2>{tr("連接你的比賽房間")}</h2></div>
  return <div className="message-area" role="region" aria-label={tr("IRC 訊息")}>
    <Virtuoso ref={list} className="message-list" data={state.messages}
      firstItemIndex={state.messageStartIndex}
      computeItemKey={(_index, message) => message.id}
      initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
      defaultItemHeight={32} minOverscanItemCount={2} followOutput="auto" atBottomStateChange={setAtBottom} atBottomThreshold={50}
      itemContent={(_index, message) => <div className={`message-row ${message.kind}`}>
        <time dateTime={message.time}>{new Date(message.time).toLocaleTimeString(uiLocale(), { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <span className="message-sender" title={message.kind === 'system' ? tr(message.sender) : message.sender}>{message.kind === 'system' ? tr(message.sender) : message.sender}</span>
        <span className="message-text"><Linkify options={{ validate: { email: false, url: (value: string) => !/^(?!https?:)[a-z][a-z\d+.-]*:/i.test(value) }, attributes: { onClick: openLink, onAuxClick: (event: React.MouseEvent) => event.preventDefault() } }}>{message.kind === 'system' ? tr(message.text) : message.text}</Linkify>
          {message.delivery === 'sent' && <span className="delivery-note">{tr("已送出")}</span>}
          {message.delivery === 'unknown' && <span className="delivery-note">{tr("傳送結果待核對")}</span>}
          {message.delivery === 'unconfirmed' && <span className="delivery-note">{tr("執行結果待核對")}</span>}
        </span>
      </div>} />
    {!atBottom && <button type="button" className="jump-latest" onClick={() => list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })}>{tr("回到最新訊息 ↓")}</button>}
  </div>
}
export function Composer({ state, onError }: { state: Snapshot; onError: (message: string | null) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftKey = state.room ? JSON.stringify([state.username, state.room.id]) : ''
  const draft = drafts[draftKey] || ''
  const setDraft = (value: React.SetStateAction<string>) => setDrafts(current => {
    const text = typeof value === 'function' ? value(current[draftKey] || '') : value
    return text === current[draftKey] ? current : {...current, [draftKey]: text}
  })
  useEffect(() => {
    const active = new Set(state.rooms.map(room => JSON.stringify([state.username, room.id])))
    setDrafts(current => Object.keys(current).every(key => active.has(key)) ? current : Object.fromEntries(Object.entries(current).filter(([key]) => active.has(key))))
  }, [state.rooms, state.username])
  const [template, setTemplate] = useState('ready')
  const [sending, setSending] = useState(false)
  const locked = useRef(false)
  const composing = useRef(false)
  const room = state.room
  const available = state.connection === 'online' && room?.joined && !(room.kind === 'private' && room.channel.toLowerCase() === 'banchobot')
  const bytes = Math.max(0, ...draft.replace(/\r\n?/g, '\n').split('\n').map(line => chatBytes(line, room?.channel || '')))
  let validation = ''
  try { if (draft.trim()) chatLines(draft, room?.channel || '') } catch (error) { validation = error instanceof Error ? error.message : '訊息未送出。' }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!window.oclr || !available || !room || locked.current || composing.current || !draft.trim() || Boolean(validation) || bytes > 510) return
    locked.current = true; setSending(true); onError(null)
    const submitted = draft
    try {
      const result = await window.oclr.chat({ roomId: room.id, roomEpoch: room.epoch, text: submitted })
      if (result.ok || result.remainingText !== undefined) setDraft(current => current === submitted ? result.remainingText || '' : current)
      if (!result.ok) onError(result.error || '訊息未送出。')
    } catch { onError('送出結果不明，請先核對房間訊息；不會自動重送。') }
    finally { locked.current = false; setSending(false) }
  }
  return <form className="composer" onSubmit={submit}>
    {room?.kind === 'match' && <details className="composer-templates"><summary>{tr("常用訊息")}</summary><div>
      <WorkspaceSelect label={tr("常用訊息")} value={template} onChange={setTemplate} disabled={!available || sending} options={MESSAGE_TEMPLATES.map(({ value, label }) => ({ value, label: tr(label) }))} />
      <Button type="button" size="sm" variant="secondary" isDisabled={!available || sending} onPress={() => {
        try {
          const text = [draft, messageTemplate(template, room.channel)].filter(Boolean).join(' ')
          chatLines(text, room.channel)
          setDraft(text); onError(null)
        } catch { onError('無法插入常用訊息。') }
      }}>{tr("插入草稿")}</Button>
    </div></details>}

    <div className="composer-controls"><TextField aria-label={tr("房間聊天訊息")} value={draft} onChange={setDraft} isDisabled={!available || sending} className="chat-field">
      <TextArea name="chat" rows={Math.min(4, draft.split('\n').length)} placeholder={available ? tr("傳送至 {{v0}}", { v0: room.channel }) : room?.kind === 'private' && room.channel.toLowerCase() === 'banchobot' ? tr("BanchoBot 私訊僅供讀取") : tr("加入房間後即可聊天")} maxLength={MAX_CHAT_DRAFT} autoComplete="off"
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onKeyDown={event => {
          if (event.key === 'Tab' && !event.nativeEvent.isComposing && !composing.current && event.currentTarget.selectionStart === draft.length) {
            const token = /(?:^|\s)([^\s]+)$/.exec(draft)?.[1]
            const candidates = [...new Set([...(room?.members || []), ...(room?.slots.map(s => s.username.replaceAll(' ', '_')) || []), ...state.messages.filter(m => m.kind === 'chat').map(m => m.sender)])]
            const found = token && candidates.filter(n => n.toLowerCase().startsWith(token.toLowerCase())).sort()[0]
            if (found) { event.preventDefault(); setDraft(draft.slice(0, -token.length) + found + (draft === token ? ': ' : ' ')) }
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (!event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) event.currentTarget.form?.requestSubmit()
          } }} />
    </TextField><Button type="submit" className="primary-button" isDisabled={!available || sending || !draft.trim() || Boolean(validation) || bytes > 510}>{sending ? tr("傳送中…") : tr("傳送")}</Button></div>
    <div className="composer-help"><span>{validation ? tr(validation) : tr("Enter 傳送 · Shift+Enter 換行")}</span><span className={bytes > 510 ? 'over-limit' : ''}>{bytes} / 510 bytes</span></div>
  </form>
}

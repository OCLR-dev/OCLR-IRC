import { Tabs } from '@heroui/react'
import { JournalView } from './journal'
import { OperationsView } from './operations'
import { tr } from './i18n'
import type { Snapshot } from '../../shared/types'

export type RecordsTab = 'chat' | 'operations'

export function RecordsView({ state, tab, onTabChange }: { state: Snapshot; tab: RecordsTab; onTabChange: (tab: RecordsTab) => void }) {
  return <section className="records-view enter">
    <h1>{tr('記錄中心')}</h1>
    <Tabs aria-label={tr('記錄分類')} selectedKey={tab} onSelectionChange={key => { if (key === 'chat' || key === 'operations') onTabChange(key) }}>
      <Tabs.ListContainer><Tabs.List aria-label={tr('記錄分類')}>
        <Tabs.Tab id="chat" data-records-tab="chat">{tr('聊天日誌')}<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="operations" data-records-tab="operations">{tr('操作記錄')}<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="chat" shouldForceMount><JournalView embedded active={tab === 'chat'} /></Tabs.Panel>
      <Tabs.Panel id="operations">{tab === 'operations' && <OperationsView state={state} embedded />}</Tabs.Panel>
    </Tabs>
  </section>
}

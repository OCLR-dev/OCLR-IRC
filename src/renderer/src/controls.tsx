import { Icon } from './icons'
import { Button, Checkbox, Label, ListBox, Select, Tooltip } from '@heroui/react'
import type { ReactNode } from 'react'

export function WorkspaceSelect({ label, value, onChange, options, disabled, className = '' }: {
  label: string; value: string; onChange: (value: string) => void
  options: readonly { value: string; label: string }[]; disabled?: boolean; className?: string
}) {
  return <Select aria-label={label} selectedKey={value || null} onSelectionChange={key => { if (key !== null) onChange(String(key)) }} isDisabled={disabled} className={`workspace-select ${className}`} placeholder={label}>
    <Select.Trigger aria-label={label}><Select.Value /><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{options.map(option => <ListBox.Item key={option.value} id={option.value} textValue={option.label}><Label>{option.label}</Label><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
  </Select>
}

export function WorkspaceCheckbox({ children, selected, onChange, disabled, name }: {
  children: ReactNode; selected: boolean; onChange: (selected: boolean) => void; disabled?: boolean; name?: string
}) {
  return <Checkbox className="workspace-checkbox" isSelected={selected} onChange={onChange} isDisabled={disabled} name={name}>
    <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Label>{children}</Label></Checkbox.Content>
  </Checkbox>
}

export function RefreshButton({ label, disabled, busy, onPress, variant = 'ghost' }: {
  label: string; disabled?: boolean; busy?: boolean; onPress: () => void; variant?: 'ghost' | 'secondary'
}) {
  return <Tooltip delay={400}><Button type="button" isIconOnly size="sm" variant={variant} className="refresh-button" aria-label={label} aria-busy={busy || undefined} isDisabled={disabled || busy} onPress={onPress}><Icon name="refresh" /></Button><Tooltip.Content>{label}</Tooltip.Content></Tooltip>
}

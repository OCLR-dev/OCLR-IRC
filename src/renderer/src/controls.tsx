import { Checkbox, Label, ListBox, Select } from '@heroui/react'
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

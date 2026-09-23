import { Select } from 'antd'
import { CURRENCY_LABELS, SUPPORTED_CURRENCIES } from '../lib/currency'

type Props = {
  value?: string
  onChange?: (value: string | undefined) => void
  allowClear?: boolean
  placeholder?: string
  style?: React.CSSProperties
  disabled?: boolean
}

export function CurrencySelect({
  value,
  onChange,
  allowClear = false,
  placeholder = '选择币种',
  style,
  disabled,
}: Props) {
  return (
    <Select
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder}
      value={value}
      style={{ minWidth: 180, ...style }}
      optionFilterProp="label"
      options={SUPPORTED_CURRENCIES.map((code) => ({
        value: code,
        label: CURRENCY_LABELS[code] ?? code,
      }))}
      onChange={(v) => onChange?.(v)}
    />
  )
}

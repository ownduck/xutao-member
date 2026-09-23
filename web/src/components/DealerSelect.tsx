import { Select } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { api, type FinanceDealer } from '../lib/api'

type Props = {
  value?: string
  onChange?: (value: string | undefined) => void
  allowClear?: boolean
  placeholder?: string
  style?: React.CSSProperties
}

export function DealerSelect({
  value,
  onChange,
  allowClear = true,
  placeholder = '选择经销商',
  style,
}: Props) {
  const [dealers, setDealers] = useState<FinanceDealer[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void api
      .listDealers()
      .then((list) => {
        if (!cancelled) setDealers(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setDealers([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const options = useMemo(
    () =>
      dealers.map((d) => ({
        value: d.id,
        label: `${d.realname || d.name} (${d.email})`,
      })),
    [dealers],
  )

  return (
    <Select
      showSearch
      virtual
      allowClear={allowClear}
      loading={loading}
      placeholder={placeholder}
      value={value}
      style={{ minWidth: 240, ...style }}
      options={options}
      optionFilterProp="label"
      onChange={(v) => onChange?.(v)}
    />
  )
}

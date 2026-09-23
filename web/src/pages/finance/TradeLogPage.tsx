import { Button, Card, Select, Space, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DealerSelect } from '../../components/DealerSelect'
import { api, type FinanceTradeLog } from '../../lib/api'
import { formatMoney, WALLET_CURRENCY } from '../../lib/currency'
import { useAuth } from '../../lib/auth-context'

export function TradeLogPage() {
  const { can } = useAuth()
  const canFilterDealer = can('recharge', 'ro')
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FinanceTradeLog[]>([])
  const [userId, setUserId] = useState<string | undefined>(
    searchParams.get('userId') || undefined,
  )
  const [direction, setDirection] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listTradeLogs({ userId, direction })
      setRows(Array.isArray(list) ? list : [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载流水失败')
    } finally {
      setLoading(false)
    }
  }, [userId, direction])

  useEffect(() => {
    void load()
  }, [load])

  const columns: ColumnsType<FinanceTradeLog> = [
    { title: '流水号', dataIndex: 'tradeNumber', width: 160 },
    { title: '用户', dataIndex: 'userName' },
    {
      title: '方向',
      dataIndex: 'direction',
      width: 80,
      render: (v: string) =>
        v === 'in' ? <Tag color="green">收入</Tag> : <Tag color="red">支出</Tag>,
    },
    {
      title: '币种',
      dataIndex: 'currencyCode',
      width: 80,
      render: (v?: string) => v || WALLET_CURRENCY,
    },
    {
      title: '原币金额',
      dataIndex: 'amount',
      render: (v: string, r) => formatMoney(v, r.currencyCode),
    },
    {
      title: '折算 USD',
      dataIndex: 'amountBase',
      render: (v?: string) => formatMoney(v ?? 0, WALLET_CURRENCY),
    },
    {
      title: '余额(USD)',
      dataIndex: 'balance',
      render: (v: string) => formatMoney(v, WALLET_CURRENCY),
    },
    { title: '关联单号', dataIndex: 'orderNumber', render: (v) => v || '—' },
    { title: '说明', dataIndex: 'info', render: (v) => v || '—' },
    {
      title: '时间',
      dataIndex: 'createTime',
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
  ]

  return (
    <Card title="账户变动">
      <Space style={{ marginBottom: 16 }} wrap>
        {canFilterDealer ? (
          <DealerSelect value={userId} onChange={setUserId} />
        ) : null}
        <Select
          allowClear
          placeholder="方向"
          style={{ width: 120 }}
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'in', label: '收入' },
            { value: 'out', label: '支出' },
          ]}
        />
        <Button type="primary" onClick={() => void load()}>
          查询
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 20 }}
      />
    </Card>
  )
}

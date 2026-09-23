import { Button, Card, Space, Table, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DealerSelect } from '../../components/DealerSelect'
import { api, type FinanceWallet } from '../../lib/api'
import { formatMoney, WALLET_CURRENCY } from '../../lib/currency'
import { useAuth } from '../../lib/auth-context'

export function WalletPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const canFilterDealer = can('recharge', 'ro')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FinanceWallet[]>([])
  const [userId, setUserId] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listWallets(userId)
      setRows(Array.isArray(list) ? list : [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载钱包失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const columns: ColumnsType<FinanceWallet> = [
    { title: '钱包编号', dataIndex: 'walletCode' },
    {
      title: '经销商',
      render: (_, r) =>
        r.user?.realname || r.user?.name || r.user?.email || r.userId,
    },
    {
      title: '币种',
      dataIndex: 'currencyCode',
      width: 80,
      render: (v?: string) => v || WALLET_CURRENCY,
    },
    {
      title: '余额',
      dataIndex: 'balance',
      render: (v: string, r) =>
        formatMoney(v, r.currencyCode || WALLET_CURRENCY),
    },
    {
      title: '最近交易',
      dataIndex: 'lastTradeTime',
      render: (v?: string | null) =>
        v ? new Date(v).toLocaleString() : '—',
    },
    {
      title: '操作',
      width: 120,
      render: (_, r) => (
        <Button
          type="link"
          onClick={() =>
            navigate(`/finance/trade-log?userId=${encodeURIComponent(r.userId)}`)
          }
        >
          变动明细
        </Button>
      ),
    },
  ]

  return (
    <Card title="钱包">
      {canFilterDealer ? (
        <Space style={{ marginBottom: 16 }} wrap>
          <DealerSelect value={userId} onChange={setUserId} />
          <Button type="primary" onClick={() => void load()}>
            查询
          </Button>
        </Space>
      ) : null}
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
      />
    </Card>
  )
}

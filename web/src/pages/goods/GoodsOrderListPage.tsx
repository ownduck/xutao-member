import { Button, Card, Select, Space, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DealerSelect } from '../../components/DealerSelect'
import { api, type GoodsOrder } from '../../lib/api'
import { GOODS_STATUS_LABEL } from '../../lib/goods-status'
import { useAuth } from '../../lib/auth-context'

type Mode = 'reserve' | 'fulfill' | 'history'

const PAGE_SIZE = 20

export function GoodsOrderListPage({ mode }: { mode: Mode }) {
  const { can, isOps } = useAuth()
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<GoodsOrder[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>()
  const [dealerUserId, setDealerUserId] = useState<string>()

  const title =
    mode === 'reserve'
      ? '预约订单'
      : mode === 'fulfill'
        ? '履约订单'
        : '历史订单'

  const load = useCallback(async () => {
    setRows([])
    setLoading(true)
    try {
      const query = { page, pageSize: PAGE_SIZE }
      const res =
        mode === 'reserve'
          ? await api.listReserveOrders({ status, ...query })
          : mode === 'fulfill'
            ? await api.listFulfillOrders({ dealerUserId, status, ...query })
            : await api.listHistoryOrders({ dealerUserId, ...query })
      setRows(Array.isArray(res.items) ? res.items : [])
      setTotal(res.total ?? 0)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [mode, status, dealerUserId, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [mode])

  const detailBase =
    mode === 'fulfill'
      ? '/goods/fulfill'
      : mode === 'history'
        ? '/goods/history'
        : '/goods/reserve'

  const statusOptions =
    mode === 'reserve'
      ? [
          { value: 'reserving', label: '预约中' },
          { value: 'pending_fulfill', label: '待履约' },
          { value: 'partial_fulfill', label: '部分履约' },
          { value: 'fulfilled', label: '已履约' },
        ]
      : mode === 'fulfill'
        ? [
            { value: 'pending_fulfill', label: '待履约' },
            { value: 'partial_fulfill', label: '部分履约' },
            { value: 'fulfilled', label: '已履约' },
          ]
        : []

  const columns: ColumnsType<GoodsOrder> = [
    { title: '订单号', dataIndex: 'orderNumber', width: 160 },
    {
      title: '经销商',
      render: (_, r) =>
        r.dealer?.realname || r.dealer?.name || r.dealer?.email || r.dealerUserId,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => {
        const m = GOODS_STATUS_LABEL[v] ?? { text: v, color: 'default' }
        return <Tag color={m.color}>{m.text}</Tag>
      },
    },
    ...(mode === 'reserve'
      ? [
          {
            title: '价格',
            dataIndex: 'priceStatus',
            width: 100,
            render: (v: number | undefined) =>
              v === 1 ? (
                <Tag color="success">已齐</Tag>
              ) : (
                <Tag>未齐</Tag>
              ),
          } as ColumnsType<GoodsOrder>[number],
        ]
      : []),
    { title: '币种', dataIndex: 'currencyCode', width: 80 },
    {
      title: '商品行',
      dataIndex: 'itemCount',
      width: 80,
    },
    {
      title: '预约量',
      dataIndex: 'reserveQtyTotal',
      width: 80,
    },
    {
      title: '履约量',
      dataIndex: 'fulfillQtyTotal',
      width: 80,
    },
    {
      title: '创建时间',
      dataIndex: 'createTime',
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '操作',
      width: 100,
      render: (_, r) => (
        <Link to={`${detailBase}/${r.id}`}>查看</Link>
      ),
    },
  ]

  const showDealerFilter =
    (mode === 'fulfill' || mode === 'history') &&
    (isOps() || can('goods_fulfill_order', 'ro'))

  return (
    <Card title={title}>
      <Space style={{ marginBottom: 16 }} wrap>
        {showDealerFilter ? (
          <DealerSelect
            value={dealerUserId}
            onChange={(v) => {
              setDealerUserId(v)
              setPage(1)
            }}
          />
        ) : null}
        {statusOptions.length ? (
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 140 }}
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={statusOptions}
          />
        ) : null}
        <Button type="primary" onClick={() => void load()}>
          查询
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (p) => setPage(p),
        }}
      />
    </Card>
  )
}

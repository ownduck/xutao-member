import {
  Button,
  Card,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type GoodsOrder, type GoodsOrderItem } from '../../lib/api'
import { formatMoney } from '../../lib/currency'
import { GOODS_STATUS_LABEL } from '../../lib/goods-status'
import { useAuth } from '../../lib/auth-context'

type Mode = 'reserve' | 'fulfill' | 'history'

type DraftItem = {
  id: number
  unitPrice: number | null
  reserveQty: number
  fulfillQty: number
  confirmedPrice?: number | null
  dirtyPrice?: boolean
  prevPrice?: number | null
}

export function GoodsOrderDetailPage({ mode }: { mode: Mode }) {
  const { id } = useParams()
  const orderId = Number(id)
  const navigate = useNavigate()
  const { isDealer, isOps, can } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncingEmpty, setSyncingEmpty] = useState(false)
  const [syncingItemId, setSyncingItemId] = useState<number | null>(null)
  const [order, setOrder] = useState<GoodsOrder | null>(null)
  const [remark, setRemark] = useState('')
  const [drafts, setDrafts] = useState<Record<number, DraftItem>>({})

  const load = useCallback(async () => {
    if (!Number.isFinite(orderId)) return
    setLoading(true)
    try {
      const data = await api.getGoodsOrder(orderId)
      setOrder(data)
      setRemark(data.dealerRemark ?? '')
      const map: Record<number, DraftItem> = {}
      for (const it of data.items ?? []) {
        const price =
          it.unitPrice == null ? null : Number(it.unitPrice)
        map[it.id] = {
          id: it.id,
          unitPrice: price,
          reserveQty: it.reserveQty,
          fulfillQty: it.fulfillQty,
          confirmedPrice: price,
          dirtyPrice: false,
          prevPrice: price,
        }
      }
      setDrafts(map)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  const canEditPrice =
    mode === 'reserve' &&
    order?.status === 'reserving' &&
    (isDealer() || can('goods_reserve_order', 'rw'))

  const canEditFulfill =
    mode === 'fulfill' &&
    order &&
    ['pending_fulfill', 'partial_fulfill', 'fulfilled'].includes(order.status) &&
    (isOps() || can('goods_fulfill_order', 'rw'))

  const readOnly = mode === 'history' || (!canEditPrice && !canEditFulfill)

  const statusMeta = order
    ? GOODS_STATUS_LABEL[order.status] ?? {
        text: order.status,
        color: 'default',
      }
    : null

  const items = useMemo(() => order?.items ?? [], [order])

  function applySyncedPrice(
    itemId: number,
    unitPrice: number,
    usdPrice?: number,
    currencyCode?: string,
  ) {
    setDrafts((prev) => {
      const cur = prev[itemId]
      if (!cur) return prev
      return {
        ...prev,
        [itemId]: {
          ...cur,
          unitPrice,
          dirtyPrice: true,
        },
      }
    })
    if (usdPrice != null && currencyCode) {
      message.success(
        `已抓取 $${usdPrice.toFixed(2)} → ${currencyCode} ${unitPrice.toFixed(2)}`,
      )
    }
  }

  async function handleSyncItem(itemId: number) {
    if (!order) return
    setSyncingItemId(itemId)
    try {
      const res = await api.syncGoodsItemPrice(order.id, itemId)
      applySyncedPrice(itemId, res.unitPrice, res.usdPrice, res.currencyCode)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '同步价格失败')
    } finally {
      setSyncingItemId(null)
    }
  }

  async function handleSyncBatch(modeSync: 'all' | 'empty') {
    if (!order) return
    if (modeSync === 'all') setSyncingAll(true)
    else setSyncingEmpty(true)
    try {
      const res = await api.syncGoodsPrices(order.id, modeSync)
      let okCount = 0
      for (const r of res.results) {
        if (r.ok && r.unitPrice != null) {
          okCount += 1
          setDrafts((prev) => {
            const cur = prev[r.itemId]
            if (!cur) return prev
            return {
              ...prev,
              [r.itemId]: {
                ...cur,
                unitPrice: r.unitPrice!,
                dirtyPrice: true,
              },
            }
          })
        }
      }
      const fail = res.results.filter((r) => !r.ok)
      if (okCount) {
        message.success(`已同步 ${okCount} 行价格（需点确定后保存）`)
      }
      if (fail.length) {
        message.warning(
          `${fail.length} 行失败：${fail[0]?.error || '未知错误'}`,
        )
      }
      if (!okCount && !fail.length) {
        message.info('没有需要同步的商品行')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '批量同步失败')
    } finally {
      if (modeSync === 'all') setSyncingAll(false)
      else setSyncingEmpty(false)
    }
  }

  const columns: ColumnsType<GoodsOrderItem> = [
    {
      title: 'Amazon URL',
      dataIndex: 'amazonUrl',
      render: (v: string) => (
        <Typography.Link href={v} target="_blank" rel="noreferrer">
          {v}
        </Typography.Link>
      ),
    },
    {
      title: '预约数量',
      width: 120,
      render: (_, row) => {
        const d = drafts[row.id]
        if (!d) return row.reserveQty
        if (!canEditPrice) return d.reserveQty
        return (
          <InputNumber
            min={1}
            precision={0}
            style={{ width: 100 }}
            value={d.reserveQty}
            onChange={(v) => {
              setDrafts((prev) => ({
                ...prev,
                [row.id]: {
                  ...prev[row.id],
                  reserveQty: v == null ? 1 : Math.max(1, Number(v)),
                },
              }))
            }}
          />
        )
      },
    },
    {
      title: `单价 (${order?.currencyCode ?? ''})`,
      width: 320,
      render: (_, row) => {
        const d = drafts[row.id]
        if (!d) return '—'
        if (!canEditPrice) {
          return d.unitPrice == null
            ? '—'
            : formatMoney(d.unitPrice, order?.currencyCode)
        }
        return (
          <Space wrap>
            <InputNumber
              min={0}
              precision={2}
              style={{ width: 120 }}
              value={d.unitPrice ?? undefined}
              onChange={(v) => {
                setDrafts((prev) => ({
                  ...prev,
                  [row.id]: {
                    ...prev[row.id],
                    unitPrice: v == null ? null : Number(v),
                    dirtyPrice: true,
                  },
                }))
              }}
              onBlur={() => {
                setDrafts((prev) => {
                  const cur = prev[row.id]
                  if (!cur) return prev
                  const changed =
                    Number(cur.unitPrice ?? NaN) !==
                    Number(cur.confirmedPrice ?? NaN)
                  return {
                    ...prev,
                    [row.id]: { ...cur, dirtyPrice: changed },
                  }
                })
              }}
            />
            <Button
              size="small"
              loading={syncingItemId === row.id}
              disabled={syncingAll || syncingEmpty}
              onClick={() => void handleSyncItem(row.id)}
            >
              同步价格
            </Button>
            {d.dirtyPrice ? (
              <Space size={4}>
                <Button
                  size="small"
                  onClick={() => {
                    setDrafts((prev) => ({
                      ...prev,
                      [row.id]: {
                        ...prev[row.id],
                        unitPrice: prev[row.id].confirmedPrice ?? null,
                        dirtyPrice: false,
                      },
                    }))
                  }}
                >
                  恢复
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    setDrafts((prev) => ({
                      ...prev,
                      [row.id]: {
                        ...prev[row.id],
                        confirmedPrice: prev[row.id].unitPrice,
                        dirtyPrice: false,
                      },
                    }))
                  }}
                >
                  确定
                </Button>
              </Space>
            ) : null}
          </Space>
        )
      },
    },
    {
      title: '履约数量',
      width: 200,
      render: (_, row) => {
        const d = drafts[row.id]
        if (!d) return row.fulfillQty
        if (!canEditFulfill) return d.fulfillQty
        const mismatch = d.fulfillQty > 0 && d.fulfillQty !== d.reserveQty
        return (
          <Space>
            <InputNumber
              min={0}
              precision={0}
              style={{ width: 100 }}
              value={d.fulfillQty}
              onChange={(v) => {
                setDrafts((prev) => ({
                  ...prev,
                  [row.id]: {
                    ...prev[row.id],
                    fulfillQty: v == null ? 0 : Number(v),
                  },
                }))
              }}
            />
            {mismatch ? (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                与预约 {d.reserveQty} 不一致
              </Typography.Text>
            ) : null}
          </Space>
        )
      },
    },
  ]

  async function handleSave() {
    if (!order) return
    if (canEditPrice) {
      const dirty = Object.values(drafts).some((d) => d.dirtyPrice)
      if (dirty) {
        message.warning('请先对变更的单价点击「确定」或「恢复」')
        return
      }
    }
    setSaving(true)
    try {
      const body =
        canEditPrice
          ? {
              dealerRemark: remark,
              items: Object.values(drafts).map((d) => ({
                id: d.id,
                unitPrice: d.confirmedPrice ?? d.unitPrice,
                reserveQty: d.reserveQty,
              })),
            }
          : {
              items: Object.values(drafts).map((d) => ({
                id: d.id,
                fulfillQty: d.fulfillQty,
              })),
            }
      const saved = await api.updateGoodsOrder(order.id, body)
      setOrder(saved)
      message.success('已保存')
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleSubmitFulfill() {
    if (!order) return
    const missing = Object.values(drafts).some(
      (d) => d.confirmedPrice == null && d.unitPrice == null,
    )
    if (missing) {
      message.error('请填写全部商品单价')
      return
    }
    Modal.confirm({
      title: '提交履约',
      content: '提交后订单进入「待履约」，单价将不可再修改。确认？',
      onOk: async () => {
        await handleSave()
        await api.submitGoodsFulfill(order.id)
        message.success('已提交履约')
        await load()
      },
    })
  }

  function handleSubmitComplete() {
    if (!order) return
    const isPartial = order.status === 'partial_fulfill'
    Modal.confirm({
      title: '提交完成并生成扣费',
      content: isPartial
        ? '当前为「部分履约」。未履约（履约数量为 0）的商品将不计入扣费金额。确认提交完成？'
        : '提交后订单变为已完成，并生成待审核扣费单。确认？',
      okText: isPartial ? '确认部分履约完成' : '确认提交',
      onOk: async () => {
        const res = await api.submitGoodsComplete(order.id)
        message.success('已完成，扣费单已生成')
        navigate(`/goods/history/${res.order.id}`)
      },
    })
  }

  if (!order && loading) {
    return <Card loading />
  }
  if (!order) {
    return <Card>订单不存在</Card>
  }

  return (
    <Card
      loading={loading}
      title={
        <Space>
          <span>订单 {order.orderNumber}</span>
          {statusMeta ? (
            <Tag color={statusMeta.color}>{statusMeta.text}</Tag>
          ) : null}
          {order.priceStatus === 1 ? (
            <Tag color="success">价格已填完</Tag>
          ) : canEditPrice ? (
            <Tag>价格未齐</Tag>
          ) : null}
        </Space>
      }
      extra={
        <Space>
          {!readOnly ? (
            <Button loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          ) : null}
          {canEditPrice ? (
            <Button type="primary" onClick={handleSubmitFulfill}>
              提交履约
            </Button>
          ) : null}
          {canEditFulfill &&
          (order.status === 'partial_fulfill' ||
            order.status === 'fulfilled') ? (
            <Button type="primary" onClick={handleSubmitComplete}>
              提交完成
            </Button>
          ) : null}
        </Space>
      }
    >
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="经销商">
          {order.dealer?.realname ||
            order.dealer?.name ||
            order.dealer?.email ||
            order.dealerUserId}
        </Descriptions.Item>
        <Descriptions.Item label="币种">{order.currencyCode}</Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {order.createTime
            ? new Date(order.createTime).toLocaleString()
            : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="扣费单">
          {order.deductionId ? (
            <Link to="/finance/deduction">{order.deduction?.deductionNumber || order.deductionId}</Link>
          ) : (
            '—'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="经销商备注" span={2}>
          {canEditPrice ? (
            <Input.TextArea
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          ) : (
            order.dealerRemark || '—'
          )}
        </Descriptions.Item>
        {order.totalAmount ? (
          <Descriptions.Item label="扣费原币金额" span={2}>
            {formatMoney(order.totalAmount, order.currencyCode)}
            {order.totalAmountBase
              ? `（折合 USD ${Number(order.totalAmountBase).toFixed(2)}）`
              : ''}
          </Descriptions.Item>
        ) : null}
      </Descriptions>

      {canEditPrice ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Button
            loading={syncingAll}
            disabled={syncingEmpty || syncingItemId != null}
            onClick={() => void handleSyncBatch('all')}
          >
            同步全部价格
          </Button>
          <Button
            loading={syncingEmpty}
            disabled={syncingAll || syncingItemId != null}
            onClick={() => void handleSyncBatch('empty')}
          >
            同步未填价格
          </Button>
        </Space>
      ) : null}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={items}
        pagination={false}
      />
    </Card>
  )
}

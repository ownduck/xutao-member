import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useState } from 'react'
import { CurrencySelect } from '../../components/CurrencySelect'
import { DealerSelect } from '../../components/DealerSelect'
import { api, type FinanceRecharge } from '../../lib/api'
import { formatMoney, WALLET_CURRENCY } from '../../lib/currency'
import { useAuth } from '../../lib/auth-context'

const verifyLabel: Record<number, { text: string; color: string }> = {
  0: { text: '待审核', color: 'orange' },
  1: { text: '已通过', color: 'green' },
  2: { text: '已拒绝', color: 'red' },
}

export function RechargePage() {
  const { can, user } = useAuth()
  const canWrite = can('recharge', 'rw')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FinanceRecharge[]>([])
  const [userId, setUserId] = useState<string>()
  const [isVerify, setIsVerify] = useState<string>()
  const [defaultCurrency, setDefaultCurrency] = useState(WALLET_CURRENCY)

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm] = Form.useForm<{
    userId: string
    amount: number
    currencyCode: string
    remark?: string
  }>()

  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [current, setCurrent] = useState<FinanceRecharge | null>(null)
  const [verifyForm] = Form.useForm<{ verify: boolean; verifyRemark?: string }>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listRecharges({ userId, isVerify })
      setRows(Array.isArray(list) ? list : [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载充值单失败')
    } finally {
      setLoading(false)
    }
  }, [userId, isVerify])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void api
      .getFinanceDefaults()
      .then((s) => setDefaultCurrency(s.defaultCurrencyCode || WALLET_CURRENCY))
      .catch(() => undefined)
  }, [])

  const columns: ColumnsType<FinanceRecharge> = [
    { title: '单号', dataIndex: 'rechargeNumber', width: 160 },
    { title: '经销商', dataIndex: 'userName' },
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
    { title: '备注', dataIndex: 'remark', render: (v) => v || '—' },
    { title: '提交人', dataIndex: 'createAdminName' },
    {
      title: '状态',
      dataIndex: 'isVerify',
      width: 100,
      render: (v: number) => {
        const m = verifyLabel[v] ?? { text: String(v), color: 'default' }
        return <Tag color={m.color}>{m.text}</Tag>
      },
    },
    { title: '审核人', dataIndex: 'verifyAdminName', render: (v) => v || '—' },
    {
      title: '审核时间',
      dataIndex: 'verifyTime',
      render: (v?: string | null) =>
        v ? new Date(v).toLocaleString() : '—',
    },
    {
      title: '提交时间',
      dataIndex: 'createTime',
      render: (v?: string) => (v ? new Date(v).toLocaleString() : '—'),
    },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_, r) =>
        canWrite && r.isVerify === 0 ? (
          <Button
            type="link"
            disabled={r.createAdminId === user?.id}
            onClick={() => {
              setCurrent(r)
              verifyForm.setFieldsValue({ verify: true, verifyRemark: undefined })
              setVerifyOpen(true)
            }}
          >
            审核
          </Button>
        ) : (
          '—'
        ),
    },
  ]

  return (
    <Card
      title="充值审核"
      extra={
        canWrite ? (
          <Button
            type="primary"
            onClick={() => {
              createForm.resetFields()
              createForm.setFieldsValue({ currencyCode: defaultCurrency })
              setCreateOpen(true)
            }}
          >
            新增充值
          </Button>
        ) : null
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <DealerSelect value={userId} onChange={setUserId} />
        <Select
          allowClear
          placeholder="审核状态"
          style={{ width: 140 }}
          value={isVerify}
          onChange={setIsVerify}
          options={[
            { value: '0', label: '待审核' },
            { value: '1', label: '已通过' },
            { value: '2', label: '已拒绝' },
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
        scroll={{ x: 1300 }}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title="新增充值"
        open={createOpen}
        confirmLoading={createLoading}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void createForm.validateFields().then(async (values) => {
            setCreateLoading(true)
            try {
              await api.createRecharge(values)
              message.success('已提交，等待审核')
              setCreateOpen(false)
              await load()
            } catch (err) {
              message.error(err instanceof Error ? err.message : '提交失败')
            } finally {
              setCreateLoading(false)
            }
          })
        }}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ currencyCode: defaultCurrency }}
        >
          <Form.Item
            name="userId"
            label="经销商"
            rules={[{ required: true, message: '请选择经销商' }]}
          >
            <DealerSelect allowClear={false} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="currencyCode"
            label="币种"
            rules={[{ required: true, message: '请选择币种' }]}
          >
            <CurrencySelect style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="amount"
            label="金额"
            rules={[{ required: true, message: '请输入金额' }]}
          >
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="审核充值"
        open={verifyOpen}
        confirmLoading={verifyLoading}
        onCancel={() => setVerifyOpen(false)}
        onOk={() => {
          void verifyForm.validateFields().then(async (values) => {
            if (!current) return
            setVerifyLoading(true)
            try {
              await api.verifyRecharge({
                rechargeNumber: current.rechargeNumber,
                verify: values.verify,
                verifyRemark: values.verifyRemark,
              })
              message.success('审核完成')
              setVerifyOpen(false)
              await load()
            } catch (err) {
              message.error(err instanceof Error ? err.message : '审核失败')
            } finally {
              setVerifyLoading(false)
            }
          })
        }}
        destroyOnHidden
      >
        {current ? (
          <div style={{ marginBottom: 16 }}>
            <div>经销商：{current.userName}</div>
            <div>
              原币：{formatMoney(current.amount, current.currencyCode)}
            </div>
            <div>
              入账 USD：{formatMoney(current.amountBase, WALLET_CURRENCY)}
            </div>
            <div>提交人：{current.createAdminName}</div>
            <div>备注：{current.remark || '—'}</div>
          </div>
        ) : null}
        <Form form={verifyForm} layout="vertical" initialValues={{ verify: true }}>
          <Form.Item
            name="verify"
            label="审核结果"
            rules={[{ required: true }]}
          >
            <Radio.Group>
              <Radio value={true}>通过</Radio>
              <Radio value={false}>拒绝</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="verifyRemark" label="审核备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

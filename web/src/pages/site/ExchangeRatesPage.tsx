import { SaveOutlined } from '@ant-design/icons'
import {
  Button,
  Card,
  Form,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ExchangeRateRow, type ExchangeRatesConfig } from '../../lib/api'
import {
  CURRENCY_LABELS_LONG,
  SUPPORTED_CURRENCIES,
  WALLET_CURRENCY,
} from '../../lib/currency'
import { useAuth } from '../../lib/auth-context'

type RateForm = {
  currencyCode: string
  rateToBase: number
}

export function ExchangeRatesPage() {
  const { can } = useAuth()
  const canWrite = can('exchange_rate', 'rw')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [config, setConfig] = useState<ExchangeRatesConfig>({
    baseCurrencyCode: WALLET_CURRENCY,
    rates: [],
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [form] = Form.useForm<RateForm>()
  const [settingsForm] = Form.useForm<{ baseCurrencyCode: string }>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getExchangeRates()
      setConfig(data)
      settingsForm.setFieldsValue({ baseCurrencyCode: data.baseCurrencyCode })
      setDirty(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载汇率失败')
    } finally {
      setLoading(false)
    }
  }, [settingsForm])

  useEffect(() => {
    void load()
  }, [load])

  const persist = async (next: ExchangeRatesConfig, successText = '已保存') => {
    setSaving(true)
    try {
      const saved = await api.updateExchangeRates({
        baseCurrencyCode: next.baseCurrencyCode,
        rates: next.rates.map((r) => ({
          currencyCode: r.currencyCode,
          rateToBase: r.rateToBase,
        })),
      })
      setConfig(saved)
      settingsForm.setFieldsValue({ baseCurrencyCode: saved.baseCurrencyCode })
      setDirty(false)
      message.success(successText)
      return saved
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const currencyOptions = useMemo(
    () =>
      SUPPORTED_CURRENCIES.map((code) => ({
        value: code,
        label: CURRENCY_LABELS_LONG[code] ?? code,
      })),
    [],
  )

  const handleBaseChange = (nextBase: string) => {
    const code = nextBase.toUpperCase()
    const currentBase = config.baseCurrencyCode.toUpperCase()
    if (code === currentBase) return

    Modal.confirm({
      title: '切换汇率基准币种',
      content:
        '切换基准币种将清空现有币种汇率列表，需重新录入或从聚合数据同步。此设置与全局默认币种无关。是否继续？',
      okText: '继续切换',
      cancelText: '取消',
      onOk: () => {
        setConfig({ baseCurrencyCode: code, rates: [] })
        settingsForm.setFieldsValue({ baseCurrencyCode: code })
        setDirty(true)
      },
      onCancel: () => {
        settingsForm.setFieldsValue({
          baseCurrencyCode: config.baseCurrencyCode,
        })
      },
    })
  }

  const columns: ColumnsType<ExchangeRateRow> = [
    { title: '币种', dataIndex: 'currencyCode', width: 120 },
    {
      title: `相对 ${config.baseCurrencyCode} 汇率`,
      dataIndex: 'rateToBase',
      render: (v: number, row) => (
        <span>
          {Number(v).toFixed(8)}
          <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
            例：100 {row.currencyCode} ≈ {(100 * Number(v)).toFixed(2)}{' '}
            {config.baseCurrencyCode}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v?: string | null) =>
        v ? new Date(v).toLocaleString() : '—',
    },
    {
      title: '操作',
      width: 140,
      render: (_, row) =>
        canWrite ? (
          <Space>
            <Button
              type="link"
              onClick={() => {
                setEditingCode(row.currencyCode)
                form.setFieldsValue({
                  currencyCode: row.currencyCode,
                  rateToBase: row.rateToBase,
                })
                setModalOpen(true)
              }}
            >
              编辑
            </Button>
            <Button
              type="link"
              danger
              onClick={() => {
                setConfig((prev) => ({
                  ...prev,
                  rates: prev.rates.filter(
                    (r) => r.currencyCode !== row.currencyCode,
                  ),
                }))
                setDirty(true)
              }}
            >
              删除
            </Button>
          </Space>
        ) : (
          '—'
        ),
    },
  ]

  const availableCodes = SUPPORTED_CURRENCIES.filter(
    (code) =>
      code !== config.baseCurrencyCode &&
      (editingCode === code ||
        !config.rates.some((r) => r.currencyCode === code)),
  )

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            汇率管理
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            维护各币种相对基准币种的汇率。财务充值/扣费折算使用此配置；与全局默认币种、钱包记账币种（USD）均相互独立。
          </Typography.Paragraph>
        </div>
        {canWrite ? (
          <Space wrap>
            <Button
              loading={syncing}
              onClick={() => {
                const run = async () => {
                  if (dirty) {
                    await persist(config, '配置已先保存')
                  }
                  setSyncing(true)
                  try {
                    await api.syncExchangeRates()
                    message.success('同步完成')
                    await load()
                  } catch (err) {
                    message.error(
                      err instanceof Error ? err.message : '同步失败',
                    )
                  } finally {
                    setSyncing(false)
                  }
                }
                void run()
              }}
            >
              从聚合数据同步
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!dirty}
              onClick={() => void persist(config)}
            >
              保存配置
            </Button>
          </Space>
        ) : null}
      </div>

      <Card title="汇率默认设置" loading={loading}>
        <Form
          form={settingsForm}
          layout="vertical"
          disabled={!canWrite}
          initialValues={{ baseCurrencyCode: config.baseCurrencyCode }}
        >
          <Form.Item
            label="汇率基准币种"
            name="baseCurrencyCode"
            style={{ maxWidth: 420, marginBottom: 0 }}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                各币种汇率均表示「1 单位该币种 = ?
                单位基准币种」。可自行选择，不跟随全局配置里的默认币种。
              </Typography.Text>
            }
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={currencyOptions}
              onChange={handleBaseChange}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card
        title="币种汇率"
        extra={
          canWrite ? (
            <Button
              type="primary"
              onClick={() => {
                setEditingCode(null)
                form.resetFields()
                setModalOpen(true)
              }}
            >
              新增币种
            </Button>
          ) : null
        }
      >
        <Table
          rowKey="currencyCode"
          loading={loading || saving}
          columns={columns}
          dataSource={config.rates}
          pagination={false}
        />
      </Card>

      <Modal
        title={editingCode ? '编辑汇率' : '新增汇率'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => {
            const currencyCode = values.currencyCode.toUpperCase()
            const rateToBase = Number(values.rateToBase)
            const without = config.rates.filter(
              (r) => r.currencyCode !== editingCode,
            )
            if (without.some((r) => r.currencyCode === currencyCode)) {
              message.error('该币种已存在')
              return
            }
            setConfig({
              ...config,
              rates: [...without, { currencyCode, rateToBase }].sort((a, b) =>
                a.currencyCode.localeCompare(b.currencyCode),
              ),
            })
            setDirty(true)
            setModalOpen(false)
            setEditingCode(null)
          })
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="currencyCode"
            label="币种"
            rules={[{ required: true, message: '请选择币种' }]}
          >
            <Select
              disabled={!!editingCode}
              options={availableCodes.map((code) => ({
                value: code,
                label: CURRENCY_LABELS_LONG[code] ?? code,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="rateToBase"
            label={`相对 ${config.baseCurrencyCode} 汇率`}
            rules={[{ required: true, message: '请输入汇率' }]}
          >
            <InputNumber
              min={0.00000001}
              step={0.0001}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

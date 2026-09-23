import { Alert, Button, Card, Form, Select, Space, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api, type SiteSettings } from '../../lib/api'
import { CURRENCY_LABELS, SUPPORTED_CURRENCIES } from '../../lib/currency'
import { useAuth } from '../../lib/auth-context'

const COUNTRY_OPTIONS = [
  { value: 'US', label: 'US — 美国' },
  { value: 'CN', label: 'CN — 中国' },
  { value: 'GB', label: 'GB — 英国' },
  { value: 'DE', label: 'DE — 德国' },
  { value: 'JP', label: 'JP — 日本' },
]

export function SiteConfigPage() {
  const { can } = useAuth()
  const canWrite = can('site_config', 'rw')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<SiteSettings>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getSiteSettings()
      form.setFieldsValue(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }, [form])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card title="全局配置" loading={loading}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="默认币种仅影响充值/扣费等表单的默认选中，不会修改钱包记账币种（始终为 USD）。"
      />
      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 480 }}
        disabled={!canWrite}
        onFinish={(values) => {
          setSaving(true)
          void api
            .updateSiteSettings(values)
            .then((saved) => {
              form.setFieldsValue(saved)
              message.success('已保存')
            })
            .catch((err) =>
              message.error(err instanceof Error ? err.message : '保存失败'),
            )
            .finally(() => setSaving(false))
        }}
      >
        <Form.Item
          name="defaultCountryCode"
          label="默认国家"
          rules={[{ required: true, message: '请选择默认国家' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={COUNTRY_OPTIONS}
          />
        </Form.Item>
        <Form.Item
          name="defaultCurrencyCode"
          label="默认币种"
          rules={[{ required: true, message: '请选择默认币种' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={SUPPORTED_CURRENCIES.map((code) => ({
              value: code,
              label: CURRENCY_LABELS[code] ?? code,
            }))}
          />
        </Form.Item>
        {canWrite ? (
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存
            </Button>
            <Button onClick={() => void load()}>重置</Button>
          </Space>
        ) : null}
      </Form>
    </Card>
  )
}

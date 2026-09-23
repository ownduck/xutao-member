import { UploadOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Input,
  Space,
  Table,
  Upload,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { api } from '../../lib/api'

type PreviewRow = { key: number; url: string; qty: number }

export function GoodsCreatePage() {
  const navigate = useNavigate()
  const [remark, setRemark] = useState('')
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const columns: ColumnsType<PreviewRow> = [
    { title: 'URL', dataIndex: 'url', ellipsis: true },
    { title: '数量', dataIndex: 'qty', width: 100 },
  ]

  function parseLocal(f: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
        })
        const parsed: PreviewRow[] = []
        json.forEach((row, i) => {
          const keys = Object.keys(row)
          const urlKey =
            keys.find((k) => /^url$/i.test(k.trim())) ||
            keys.find((k) => /url|链接/i.test(k))
          const qtyKey =
            keys.find((k) => /^(数量|qty|quantity)$/i.test(k.trim())) ||
            keys.find((k) => /数量|qty|quantity/i.test(k))
          const url = String(urlKey ? row[urlKey] : '').trim()
          const qty = Number(qtyKey ? row[qtyKey] : 0)
          if (!url) throw new Error(`第 ${i + 2} 行缺少 url`)
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new Error(`第 ${i + 2} 行数量必须为正整数`)
          }
          parsed.push({ key: i, url, qty })
        })
        if (!parsed.length) throw new Error('没有有效数据行')
        setRows(parsed)
        setFile(f)
        message.success(`已解析 ${parsed.length} 行`)
      } catch (err) {
        setRows([])
        setFile(null)
        message.error(err instanceof Error ? err.message : '解析失败')
      }
    }
    reader.readAsArrayBuffer(f)
  }

  return (
    <Card title="创建预约">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="上传 Amazon 商品下单 Excel（表头：url、数量）。创建后订单状态为「预约中」，请在预约订单中补全单价后再提交履约。"
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <Button
          onClick={() => {
            void api
              .downloadGoodsTemplate()
              .then((blob) => {
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'goods-reserve-template.xlsx'
                a.click()
                URL.revokeObjectURL(url)
              })
              .catch((err) =>
                message.error(err instanceof Error ? err.message : '下载失败'),
              )
          }}
        >
          下载模板
        </Button>
        <Upload
          accept=".xlsx,.xls"
          maxCount={1}
          beforeUpload={(f) => {
            parseLocal(f)
            return false
          }}
          onRemove={() => {
            setFile(null)
            setRows([])
          }}
          fileList={
            file
              ? [
                  {
                    uid: '-1',
                    name: file.name,
                    status: 'done',
                  },
                ]
              : []
          }
        >
          <Button icon={<UploadOutlined />}>选择 Excel</Button>
        </Upload>
      </Space>
      <div style={{ marginBottom: 16, maxWidth: 560 }}>
        <div style={{ marginBottom: 8 }}>经销商备注（可选）</div>
        <Input.TextArea
          rows={2}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="备注"
        />
      </div>
      <Table
        rowKey="key"
        columns={columns}
        dataSource={rows}
        pagination={false}
        style={{ marginBottom: 16 }}
        locale={{ emptyText: '请先上传并解析 Excel' }}
      />
      <Button
        type="primary"
        disabled={!file || !rows.length}
        loading={submitting}
        onClick={() => {
          if (!file) return
          setSubmitting(true)
          void api
            .importGoodsOrder(file, remark || undefined)
            .then((order) => {
              message.success('预约订单已创建')
              navigate(`/goods/reserve/${order.id}`)
            })
            .catch((err) =>
              message.error(err instanceof Error ? err.message : '创建失败'),
            )
            .finally(() => setSubmitting(false))
        }}
      >
        确认创建
      </Button>
    </Card>
  )
}

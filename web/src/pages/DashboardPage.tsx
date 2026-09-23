import { Card, Typography } from 'antd'
import { useAuth } from '../lib/auth-context'

export function DashboardPage() {
  const { user, isSuperAdmin } = useAuth()
  const name =
    user?.realname?.trim() || user?.name?.trim() || user?.email || '???'

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        ???{name}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {isSuperAdmin
          ? '??????????????????'
          : '?????????????????'}
      </Typography.Paragraph>
    </Card>
  )
}

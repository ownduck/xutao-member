import { Card, Typography } from 'antd'
import { useAuth } from '../lib/auth-context'

export function DashboardPage() {
  const { user, isSuperAdmin } = useAuth()
  const name =
    user?.realname?.trim() || user?.name?.trim() || user?.email || '管理员'

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        欢迎，{name}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {isSuperAdmin
          ? '你是超级管理员，可管理全部后台权限。'
          : '请从左侧菜单进入已授权的功能模块。'}
      </Typography.Paragraph>
    </Card>
  )
}

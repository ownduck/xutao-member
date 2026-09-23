import {
  BugOutlined,
  DownOutlined,
  KeyOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Avatar, Dropdown, Space, Switch, Typography, message, theme } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminResetPasswordModal } from './AdminResetPasswordModal'
import { api } from '../lib/api'
import { signOut } from '../lib/auth-client'
import { useAuth } from '../lib/auth-context'
import { clearPermissions } from '../lib/permission'
import { useAdminDebugMode } from '../providers/admin-debug-mode-provider'

export function AdminProfileMenu() {
  const navigate = useNavigate()
  const { user, isSuperAdmin } = useAuth()
  const { debugMode, setDebugMode } = useAdminDebugMode()
  const { token } = theme.useToken()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const displayName =
    user?.realname?.trim() || user?.name?.trim() || user?.email || '管理员'

  async function handleResetPassword(password: string) {
    setResetting(true)
    try {
      await api.changeMyPassword(password)
      message.success('密码已重置，请使用新密码重新登录')
      setResetOpen(false)
      clearPermissions()
      await signOut()
      navigate('/login', { replace: true })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重置密码失败')
    } finally {
      setResetting(false)
    }
  }

  const menuItems: MenuProps['items'] = [
    ...(isSuperAdmin
      ? [
          {
            key: 'debug-mode',
            icon: <BugOutlined />,
            label: (
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  minWidth: 168,
                }}
              >
                <span>调试模式</span>
                <Switch
                  size="small"
                  checked={debugMode}
                  onChange={(checked) => {
                    setDebugMode(checked)
                    message.success(
                      checked ? '调试模式已开启' : '调试模式已关闭',
                    )
                  }}
                />
              </div>
            ),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      key: 'reset-password',
      icon: <KeyOutlined />,
      label: '重置密码',
      onClick: () => setResetOpen(true),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        void (async () => {
          clearPermissions()
          await signOut()
          navigate('/login', { replace: true })
        })()
      },
    },
  ]

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        placement="bottomRight"
      >
        <Space style={{ cursor: 'pointer', userSelect: 'none' }}>
          <Avatar
            icon={<UserOutlined />}
            style={{ backgroundColor: token.colorPrimary }}
          />
          <Typography.Text>{displayName}</Typography.Text>
          <DownOutlined style={{ fontSize: 10, color: '#677489' }} />
        </Space>
      </Dropdown>

      <AdminResetPasswordModal
        open={resetOpen}
        loading={resetting}
        onClose={() => setResetOpen(false)}
        onSubmit={(password) => void handleResetPassword(password)}
      />
    </>
  )
}

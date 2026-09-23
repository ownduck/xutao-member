import { Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useMemo, type PropsWithChildren } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AdminProfileMenu } from '../components/AdminProfileMenu'
import { adminMenus, getPageTitle, type AdminMenuItem } from '../config/adminMenu'
import { useAuth } from '../lib/auth-context'
import { filterMenus } from '../lib/permission'

const { Header, Sider, Content } = Layout

function toMenuItems(items: AdminMenuItem[]): NonNullable<MenuProps['items']> {
  return items.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.path ? <Link to={item.path}>{item.label}</Link> : item.label,
    children: item.children ? toMenuItems(item.children) : undefined,
  }))
}

function getOpenKeys(pathname: string): string[] {
  const parent = adminMenus.find(
    (m) =>
      m.children?.some(
        (c) =>
          c.path &&
          (pathname === c.path || pathname.startsWith(`${c.path}/`)),
      ) ||
      (m.path &&
        (pathname === m.path || pathname.startsWith(`${m.path}/`))),
  )
  return parent && !parent.path ? [parent.key] : []
}

export function AdminShell({ children }: PropsWithChildren) {
  const location = useLocation()
  const { user, isSuperAdmin, permissions } = useAuth()

  const menus = useMemo(
    () => filterMenus(adminMenus),
    [user, isSuperAdmin, permissions],
  )
  const menuItems = useMemo(() => toMenuItems(menus), [menus])
  const pageTitle = getPageTitle(location.pathname)
  const selectedKey =
    menus
      .flatMap((m) => (m.children ? m.children : [m]))
      .find(
        (m) =>
          m.path &&
          (location.pathname === m.path ||
            location.pathname.startsWith(`${m.path}/`)),
      )?.key ?? location.pathname

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={240}
        theme="light"
        style={{ borderRight: '1px solid #e5e7eb' }}
      >
        <div style={{ padding: '20px 20px 8px' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            会员管理后台
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Admin Console
          </Typography.Paragraph>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={getOpenKeys(location.pathname)}
          items={menuItems}
          style={{ borderInlineEnd: 0 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingInline: 24,
            height: 56,
            lineHeight: '56px',
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {pageTitle}
          </Typography.Title>
          <AdminProfileMenu />
        </Header>
        <Content style={{ padding: 24, background: '#f6f7f9' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}

import {
  AccountBookOutlined,
  AuditOutlined,
  DashboardOutlined,
  DollarOutlined,
  GlobalOutlined,
  HistoryOutlined,
  ShoppingOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  WalletOutlined,
  PlusSquareOutlined,
  CarryOutOutlined,
  FormOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import { createElement } from 'react'

export type AdminMenuItem = {
  key: string
  label: string
  path?: string
  permission?: string
  icon?: ReactNode
  children?: AdminMenuItem[]
}

export const adminMenus: AdminMenuItem[] = [
  {
    key: '/dashboard',
    label: '概览',
    path: '/dashboard',
    icon: createElement(DashboardOutlined),
  },
  {
    key: 'goods',
    label: '商品管理',
    permission: 'goods',
    icon: createElement(ShoppingOutlined),
    children: [
      {
        key: '/goods/create',
        label: '创建预约',
        path: '/goods/create',
        permission: 'goods_reserve_create',
        icon: createElement(PlusSquareOutlined),
      },
      {
        key: '/goods/reserve',
        label: '预约订单',
        path: '/goods/reserve',
        permission: 'goods_reserve_order',
        icon: createElement(FormOutlined),
      },
      {
        key: '/goods/fulfill',
        label: '履约订单',
        path: '/goods/fulfill',
        permission: 'goods_fulfill_order',
        icon: createElement(CarryOutOutlined),
      },
      {
        key: '/goods/history',
        label: '历史订单',
        path: '/goods/history',
        permission: 'goods_history_order',
        icon: createElement(HistoryOutlined),
      },
    ],
  },
  {
    key: 'finance',
    label: '财务',
    permission: 'finance',
    icon: createElement(AccountBookOutlined),
    children: [
      {
        key: '/finance/wallet',
        label: '钱包',
        path: '/finance/wallet',
        permission: 'wallet',
        icon: createElement(WalletOutlined),
      },
      {
        key: '/finance/trade-log',
        label: '账户变动',
        path: '/finance/trade-log',
        permission: 'trade_log',
        icon: createElement(DollarOutlined),
      },
      {
        key: '/finance/recharge',
        label: '充值审核',
        path: '/finance/recharge',
        permission: 'recharge',
        icon: createElement(AuditOutlined),
      },
      {
        key: '/finance/deduction',
        label: '扣费审核',
        path: '/finance/deduction',
        permission: 'deduction',
        icon: createElement(AuditOutlined),
      },
    ],
  },
  {
    key: 'site',
    label: '站点管理',
    permission: 'site',
    icon: createElement(GlobalOutlined),
    children: [
      {
        key: '/site/exchange-rates',
        label: '汇率管理',
        path: '/site/exchange-rates',
        permission: 'exchange_rate',
        icon: createElement(SwapOutlined),
      },
      {
        key: '/site/config',
        label: '全局配置',
        path: '/site/config',
        permission: 'site_config',
        icon: createElement(SettingOutlined),
      },
    ],
  },
  {
    key: 'rbac',
    label: '后台权限',
    icon: createElement(SafetyCertificateOutlined),
    children: [
      {
        key: '/rbac/users',
        label: '管理员',
        path: '/rbac/users',
        permission: 'user_config',
        icon: createElement(TeamOutlined),
      },
      {
        key: '/rbac/roles',
        label: '角色',
        path: '/rbac/roles',
        permission: 'role_config',
        icon: createElement(SafetyCertificateOutlined),
      },
    ],
  },
]

export function getPageTitle(pathname: string): string {
  const flat = flattenMenus(adminMenus)
  const hit = flat.find(
    (item) =>
      item.path &&
      (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  )
  return hit?.label ?? '管理后台'
}

function flattenMenus(items: AdminMenuItem[]): AdminMenuItem[] {
  const out: AdminMenuItem[] = []
  for (const item of items) {
    out.push(item)
    if (item.children) out.push(...flattenMenus(item.children))
  }
  return out
}

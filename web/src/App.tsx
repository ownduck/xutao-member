import { Spin } from 'antd'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AdminShell } from './layouts/AdminShell'
import { useSession } from './lib/auth-client'
import { useAuth } from './lib/auth-context'
import { DashboardPage } from './pages/DashboardPage'
import { DeductionPage } from './pages/finance/DeductionPage'
import { RechargePage } from './pages/finance/RechargePage'
import { TradeLogPage } from './pages/finance/TradeLogPage'
import { WalletPage } from './pages/finance/WalletPage'
import { GoodsCreatePage } from './pages/goods/GoodsCreatePage'
import { GoodsOrderDetailPage } from './pages/goods/GoodsOrderDetailPage'
import { GoodsOrderListPage } from './pages/goods/GoodsOrderListPage'
import { LoginPage } from './pages/login/LoginPage'
import { RolesPage } from './pages/rbac/RolesPage'
import { UsersPage } from './pages/rbac/UsersPage'
import { ExchangeRatesPage } from './pages/site/ExchangeRatesPage'
import { SiteConfigPage } from './pages/site/SiteConfigPage'

function ProtectedLayout() {
  const location = useLocation()
  const { data: session, isPending } = useSession()
  const { loading } = useAuth()

  if (isPending || loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin size="large" />
      </div>
    )
  }

  if (!session?.user) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/rbac/users" element={<UsersPage />} />
        <Route path="/rbac/roles" element={<RolesPage />} />
        <Route path="/goods/create" element={<GoodsCreatePage />} />
        <Route
          path="/goods/reserve"
          element={<GoodsOrderListPage mode="reserve" />}
        />
        <Route
          path="/goods/reserve/:id"
          element={<GoodsOrderDetailPage mode="reserve" />}
        />
        <Route
          path="/goods/fulfill"
          element={<GoodsOrderListPage mode="fulfill" />}
        />
        <Route
          path="/goods/fulfill/:id"
          element={<GoodsOrderDetailPage mode="fulfill" />}
        />
        <Route
          path="/goods/history"
          element={<GoodsOrderListPage mode="history" />}
        />
        <Route
          path="/goods/history/:id"
          element={<GoodsOrderDetailPage mode="history" />}
        />
        <Route path="/finance/wallet" element={<WalletPage />} />
        <Route path="/finance/trade-log" element={<TradeLogPage />} />
        <Route path="/finance/recharge" element={<RechargePage />} />
        <Route path="/finance/deduction" element={<DeductionPage />} />
        <Route path="/site/exchange-rates" element={<ExchangeRatesPage />} />
        <Route path="/site/config" element={<SiteConfigPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

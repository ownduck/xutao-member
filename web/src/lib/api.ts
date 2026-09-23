export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  })

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const msg =
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `请求失败 (${res.status})`
    throw new ApiError(msg, res.status, data)
  }

  return data as T
}

export type MeUser = {
  id: string
  name: string
  email: string
  image?: string | null
  realname?: string | null
  isSuperAdmin?: boolean
}

export type MeResponse = {
  user: MeUser
  permissions: string[]
  isSuperAdmin: boolean
  roles?: Array<{ roleId: number; name: string; key?: string | null }>
  roleKeys?: string[]
  isDealer?: boolean
  isOps?: boolean
}

export type RbacUser = {
  id: string
  name: string
  email: string
  realname?: string | null
  isSuperAdmin?: boolean
  createdAt?: string
  roles?: Array<{ roleId: number; name: string; key?: string | null }>
}

export type RbacRole = {
  roleId: number
  name: string
  key?: string | null
  description?: string | null
  createTime?: string
  updateTime?: string
}

export type RbacPermission = {
  permissionId: number
  parentPermissionId?: number | null
  code: string
  name: string
  description?: string | null
  sort?: number
  hide?: boolean
  children?: RbacPermission[]
}

export const api = {
  me: () => request<MeResponse>('/api/me'),
  changeMyPassword: (password: string) =>
    request<{ ok: boolean }>('/api/me/password', {
      method: 'PUT',
      body: { password },
    }),

  listUsers: () => request<RbacUser[]>('/api/rbac/users'),
  createUser: (body: {
    email: string
    password: string
    name: string
    realname?: string
  }) => request<RbacUser>('/api/rbac/users', { method: 'POST', body }),
  updateUser: (
    id: string,
    body: { name?: string; realname?: string; email?: string },
  ) => request<RbacUser>(`/api/rbac/users/${id}`, { method: 'PUT', body }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(`/api/rbac/users/${id}/password`, {
      method: 'PUT',
      body: { password },
    }),
  deleteUser: (id: string) =>
    request<void>(`/api/rbac/users/${id}`, { method: 'DELETE' }),
  setUserRoles: (id: string, roleIds: number[]) =>
    request<void>(`/api/rbac/users/${id}/roles`, {
      method: 'PUT',
      body: { roleIds },
    }),

  listRoles: () => request<RbacRole[]>('/api/rbac/roles'),
  createRole: (body: { name: string; description?: string; key?: string }) =>
    request<RbacRole>('/api/rbac/roles', { method: 'POST', body }),
  updateRole: (
    id: number,
    body: { name?: string; description?: string; key?: string },
  ) => request<RbacRole>(`/api/rbac/roles/${id}`, { method: 'PUT', body }),
  deleteRole: (id: number) =>
    request<void>(`/api/rbac/roles/${id}`, { method: 'DELETE' }),
  getRolePermissions: (id: number) =>
    request<{
      permissionIds: number[]
      readOnlyPermissionIds: number[]
    }>(`/api/rbac/roles/${id}/permissions`),
  setRolePermissions: (
    id: number,
    body: { permissionIds: number[]; readOnlyPermissionIds: number[] },
  ) =>
    request<void>(`/api/rbac/roles/${id}/permissions`, {
      method: 'PUT',
      body,
    }),

  listPermissions: () => request<RbacPermission[]>('/api/rbac/permissions'),

  // finance
  listDealers: () => request<FinanceDealer[]>('/api/finance/dealers'),
  listWallets: (userId?: string) =>
    request<FinanceWallet[]>(
      `/api/finance/wallet/list${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`,
    ),
  listTradeLogs: (query: {
    userId?: string
    direction?: string
    createTimeStart?: string
    createTimeEnd?: string
  } = {}) => {
    const qs = new URLSearchParams()
    if (query.userId) qs.set('userId', query.userId)
    if (query.direction) qs.set('direction', query.direction)
    if (query.createTimeStart) qs.set('createTimeStart', query.createTimeStart)
    if (query.createTimeEnd) qs.set('createTimeEnd', query.createTimeEnd)
    const s = qs.toString()
    return request<FinanceTradeLog[]>(
      `/api/finance/trade/log${s ? `?${s}` : ''}`,
    )
  },
  listRecharges: (query: { userId?: string; isVerify?: string } = {}) => {
    const qs = new URLSearchParams()
    if (query.userId) qs.set('userId', query.userId)
    if (query.isVerify !== undefined && query.isVerify !== '') {
      qs.set('isVerify', query.isVerify)
    }
    const s = qs.toString()
    return request<FinanceRecharge[]>(
      `/api/finance/recharge/list${s ? `?${s}` : ''}`,
    )
  },
  createRecharge: (body: {
    userId: string
    amount: number
    currencyCode?: string
    remark?: string
  }) =>
    request<FinanceRecharge>('/api/finance/recharge', {
      method: 'POST',
      body,
    }),
  verifyRecharge: (body: {
    rechargeNumber: string
    verify: boolean
    verifyRemark?: string
  }) =>
    request<FinanceRecharge>('/api/finance/recharge/verify', {
      method: 'PUT',
      body,
    }),
  listDeductions: (userId?: string) =>
    request<FinanceDeduction[]>(
      `/api/finance/deduction/list${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`,
    ),
  createDeduction: (body: {
    userId: string
    amount: number
    currencyCode?: string
    remark?: string
  }) =>
    request<FinanceDeduction>('/api/finance/deduction', {
      method: 'POST',
      body,
    }),
  verifyDeduction: (body: {
    deductionNumber: string
    verify: boolean
    verifyRemark?: string
  }) =>
    request<FinanceDeduction>('/api/finance/deduction/verify', {
      method: 'PUT',
      body,
    }),

  // site
  getSiteSettings: () => request<SiteSettings>('/api/site/settings'),
  updateSiteSettings: (body: Partial<SiteSettings>) =>
    request<SiteSettings>('/api/site/settings', { method: 'PUT', body }),
  getFinanceDefaults: () =>
    request<SiteSettings>('/api/site/settings/defaults'),
  getExchangeRates: () =>
    request<ExchangeRatesConfig>('/api/site/exchange-rates'),
  updateExchangeRates: (body: {
    baseCurrencyCode?: string
    rates: Array<{ currencyCode: string; rateToBase: number }>
  }) =>
    request<ExchangeRatesConfig>('/api/site/exchange-rates', {
      method: 'PUT',
      body,
    }),
  syncExchangeRates: () =>
    request<{
      ok: boolean
      updated: Array<{ currencyCode: string; rateToBase: number }>
    }>('/api/site/exchange-rates/sync', { method: 'POST' }),

  // goods
  listReserveOrders: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<GoodsOrder[]>(`/api/goods/orders/reserve${qs}`)
  },
  listFulfillOrders: (query: { dealerUserId?: string; status?: string } = {}) => {
    const qs = new URLSearchParams()
    if (query.dealerUserId) qs.set('dealerUserId', query.dealerUserId)
    if (query.status) qs.set('status', query.status)
    const s = qs.toString()
    return request<GoodsOrder[]>(`/api/goods/orders/fulfill${s ? `?${s}` : ''}`)
  },
  listHistoryOrders: (dealerUserId?: string) => {
    const qs = dealerUserId
      ? `?dealerUserId=${encodeURIComponent(dealerUserId)}`
      : ''
    return request<GoodsOrder[]>(`/api/goods/orders/history${qs}`)
  },
  getGoodsOrder: (id: number) =>
    request<GoodsOrder>(`/api/goods/orders/${id}`),
  importGoodsOrder: async (file: File, dealerRemark?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (dealerRemark) form.append('dealerRemark', dealerRemark)
    const res = await fetch('/api/goods/orders/import', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    const text = await res.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof (data as { message: unknown }).message === 'string'
          ? (data as { message: string }).message
          : `请求失败 (${res.status})`
      throw new ApiError(msg, res.status, data)
    }
    return data as GoodsOrder
  },
  downloadGoodsTemplate: async () => {
    const res = await fetch('/api/goods/orders/template', {
      credentials: 'include',
    })
    if (!res.ok) throw new ApiError('下载模板失败', res.status)
    return res.blob()
  },
  updateGoodsOrder: (
    id: number,
    body: {
      dealerRemark?: string | null
      items?: Array<{
        id: number
        unitPrice?: number | null
        reserveQty?: number
        fulfillQty?: number
      }>
    },
  ) =>
    request<GoodsOrder>(`/api/goods/orders/${id}`, {
      method: 'PUT',
      body,
    }),
  syncGoodsItemPrice: (orderId: number, itemId: number) =>
    request<{
      itemId: number
      amazonUrl: string
      usdPrice: number
      unitPrice: number
      currencyCode: string
      ok: true
    }>(`/api/goods/orders/${orderId}/items/${itemId}/sync-price`, {
      method: 'POST',
    }),
  syncGoodsPrices: (orderId: number, mode: 'all' | 'empty') =>
    request<{
      mode: 'all' | 'empty'
      results: Array<{
        itemId: number
        amazonUrl: string
        ok: boolean
        usdPrice?: number
        unitPrice?: number
        currencyCode?: string
        error?: string
      }>
    }>(`/api/goods/orders/${orderId}/sync-prices`, {
      method: 'POST',
      body: { mode },
    }),
  submitGoodsFulfill: (id: number) =>
    request<GoodsOrder>(`/api/goods/orders/${id}/submit-fulfill`, {
      method: 'POST',
    }),
  submitGoodsComplete: (id: number) =>
    request<{ order: GoodsOrder; deduction: FinanceDeduction }>(
      `/api/goods/orders/${id}/submit-complete`,
      { method: 'POST' },
    ),
}

export type FinanceDealer = {
  id: string
  name: string
  email: string
  realname?: string | null
}

export type FinanceWallet = {
  id: number
  userId: string
  walletCode: string
  currencyCode?: string
  balance: string
  lastTradeTime?: string | null
  createTime?: string
  user?: {
    id: string
    name: string
    email: string
    realname?: string | null
  } | null
}

export type FinanceTradeLog = {
  id: number
  tradeNumber: string
  userId: string
  userName?: string
  direction: string
  currencyCode?: string
  amount: string
  amountBase?: string
  balance: string
  type: number
  source: number
  orderNumber?: string | null
  info?: string | null
  createTime?: string
}

export type FinanceRecharge = {
  id: number
  rechargeNumber: string
  userId: string
  userName?: string | null
  currencyCode?: string
  amount: string
  amountBase?: string
  remark?: string | null
  verifyRemark?: string | null
  isVerify: number
  createAdminId: string
  createAdminName?: string | null
  verifyAdminId?: string | null
  verifyAdminName?: string | null
  verifyTime?: string | null
  createTime?: string
}

export type FinanceDeduction = {
  id: number
  deductionNumber: string
  userId: string
  userName?: string | null
  currencyCode?: string
  amount: string
  amountBase?: string
  remark?: string | null
  verifyRemark?: string | null
  isVerify: number
  createAdminId?: string
  createAdminName?: string | null
  verifyAdminName?: string | null
  verifyTime?: string | null
  createTime?: string
  orderId?: number | null
  orderNumber?: string | null
  order?: { id: number; orderNumber?: string | null } | null
}

export type SiteSettings = {
  defaultCountryCode: string
  defaultCurrencyCode: string
}

export type ExchangeRateRow = {
  currencyCode: string
  rateToBase: number
  updatedAt?: string | null
}

export type ExchangeRatesConfig = {
  baseCurrencyCode: string
  rates: ExchangeRateRow[]
}

export type GoodsOrderStatus =
  | 'reserving'
  | 'pending_fulfill'
  | 'partial_fulfill'
  | 'fulfilled'
  | 'completed'

export type GoodsOrderItem = {
  id: number
  orderId: number
  amazonUrl: string
  reserveQty: number
  unitPrice?: string | null
  fulfillQty: number
  sort: number
}

export type GoodsOrder = {
  id: number
  orderNumber: string
  dealerUserId: string
  status: GoodsOrderStatus
  currencyCode: string
  priceStatus?: number
  dealerRemark?: string | null
  totalAmount?: string | null
  totalAmountBase?: string | null
  deductionId?: number | null
  createTime?: string
  updateTime?: string
  itemCount?: number
  reserveQtyTotal?: number
  fulfillQtyTotal?: number
  dealer?: {
    id: string
    name: string
    email: string
    realname?: string | null
  } | null
  items?: GoodsOrderItem[]
  deduction?: FinanceDeduction | null
}

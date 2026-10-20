# 01 概览页测试计划

## Application Overview

概览页（`/dashboard`）是管理后台的默认落地页，展示当前登录管理员的欢迎卡片。页面实现非常轻量：只有一个 `Card`，没有统计卡片、图表、快捷入口或数据请求。

## 测试范围

`/dashboard` 的展示内容、角色差异、导航选中态、加载态、会话失效与名称回退。

## 环境与前提

- baseURL：`http://localhost:5288`；seed：`e2e/seed.spec.ts`（admin 登录后进入 `/dashboard`）。
- 角色登录态：admin（超级管理员）、ops（运营）、dealer（经销商）。
- 页面结构：
  - Header 标题：`概览`。
  - Content 内单个 `.ant-card`。
  - 标题：`欢迎，<realname || name || email || 管理员>`。
  - 超级管理员副文案：`你是超级管理员，可管理全部后台权限。`
  - 非超级管理员副文案：`请从左侧菜单进入已授权的功能模块。`
  - 侧边栏「概览」高亮。
- 冷启动时 `ProtectedLayout` 会等待 `/api/me`，期间显示全屏 `.ant-spin-spinning`，完成后才渲染侧边栏与页面。

## 实测文案

- admin：`欢迎，超级管理员` / `你是超级管理员，可管理全部后台权限。`
- ops：`欢迎，运营专员` / `请从左侧菜单进入已授权的功能模块。`
- dealer：`欢迎，示例经销商` / `请从左侧菜单进入已授权的功能模块。`
- 欢迎名称应与 Header 右上角显示名一致；它取 realname，其次 name，再次 email，最后「管理员」。

## 重点验证

1. 显示名称优先级与角色文案差异。
2. 页面没有统计/图表/快捷入口（防止需求回退或误加）。
3. `/` 与未知路径落到概览。
4. 会话/权限加载期间不出现空白或闪烁登录页。
5. 未登录或会话失效时由路由守卫接管（与 00 计划重叠，此处只验证 dashboard 入口）。

## Test Scenarios

### 1. 概览页内容

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 超级管理员概览文案与结构

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 以 admin 登录后访问 `/dashboard`
    - expect: URL 为 `/dashboard`
    - expect: Header 标题显示「概览」
    - expect: 侧边栏「概览」菜单项处于选中态（`.ant-menu-item-selected`）
  2. 查看主内容区域
    - expect: 存在且仅存在一个主要内容 `.ant-card`
    - expect: 标题为「欢迎，超级管理员」
    - expect: 副文案为「你是超级管理员，可管理全部后台权限。」
  3. 检查是否包含统计、图表或快捷入口
    - expect: 不存在 `.ant-statistic`
    - expect: 不存在 canvas/svg 图表容器
    - expect: 不存在快捷入口按钮组

#### 1.2. 运营账号概览文案

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 使用 ops 登录态访问 `/dashboard`
    - expect: 标题为「欢迎，运营专员」（与 Header 显示名一致）
    - expect: 副文案为「请从左侧菜单进入已授权的功能模块。」
    - expect: 不出现「超级管理员」文案

#### 1.3. 经销商账号概览文案

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 使用 dealer 登录态访问 `/dashboard`
    - expect: 标题为「欢迎，示例经销商」（与 Header 显示名一致）
    - expect: 副文案为「请从左侧菜单进入已授权的功能模块。」
    - expect: 不包含「超级管理员」文案

#### 1.4. 根路径与未知路径均落到概览

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 以 admin 登录访问 `/`
    - expect: URL 重定向为 `/dashboard`
    - expect: 显示欢迎卡片
  2. 访问 `/dashboard/unknown`
    - expect: URL 变为 `/dashboard`（兜底路由）
    - expect: 页面正常显示欢迎卡片

### 2. 加载态与异常态

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 冷启动等待权限加载时显示全屏 Spin 且不闪回登录页

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 使用 admin storageState 新建上下文首次访问 `/dashboard`，将 `/api/me` 延迟 2 秒
    - expect: 加载期间出现 `.ant-spin-spinning` 全屏 Spin
    - expect: 不出现 `/login` 重定向或登录卡片
  2. 等待 `/api/me` 返回
    - expect: Spin 消失
    - expect: 侧边栏与欢迎卡片渲染完成

#### 2.2. 会话失效后访问概览被守卫拦截

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 以 admin 登录后清除认证 cookie 或执行退出登录，再访问 `/dashboard`
    - expect: URL 变为 `/login?redirect=%2Fdashboard`（或至少 `/login?redirect=...`）
    - expect: 不显示欢迎卡片

#### 2.3. 欢迎名称回退顺序

**File:** `e2e/plan/01-dashboard.spec.ts`

**Steps:**
  1. 使用 realname 为空的测试管理员登录
    - expect: 标题使用 name 字段，而不是空字符串
  2. 使用 name 也为空的账号访问 `/dashboard`
    - expect: 标题回退到邮箱
    - expect: 若所有字段均为空则显示「欢迎，管理员」

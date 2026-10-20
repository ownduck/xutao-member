# 00 应用概览、登录与通用导航测试计划

## Application Overview

管理后台（React 19 + React Router 7 + Ant Design 6，zh_CN，主色 #df3c19）的登录与会话、应用外壳（侧边栏、Header、用户下拉）、菜单权限过滤、路由守卫、退出登录、调试模式与重置本人密码。

## 测试范围

登录/会话、应用外壳、菜单权限过滤、路由守卫、退出登录、调试模式、重置本人密码。

## 环境与前提

- baseURL：`http://localhost:5288`；后端 `http://localhost:3000`，前端通过 `/api` 代理。
- seed：`e2e/seed.spec.ts`（admin 登录后进入 `/dashboard`）。
- 账号：admin@local.dev / Admin@123456（超级管理员）；ops@local.dev / Ops@123456（运营）；dealer@local.dev / Dealer@123456（经销商）。
- 已登录用户访问 `/login` 会跳转到 `/dashboard`（或 redirect 参数指定页面）。
- 每个用例独立执行；除 storageState 用例外，均假定无登录态。

## 实测菜单与权限矩阵

| 菜单 | admin | ops | dealer |
|---|---|---|---|
| 概览 | 可见 | 可见 | 可见 |
| 订单管理 | 创建预约、预约订单、履约订单、历史订单 | 履约订单、历史订单 | 创建预约、预约订单、历史订单 |
| 财务 | 钱包、账户变动、充值审核、扣费审核 | 全部四项 | 钱包、账户变动 |
| 站点管理 | 汇率管理、全局配置 | 汇率管理、全局配置 | 无 |
| 后台权限 | 管理员、角色 | 无子项的「后台权限」顶层菜单项 | 无子项的「后台权限」顶层菜单项 |

## 实测重要行为（计划以此为准）

1. Header 只有页面标题（`header h4`），没有面包屑；标题由路由映射，未知路由显示「管理后台」。
2. 用户下拉：admin 为「调试模式（含 Switch）」「重置密码」「退出登录」；ops/dealer 只有「重置密码」「退出登录」，没有个人资料入口。
3. 「重置密码」重置的是当前登录用户自己的密码；成功后强制退出并回到 `/login`（可能带 redirect 参数），新密码最少 6 位（与管理员页重置他人密码的 8 位不同）。
4. 前端没有路由级权限守卫：无权限用户直接输入 URL 时页面骨架仍渲染，接口返回 403，并弹出 AntD 全局提示 `Insufficient permission`；页面通常显示空表，而不是跳转 403/首页。
5. 无 permission 字段的「后台权限」父菜单在子项全部被过滤后不会被移除，最终变成一个无子项、点击无反应的顶层菜单项（已知缺陷）。
6. 列表页首次进入存在竞态：偶发先显示「暂无数据」，稍后或点击「查 询」后才出现数据。计划中如遇空表，先点击「查 询」再断言。
7. AntD 两个汉字的按钮可访问名会插入空格：`查 询`、`保 存`、`确 定`、`取 消`、`登 录`、`审 核`。定位建议使用 `/查\s*询/` 或 `button:has-text("查 询")`。
8. 控制台存在非业务警告：`useForm is not connected`、`Alert message deprecated`、`message static function`、`Modal static function`；不影响功能，但应作为技术债记录。

## 通用定位约定

- 登录：`input[placeholder="邮箱"]`、`input[placeholder="密码"]`、`button:has-text("登 录")`。
- 侧边栏：`.ant-layout-sider`；菜单项/父项：`.ant-menu-item`、`.ant-menu-submenu`。
- Header：`header`；标题：`header h4`；用户下拉触发器：`header .ant-avatar` 或 `header >> text=<显示名>`。
- 表格：`main .ant-table`；空态：`.ant-empty` / 「暂无数据」；分页：`.ant-pagination`。
- 全局提示：`.ant-message-notice-title`；确认框：`.ant-modal-confirm`；普通弹窗：`.ant-modal`。
- 403 提示固定文本：`Insufficient permission`（英文，约 3 秒后消失，需要在请求后立即等待）。

## 执行约束

- 不修改 admin/ops/dealer 密码；重置密码成功场景只对新建临时管理员执行。
- 不删除既有业务数据；调试模式测试结束后恢复为关闭（localStorage 值可为 `0` 或 `1`）。
- 所有用例可任意顺序执行。

## Test Scenarios

### 1. 登录与会话

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 未登录访问受保护路由重定向到登录页并携带 redirect

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 在无登录态上下文打开 `/goods/create`
    - expect: URL 变为 `/login?redirect=%2Fgoods%2Fcreate`（或等价编码形式）
    - expect: 显示登录卡片标题「登录」与副标题「请使用管理员分配的账号登录」
    - expect: 存在 `input[placeholder="邮箱"]`、`input[placeholder="密码"]`、`button:has-text("登 录")`
  2. 读取地址栏 redirect 查询参数
    - expect: redirect 参数存在且解码后为 `/goods/create`

#### 1.2. 登录表单必填与邮箱格式校验

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 打开 `/login`，不填写内容直接点击「登录」
    - expect: 邮箱下显示「请输入邮箱」
    - expect: 密码下显示「请输入密码」
    - expect: URL 仍为 `/login`，不出现侧边栏
  2. 邮箱输入 `not-an-email`、密码输入 `x`，点击「登录」
    - expect: 显示「邮箱格式不正确」
    - expect: URL 仍为 `/login`，不发起成功跳转

#### 1.3. 错误密码登录失败

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 打开 `/login`，输入 admin@local.dev / wrong-password，点击「登录」
    - expect: 表单上方出现 `.ant-alert-error` 错误提示
    - expect: URL 仍匹配 `/login`
    - expect: 不出现 `.ant-layout-sider`

#### 1.4. 正确账号登录后进入概览并提示登录成功

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 打开 `/login`，输入 admin@local.dev / Admin@123456，点击「登录」
    - expect: URL 在 45 秒内变为 `/dashboard`
    - expect: 出现侧边栏 `.ant-layout-sider` 与 Header 标题「概览」
    - expect: 出现全局提示「登录成功」

#### 1.5. 登录后回到 redirect 指定页面，已登录访问登录页自动跳转

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 无登录态打开 `/goods/create`，等待跳到登录页
    - expect: URL 包含 `/login` 与 `redirect=`
  2. 使用 dealer@local.dev / Dealer@123456 登录
    - expect: URL 最终为 `/goods/create`
    - expect: Header 标题为「创建预约」
  3. 退出后以 admin 登录，再直接访问 `/login`
    - expect: URL 自动跳转为 `/dashboard`
    - expect: 不显示登录卡片

#### 1.6. 退出登录清除会话并触发守卫

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 dealer 登录进入 `/dashboard`，点击 Header 用户下拉后点击「退出登录」
    - expect: URL 变为 `/login?redirect=%2Fdashboard`（至少以 `/login` 开头）
    - expect: 用户下拉与侧边栏消失
  2. 退出后直接访问 `/dashboard`
    - expect: URL 重定向为 `/login?redirect=%2Fdashboard`
    - expect: 不显示概览欢迎卡片

#### 1.7. 未知路由重定向到概览

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 登录后访问 `/not-exist/route`
    - expect: URL 变为 `/dashboard`
    - expect: Header 标题为「概览」

### 2. 应用外壳与通用导航

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 侧边栏品牌、菜单结构与 Header 标题

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 登录进入 `/dashboard`
    - expect: 侧边栏顶部显示「会员管理后台」与「Admin Console」
    - expect: 可见顶层菜单：概览、订单管理、财务、站点管理、后台权限
    - expect: Header 标题为「概览」，概览菜单项带 `ant-menu-item-selected`
  2. 依次展开「订单管理」「财务」「站点管理」「后台权限」
    - expect: 子项分别为：创建预约/预约订单/履约订单/历史订单；钱包/账户变动/充值审核/扣费审核；汇率管理/全局配置；管理员/角色
    - expect: 父项带 `ant-menu-submenu-open`
  3. 点击「站点管理 > 汇率管理」
    - expect: URL 为 `/site/exchange-rates`
    - expect: Header 标题为「汇率管理」
    - expect: 对应菜单项高亮

#### 2.2. 深链接进入时父菜单自动展开且标题正确

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 直接访问 `/goods/fulfill`
    - expect: Header 标题为「履约订单」
    - expect: 订单管理菜单自动展开、「履约订单」高亮
  2. 直接访问 `/finance/recharge`
    - expect: Header 标题为「充值审核」
    - expect: 财务菜单自动展开

#### 2.3. admin 可见全部菜单项

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 登录并展开全部子菜单
    - expect: 可见全部叶子菜单：创建预约、预约订单、履约订单、历史订单、钱包、账户变动、充值审核、扣费审核、汇率管理、全局配置、管理员、角色

#### 2.4. ops 仅可见运营相关菜单

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 ops@local.dev / Ops@123456 登录，展开全部菜单
    - expect: 可见叶子：履约订单、历史订单、钱包、账户变动、充值审核、扣费审核、汇率管理、全局配置
    - expect: 不可见叶子：创建预约、预约订单、管理员、角色
    - expect: 「后台权限」显示为无子项的顶层菜单项（已知缺陷）

#### 2.5. dealer 仅可见经销商相关菜单

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 dealer@local.dev / Dealer@123456 登录，展开全部菜单
    - expect: 可见叶子：创建预约、预约订单、历史订单、钱包、账户变动
    - expect: 不可见叶子：履约订单、充值审核、扣费审核、汇率管理、全局配置、管理员、角色
  2. 检查「后台权限」菜单
    - expect: 实际显示为无子项、点击无反应的顶层菜单项；记录为菜单过滤缺陷
    - expect: 展开后无任何子项

#### 2.6. 浏览器刷新后登录态与当前页面保持

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 登录进入 `/site/config` 后刷新
    - expect: 刷新后仍停留在 `/site/config`
    - expect: 侧边栏与 Header 正常渲染，不闪回登录页
    - expect: 全局配置表单显示已加载的值

### 3. 权限守卫与直接 URL 访问

**Seed:** `e2e/seed.spec.ts`

#### 3.1. dealer 直接访问履约订单列表：403 提示 + 空表

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 dealer 登录态访问 `/goods/fulfill`
    - expect: 页面外壳正常渲染，Header 为「履约订单」
    - expect: 在请求后 3 秒内出现全局提示 `Insufficient permission`
    - expect: 表格显示「暂无数据」，无业务数据
    - expect: 不显示经销商筛选（该筛选要求 ops 或履约只读权限）

#### 3.2. 无权限用户直接访问管理员列表：403 提示 + 空表

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 dealer 或 ops 登录态访问 `/rbac/users`
    - expect: 页面渲染卡片「管理员」
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格列头存在但内容为「暂无数据」
    - expect: 不显示「新建用户」按钮，操作列无按钮

#### 3.3. ops 直接访问创建预约页：页面可见但无法创建/下载模板

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 ops 登录态访问 `/goods/create`
    - expect: 页面标题与卡片标题为「创建预约」
    - expect: 显示上传说明和「下载模板」「选择 Excel」按钮
    - expect: 「确认创建」在未上传文件时 disabled
  2. 点击「下载模板」
    - expect: 出现 `Insufficient permission` 错误提示（模板接口要求 goods_reserve_create 只读权限）
    - expect: 不产生有效下载；页面不崩溃

#### 3.4. dealer 直接访问充值审核页面：403 提示且无写入口

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 dealer 登录态访问 `/finance/recharge`
    - expect: 页面渲染「充值审核」卡片
    - expect: 不显示「新增充值」按钮
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格显示「暂无数据」，操作列无「审核」

#### 3.5. 不存在/非法订单 id 显示空态而非白屏

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 dealer 访问不属于自己的订单 `/goods/reserve/999999991`
    - expect: 页面渲染卡片「订单不存在」
    - expect: 出现「无权查看该订单」或 `Insufficient permission` 提示
    - expect: 不出现白屏或未捕获异常
  2. 访问 `/goods/reserve/not-a-number`
    - expect: 不发请求或请求失败后可恢复
    - expect: 页面显示「订单不存在」，不崩溃

### 4. 用户下拉、调试模式与重置密码

**Seed:** `e2e/seed.spec.ts`

#### 4.1. 超级管理员用户下拉包含调试模式，开关可持久化

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 登录后点击 Header 用户下拉
    - expect: 包含「调试模式」及一个 Switch
    - expect: 包含「重置密码」「退出登录」
    - expect: 不包含「个人资料」
  2. 打开调试模式开关
    - expect: 提示「调试模式已开启」
    - expect: `localStorage['member-admin-debug-mode']` 值为 `1`
    - expect: 刷新后开关仍为开启
  3. 再次点击开关关闭
    - expect: 提示「调试模式已关闭」
    - expect: localStorage 值为 `0`

#### 4.2. 非超级管理员看不到调试模式

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 ops 登录进入 `/dashboard`，点击用户下拉
    - expect: 不出现「调试模式」
    - expect: 仍可见「重置密码」「退出登录」
  2. 以 dealer 登录重复检查
    - expect: 不出现「调试模式」

#### 4.3. 重置本人密码弹窗的校验与取消

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 登录，打开用户下拉并点击「重置密码」
    - expect: 弹窗标题为「重置密码」
    - expect: 显示说明「可手动输入新密码，或生成随机密码。重置成功后将立即退出登录，请使用新密码重新登录。」
    - expect: 字段「新密码」、按钮「生成随机密码」，底部按钮为「取 消」「确认重置」
  2. 清空新密码后点击「确认重置」
    - expect: 显示「请输入新密码」
    - expect: 弹窗不关闭，不调用修改密码接口
  3. 输入 5 位密码 `abc12` 后点击「确认重置」
    - expect: 显示「密码至少 6 位」
    - expect: 弹窗不关闭
  4. 点击「生成随机密码」
    - expect: 输入框填入 12 位随机密码
    - expect: 密码默认可见，约 5 秒后自动隐藏为密文
  5. 点击「取消」，再重新打开弹窗
    - expect: 弹窗关闭
    - expect: 再次打开时输入框已清空

#### 4.4. 重置本人密码成功后强制退出（使用临时管理员）

**File:** `e2e/plan/00-navigation.spec.ts`

**Steps:**
  1. 以 admin 在 `/rbac/users` 新建临时管理员 temp_pwd_<stamp>@local.dev（密码 Test@12345678）并分配任一角色，随后退出 admin
    - expect: 临时用户出现在列表
    - expect: 临时用户可成功登录
  2. 以临时用户登录，打开用户下拉 → 重置密码，输入 `NewPass@123` 并确认
    - expect: 提示「密码已重置，请使用新密码重新登录」
    - expect: URL 以 `/login` 开头
    - expect: 再访问 `/dashboard` 被重定向到登录页
  3. 用新密码登录临时用户，最后由 admin 删除临时用户
    - expect: 新密码可登录
    - expect: 仅删除本次临时用户，不影响既有账号

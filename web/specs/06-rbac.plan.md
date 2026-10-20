# 06 后台权限测试计划

## Application Overview

后台权限菜单：管理员 `/rbac/users`、角色 `/rbac/roles`，以及权限配置对菜单、按钮、接口和路由守卫的联动影响。

## 环境与前提

- baseURL：`http://localhost:5288`；seed：`e2e/seed.spec.ts`。
- 超级管理员：`admin@local.dev / Admin@123456`（列表显示红色「超级管理员」标签，操作列为「—」）。
- 所有新建数据使用唯一时间戳：用户邮箱 `pw-rbac-<stamp>@local.dev`，角色名 `PW角色<stamp>`，初始密码 `PwTest@123`。
- 跨角色验证使用独立浏览器上下文/存储态登录新用户，避免污染 admin 会话。
- 权限码：`user_config`、`role_config`（父级 `auth`）；财务 `wallet`/`trade_log`/`recharge`/`deduction`；订单 `goods_reserve_create`/`goods_reserve_order`/`goods_fulfill_order`/`goods_history_order`；站点 `exchange_rate`/`site_config`。
- 权限模式：`rw` 读写、`ro` 只读；超级管理员绕过所有校验。

## 关键规则（与实现一致）

- 新建用户：邮箱、用户名、姓名（可选）、初始密码；密码最少 8 位；创建后默认无角色。
- 修改用户：用户名、邮件地址、姓名；邮箱重复报「邮箱已被占用」。
- 新建用户邮箱重复报「User already exists」。
- 重置密码：先填新密码（>=8），确定后二次确认「确认重置该管理员密码？」；成功「重置密码成功」。
- 分配角色：多选下拉（占位「选择角色」）；成功「角色已更新」。
- 删除用户：确认框「确认删除该用户？」内容为邮箱；成功「已删除」；物理删除。
- 超级管理员不可修改/删除/重置密码/分配角色。
- 角色列表无分页；列为角色名、Key、描述、创建时间、操作。
- 添加角色：角色名必填「请输入角色名」；Key 可选（提示「可选；不填则按角色名拼音生成。经销商/运营请使用 dealer / ops」）。
- 删除角色：确认框「确认删除该角色？」内容为角色名。
- 设置权限：Tree 默认展开全部；节点标题 `${name} (${code})`；轮询/勾选叶子默认「读写」，可切换「只读」；保存「权限已保存」。
- 只读角色（`role_config: ro`）可打开设置权限弹窗，但确定按钮 disabled；Tree 本身未禁用，仍可勾选（疑似缺陷）。

## 已知缺陷与已修复项（重要）

1. **角色权限回显（已修复，2026-10-19，需回归）**：`GET /api/rbac/roles/:id/permissions` 现返回与 `PUT` 请求体一致的结构：
   ```json
   { "permissionIds": [4, 5], "readOnlyPermissionIds": [6] }
   ```
   修复前服务端返回权限对象数组，`RolesPage` 按 `{ permissionIds, readOnlyPermissionIds }` 解析得到 `undefined`，权限树始终不勾选，误点「确定」会提交空数组清空该角色权限。修复后运营专员弹窗应正确勾选其 11 项权限，并显示「已选权限读写级别」；权限加载失败时前端会关闭弹窗，避免误提交空权限。
   **回归约束**：3.1、3.2 按修复后行为断言；权限保存类用例仍使用本次新建的专用测试角色，并通过 `GET /api/rbac/roles/:id/permissions` 校验。
2. **空「后台权限」菜单**：`rbac` 父菜单没有 permission 字段。子项全部被过滤后，`filterMenus` 仍保留该父项并去掉 children，最终显示为无子项、点击无反应的顶层菜单项。ops/dealer 实测可见。
3. **无路由级权限守卫**：无权限用户直接输入 URL 时页面骨架渲染，接口 403 后弹出英文全局提示 `Insufficient permission`，页面显示空表/空表单，而不是跳转 403/首页。

## 主要定位

- 卡片：「管理员」「角色」；按钮：「新建用户」「修改」「重置密码」「分配角色」「删除」「添加角色」「设置权限」。
- 弹窗：新建用户 / 修改用户 — name / 重置密码 — name / 分配角色 — email / 添加角色 / 修改角色 / 设置权限 — roleName。
- AntD 两字按钮可访问名带空格：`查 询`、`确 定`、`取 消`、`保 存`；403 提示文本为 `Insufficient permission`。

## 数据安全

- 不修改、不删除、不重置 admin 或任何既有账号密码/角色。
- 删除类用例只删除本计划创建的专用测试用户/角色。
- 新建测试用户与角色执行后保留，便于复现；但权限清空风险操作绝不对既有角色执行。
- 不复用 ops/dealer 账号做破坏性修改。

## Test Scenarios

### 1. 管理员列表与用户管理

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 管理员列表结构与超级管理员保护

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以 admin 访问 `/rbac/users`
    - expect: 卡片标题「管理员」
    - expect: 存在「新建用户」按钮
    - expect: 表格列：邮箱、用户名、姓名、角色、创建时间、操作
    - expect: admin 行角色列显示红色「超级管理员」标签
    - expect: admin 行操作列为「—」，无任何操作按钮
  2. 检查页面能力
    - expect: 无搜索框、状态筛选、启用/禁用按钮
    - expect: 分页每页 20 条

#### 1.2. 新建用户必填与格式校验

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 点击「新建用户」，直接点「确 定」
    - expect: 出现「请输入邮箱」「请输入用户名」「请输入密码」
    - expect: 弹窗不关闭
  2. 邮箱填 `not-an-email`
    - expect: 提示「邮箱格式不正确」
  3. 密码填 `1234567`
    - expect: 提示「至少 8 位」

#### 1.3. 创建测试用户成功并默认无角色

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 填写唯一邮箱、用户名、姓名、密码 `PwTest@123`，确定
    - expect: 提示「用户已创建」
    - expect: 弹窗关闭，列表出现新用户
    - expect: 角色列为「—」
  2. 用新用户登录
    - expect: 登录成功进入 `/dashboard`
    - expect: 侧边栏无业务菜单
    - expect: 实际可见「概览」与无子项的「后台权限」顶层项；记录空菜单缺陷

#### 1.4. 重复邮箱创建失败

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 新建用户，邮箱填 dealer@local.dev
    - expect: 出现「User already exists」提示
    - expect: 不新增用户

#### 1.5. 修改用户与邮箱占用校验

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 对测试用户点击「修改」
    - expect: 标题「修改用户 — <name>」
    - expect: 用户名、邮件地址、姓名正确回填
  2. 修改姓名为 `PW姓名<stamp>` 并确定
    - expect: 提示「修改成功」
    - expect: 列表姓名更新
  3. 再次修改，邮箱改为 dealer@local.dev
    - expect: 提示「邮箱已被占用」，不保存

#### 1.6. 重置测试用户密码

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 点击「重置密码」，输入 7 位密码
    - expect: 提示「至少 8 位」，不进入二次确认
  2. 输入 `PwNew@1234`，点击「确 定」
    - expect: 出现二次确认「确认重置该管理员密码？」
  3. 确认
    - expect: 提示「重置密码成功」
    - expect: 弹窗关闭
  4. 用新密码登录测试用户
    - expect: 登录成功

#### 1.7. 分配角色与更新提示

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 点击测试用户「分配角色」
    - expect: 标题「分配角色 — <email>」
    - expect: 多选下拉占位「选择角色」，选项为现有角色名
  2. 选择「运营专员」并确定
    - expect: 提示「角色已更新」
    - expect: 角色列显示「运营专员」标签
  3. 重新打开，取消全部选择并确定
    - expect: 角色列变为「—」

#### 1.8. 删除专用测试用户

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 创建仅用于删除的测试用户，点击「删除」
    - expect: 确认框「确认删除该用户？」，内容为该邮箱
  2. 取消
    - expect: 用户仍存在
  3. 再次删除并确认
    - expect: 提示「已删除」
    - expect: 列表不再出现该用户

#### 1.9. 无权限用户访问管理员页面

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以 dealer 或新建无 user_config 权限用户访问 `/rbac/users`
    - expect: 页面渲染卡片「管理员」但无「新建用户」按钮，操作列无按钮
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格「暂无数据」，页面不白屏

### 2. 角色管理

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 角色列表结构

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以 admin 访问 `/rbac/roles`
    - expect: 卡片标题「角色」
    - expect: 存在「添加角色」按钮
    - expect: 列为角色名、Key、描述、创建时间、操作
    - expect: 操作列含「设置权限」「修改」「删除」
    - expect: 无分页器
    - expect: 实际已有角色：只读角色（Key —）、经销商（dealer）、运营专员（ops）

#### 2.2. 添加角色必填与成功

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 点击「添加角色」，直接确定
    - expect: 提示「请输入角色名」，弹窗不关闭
  2. 填角色名 `PW角色<stamp>`、描述 `plan-test`，Key 留空，确定
    - expect: 提示「角色已创建」
    - expect: 列表新增角色，Key 自动生成且非空
  3. 刷新页面
    - expect: 角色仍存在

#### 2.3. 自定义 Key 创建角色

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 新建角色，Key 填 `pw_role_<stamp>`
    - expect: 创建成功，列表 Key 显示该值（或规范化后的值）

#### 2.4. 修改角色

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 对测试角色点击「修改」
    - expect: 标题「修改角色」
    - expect: 角色名/Key/描述回填
  2. 修改描述为 `updated-<stamp>` 并确定
    - expect: 提示「角色已更新」
    - expect: 列表描述更新

#### 2.5. 删除角色确认与效果

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 创建仅用于删除的测试角色，点击「删除」
    - expect: 确认框「确认删除该角色？」，内容为角色名
  2. 取消后角色仍存在；再次删除并确认
    - expect: 提示「已删除」
    - expect: 列表不再出现该角色
  3. 检查原持有该角色的测试用户
    - expect: 用户角色列不再包含该角色（若已分配）

#### 2.6. 只读权限用户看到角色页

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以仅 `role_config: ro` 的测试用户访问 `/rbac/roles`
    - expect: 无「添加角色」按钮
    - expect: 操作列只有「设置权限」，无「修改」「删除」

### 3. 权限树与读写级别

**Seed:** `e2e/seed.spec.ts`

#### 3.1. 权限弹窗结构与回显（回归）

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以 admin 在 `/rbac/roles` 对「运营专员」点击「设置权限」，只观察不保存
    - expect: 标题「设置权限 — 运营专员」
    - expect: Tree 默认展开全部父子节点
    - expect: 节点标题格式 `<权限名> (<code>)`，如「钱包 (wallet)」「充值审核 (recharge)」
    - expect: 运营专员已有权限被勾选（勾选节点数 > 0，且「钱包 (wallet)」为勾选状态）
    - expect: 显示「已选权限读写级别」区域及逐项的「读写 / 只读」切换
  2. 读取 `GET /api/rbac/roles/3/permissions` 并对比弹窗
    - expect: 返回对象 `{ permissionIds, readOnlyPermissionIds }`（不是数组）
    - expect: 运营专员 `permissionIds` 共 11 项（finance、wallet、trade_log、recharge、deduction、site、exchange_rate、site_config、goods、goods_fulfill_order、goods_history_order）
    - expect: 弹窗勾选的叶子权限集合与接口两个数组的并集中的叶子项一致
  3. 点击「取 消」关闭弹窗
    - expect: 关闭后角色权限未变化

#### 3.2. 专用测试角色保存只读级别并通过 API 校验

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 新建专用测试角色并点击「设置权限」
    - expect: 弹窗打开，初始无勾选（新角色无权限）
  2. 仅勾选 `wallet` 叶子，将级别切换「只读」，点击「确 定」
    - expect: 提示「权限已保存」，弹窗关闭
  3. 调用 `GET /api/rbac/roles/:id/permissions` 校验
    - expect: 返回 `{ permissionIds, readOnlyPermissionIds }`
    - expect: `readOnlyPermissionIds` 包含 wallet
    - expect: `permissionIds` 不包含 wallet，也不包含其它未勾选权限
  4. 重新打开该角色「设置权限」
    - expect: wallet 节点为勾选状态，级别显示「只读」
    - expect: 只观察后取消，不点击确定

#### 3.3. 父子联动取消勾选并保存

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 对专用测试角色勾选父节点「财务」，再取消其中一个叶子 `recharge`
    - expect: 财务下其余叶子保持勾选
    - expect: 父节点显示半选状态
    - expect: 下方级别列表不含 `recharge`
  2. 保存并通过 API 校验
    - expect: 提示「权限已保存」
    - expect: GET 返回 wallet/trade_log/deduction 等，且不含 recharge

#### 3.4. 只读角色可打开权限树但不可保存

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以仅 `role_config: ro` 的测试用户打开「设置权限」
    - expect: 「确 定」按钮 disabled
    - expect: 级别单选 disabled
  2. 尝试勾选节点
    - expect: 当前 Tree 仍可勾选（Tree 未设置 disabled，记录为疑似缺陷）
    - expect: 无论是否可勾选，均无法保存

#### 3.5. 权限保存失败提示

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 拦截 `PUT /api/rbac/roles/:id/permissions` 返回 500，保存权限
    - expect: 出现错误提示
    - expect: 权限未改变
    - expect: 按钮 loading 结束恢复可用

### 4. 权限联动与路由行为

**Seed:** `e2e/seed.spec.ts`

#### 4.1. 只读钱包角色登录后的菜单过滤

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 创建角色 A 仅授予 `wallet: ro`；创建用户 U 并分配角色 A；以 U 登录
    - expect: 侧边栏显示「概览」「财务 > 钱包」
    - expect: 实际还会显示无子项的「后台权限」顶层项（缺陷）
    - expect: 不显示订单管理、站点管理、账户变动、充值审核、扣费审核
    - expect: 不显示「管理员」「角色」
  2. 进入 `/finance/wallet`
    - expect: 页面可加载
    - expect: 无经销商筛选与查询按钮
    - expect: 接口不返回 403
  3. 直接访问 `/finance/recharge`
    - expect: 页面骨架渲染，无「新增充值」
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格「暂无数据」，不白屏

#### 4.2. 空父菜单显示（已知缺陷复现）

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 创建不授予任何权限的角色 B，分配给用户 U2 并登录
    - expect: 产品预期：侧边栏不应出现任何分组
    - expect: 实际：显示「概览」与一个无子项的「后台权限」顶层菜单项
  2. 点击或展开「后台权限」
    - expect: 无任何子项
    - expect: 点击无导航反应
    - expect: 记录为可复现的菜单过滤缺陷

#### 4.3. 增加权限后菜单生效

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 给角色 A 增加 `recharge: rw`，保存后用户 U 刷新或重新登录
    - expect: 侧边栏出现「财务 > 充值审核」
    - expect: 进入页面可见「新增充值」与审核按钮
  2. 移除 `recharge` 后刷新
    - expect: 充值审核菜单消失
    - expect: 已有页面再次请求时接口 403 并提示 `Insufficient permission`

#### 4.4. 路由级权限守卫观察

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 以无 `site_config` 权限用户直接访问 `/site/config`
    - expect: 当前实现先渲染页面骨架（无保存/重置按钮）
    - expect: 接口 403 后出现 `Insufficient permission` 提示
    - expect: 记录：缺少路由级预校验，建议跳转 403/首页
  2. 以无 `goods_fulfill_order` 权限用户访问 `/goods/fulfill`
    - expect: 页面渲染后接口 403，出现 `Insufficient permission`
    - expect: 列表为空，无编辑入口

#### 4.5. 未登录访问 RBAC 页面

**File:** `e2e/plan/06-rbac.spec.ts`

**Steps:**
  1. 清除 cookie 后访问 `/rbac/users`
    - expect: 重定向到 `/login?redirect=%2Frbac%2Fusers`
  2. 登录后自动回到 `/rbac/users`
    - expect: 页面正常加载
    - expect: admin 可见全部功能

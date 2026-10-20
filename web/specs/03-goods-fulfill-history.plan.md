# 03 履约订单与历史订单测试计划

## Application Overview

订单管理下的履约订单列表 `/goods/fulfill`、履约订单详情 `/goods/fulfill/:id`、历史订单列表 `/goods/history`、历史订单详情 `/goods/history/:id`。

## 环境与前提

- baseURL：`http://localhost:5288`；seed：`e2e/seed.spec.ts`。
- 履约操作使用 ops 登录态；查看/隔离校验使用 dealer 与 admin。
- 预约订单需先存在：可通过 02 计划创建，或 `e2e/helpers/goods.ts` 的 `createReserveOrder` 创建后用 `submitFulfill` 推入待履约。

## 业务规则（与实现一致）

- 状态机：`reserving`（预约中）→ `pending_fulfill`（待履约）→ `partial_fulfill`（部分履约）/ `fulfilled`（已履约）→ `completed`（已完成）。
- `computeFulfillStatus`：全部履约数量为 0 → 待履约；存在 >0 且每行履约量 >= 预约量 → 已履约；否则 → 部分履约。
- 履约数量只能由运营或超管编辑；履约数量为整数且 >= 0；允许超过预约量，界面显示「与预约 N 不一致」警告。
- 提交完成：仅 `partial_fulfill` / `fulfilled` 且用户为运营或超管；已生成扣费单报「已生成扣费单」；无可扣费行报「没有可扣费的履约商品」；金额 <= 0 报「扣费金额必须大于 0」。
- 提交完成后订单进入 `completed`，生成待审核扣费单，并跳转历史详情。
- 历史列表只包含已完成订单，操作仅「查看」，详情完全只读。
- 列表分页每页 20 条；履约列表支持经销商 + 状态筛选；历史列表只支持经销商筛选。

## 实测界面结构

- 履约列表列：订单号、经销商、状态、币种、商品行、预约量、履约量、创建时间、操作；操作只有「查看」，无取消。
- 履约详情（待履约）：标题「订单 <订单号>」+「待履约」+「价格已填完」；Descriptions 为 经销商、币种、创建时间、扣费单、经销商备注；右上角只有「保 存」；履约数量为 InputNumber（min=0，precision=0）。
- 履约详情（部分履约/已履约）：右上角额外显示「提交完成」，表格可能出现「与预约 N 不一致」。
- 历史详情：标题 +「已完成」+「价格已填完」；无任何操作按钮；有扣费单链接与「扣费原币金额」，格式如 `USD 10.00（折合 USD 10.00）`。
- 历史列表实测列同履约列表；状态均为「已完成」。

## 权限与已知问题

- dealer 访问 `/goods/fulfill`：页面渲染但接口 403，弹出 `Insufficient permission`，表格「暂无数据」，无经销商筛选。
- dealer 打开自己的 `/goods/fulfill/:id`：可只读查看；打开他人订单提示「无权查看该订单」并显示「订单不存在」卡片。
- 列表首次进入存在竞态，偶发「暂无数据」；遇空表先点击 `查 询` 再断言。
- 403 提示为英文 `Insufficient permission`，约 3 秒后消失。
- AntD 两字按钮可访问名带空格：`查 询`、`保 存`、`确 定`、`取 消`。

## 数据安全

- 提交完成会生成不可逆的财务扣费单，仅对本次创建的测试订单执行；不对既有真实订单执行。
- 不删除任何订单；审批/完成类操作只作用于带唯一标记的测试数据。

## Test Scenarios

### 1. 履约订单列表

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 列表结构与筛选控件

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 ops 登录并访问 `/goods/fulfill`
    - expect: 卡片标题「履约订单」
    - expect: 存在经销商下拉（占位「选择经销商」）、状态下拉（占位「状态」）和 `查 询` 按钮
    - expect: 表格列依次为 订单号、经销商、状态、币种、商品行、预约量、履约量、创建时间、操作
    - expect: 不存在预约列表才有的「价格」列
    - expect: 操作列只有「查看」
  2. 若首次显示「暂无数据」，点击「查 询」等待请求完成
    - expect: 表格出现数据，分页器「1 2」可见（总数 >20 时）

#### 1.2. 按状态筛选待履约/部分履约/已履约

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 在状态下拉选择「待履约」（可再点查询）
    - expect: 每行状态标签为「待履约」
    - expect: 页码回到 1
  2. 依次选择「部分履约」「已履约」
    - expect: 每行状态标签与所选一致
    - expect: 已完成订单不出现在任何选项结果中
  3. 清空状态
    - expect: 三类履约状态订单均可能出现

#### 1.3. 按经销商筛选

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 在经销商下拉选择一个经销商并查询
    - expect: 列表只显示该经销商订单
    - expect: 每行经销商列与所选一致
  2. 清空经销商筛选
    - expect: 恢复显示全部经销商数据

#### 1.4. 查看进入履约详情

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 点击某个测试订单行的「查看」
    - expect: URL 为 `/goods/fulfill/<id>`
    - expect: 详情页订单号与列表一致

#### 1.5. 分页与空态

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 当履约订单超过 20 条时切到第 2 页
    - expect: 请求 page=2&pageSize=20
    - expect: 每页最多 20 行，页码 2 高亮
  2. 选择一个无数据经销商或状态组合
    - expect: 表格显示「暂无数据」
    - expect: 页面无报错

#### 1.6. dealer 访问履约列表的权限表现

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 dealer 登录访问 `/goods/fulfill`
    - expect: 页面外壳渲染，Header 为「履约订单」
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格显示「暂无数据」
    - expect: 不显示经销商筛选下拉
  2. 以 dealer 打开自己的履约订单详情 `/goods/fulfill/<id>`
    - expect: 页面只读：无保存、无履约数量输入框、无提交完成
    - expect: 价格与数量以文本显示
  3. 以 admin 访问 `/goods/fulfill`
    - expect: 可见所有经销商订单

### 2. 履约详情与提交完成

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 待履约详情结构与只读价格

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 ops 打开一个「待履约」测试订单 `/goods/fulfill/:id`
    - expect: 标题为「订单 <订单号>」+「待履约」+「价格已填完」
    - expect: 价格显示为只读文本，无输入框/同步按钮
    - expect: 履约数量为可编辑 InputNumber（min=0，precision=0）
    - expect: 右上角只有「保 存」，无「提交履约」「取消订单」「提交完成」
    - expect: Descriptions 含 经销商、币种、创建时间、扣费单（—）、经销商备注

#### 2.2. 部分填写履约数量后状态变为部分履约

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 对一个两行订单，将第 1 行履约数量设为 1、第 2 行保持 0，点击「保 存」
    - expect: 出现「已保存」
    - expect: 状态标签变为「部分履约」
    - expect: 履约量合计更新为 1
    - expect: 出现「提交完成」按钮

#### 2.3. 履约数量与预约不一致时显示警告

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 将某行履约数量改为既非 0 也不等于预约量（如预约 2、履约 1）
    - expect: 输入框旁出现黄色「与预约 2 不一致」
    - expect: 仍可保存（后端不强制等于预约量）
  2. 将履约数量改为等于预约量
    - expect: 警告消失

#### 2.4. 全部履约后状态变为已履约，改回 0 回到待履约

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 将所有行履约数量设为等于或大于预约量，点击「保 存」
    - expect: 出现「已保存」
    - expect: 状态标签变为「已履约」
    - expect: 履约量合计 >= 预约量合计
    - expect: 仍显示「提交完成」
  2. 将全部履约数量改回 0 并保存
    - expect: 状态回到「待履约」
    - expect: 「提交完成」按钮消失

#### 2.5. 非法履约数量被拒绝

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 通过接口提交 fulfillQty = -1
    - expect: 接口返回 400「履约数量无效」
    - expect: 页面数据不变
  2. 提交 fulfillQty = 1.5
    - expect: 接口返回 400「履约数量无效」
  3. 检查界面输入框
    - expect: min=0 且 precision=0，无法通过微调按钮得到负数或小数

#### 2.6. 部分履约提交完成并生成扣费单

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 在部分履约测试订单上点击「提交完成」
    - expect: 弹出标题「提交完成并生成扣费」
    - expect: 内容「当前为「部分履约」。未履约（履约数量为 0）的商品将不计入扣费金额。确认提交完成？」
    - expect: OK 文案「确认部分履约完成」
  2. 点击「确认部分履约完成」
    - expect: 出现「已完成，扣费单已生成」
    - expect: URL 跳转为 `/goods/history/<id>`
    - expect: 详情状态为「已完成」
    - expect: 出现「扣费原币金额」且大于 0
  3. 检查扣费单字段
    - expect: 「扣费单」显示 `DD...` 编号链接
    - expect: 点击链接跳转 `/finance/deduction`

#### 2.7. 已履约提交完成的文案与结果

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 在「已履约」测试订单点击「提交完成」
    - expect: 内容为「提交后订单变为已完成，并生成待审核扣费单。确认？」
    - expect: OK 文案「确认提交」
  2. 点击「确认提交」
    - expect: 提示「已完成，扣费单已生成」
    - expect: 跳转 `/goods/history/:id`
    - expect: 该订单从履约列表 `/goods/fulfill` 中消失

#### 2.8. 零金额订单提交完成失败

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 准备所有单价为 0 且部分/全部履约的测试订单，点击「提交完成」并确认
    - expect: 出现「扣费金额必须大于 0」
    - expect: 订单仍在当前详情页
    - expect: 状态保持部分履约/已履约，不生成扣费单

#### 2.9. 无权限与不存在订单

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 dealer 打开他人履约订单 `/goods/fulfill/<id>`
    - expect: 出现「无权查看该订单」提示
    - expect: 页面显示「订单不存在」卡片，不白屏
  2. 以 ops 访问 `/goods/fulfill/999999992`
    - expect: 出现「订单不存在」提示
    - expect: 页面显示「订单不存在」卡片
  3. 访问 `/goods/fulfill/abc`
    - expect: 页面不崩溃
    - expect: 显示「订单不存在」

#### 2.10. 已取消订单不可履约完成

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 准备一个待履约后又被取消的测试订单，打开其履约详情
    - expect: 标题旁显示「已取消」
    - expect: 无保存/提交完成按钮
    - expect: 履约数量为只读
  2. 直接调用 `POST /api/goods/orders/:id/submit-complete`
    - expect: 返回 400「订单已取消」或类似提示
    - expect: 不生成扣费单

### 3. 历史订单列表与详情

**Seed:** `e2e/seed.spec.ts`

#### 3.1. 历史列表结构与只读操作

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 ops 访问 `/goods/history`，若首次为空则点击「查 询」
    - expect: 卡片标题「历史订单」
    - expect: 只有经销商筛选，没有状态筛选
    - expect: 表格列：订单号、经销商、状态、币种、商品行、预约量、履约量、创建时间、操作
    - expect: 每行状态均为「已完成」
    - expect: 操作列只有「查看」
    - expect: 分页可见（数据 >20 时显示 1 2）

#### 3.2. 历史详情只读并展示扣费信息

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 点击一个已生成扣费的历史订单「查看」
    - expect: URL 为 `/goods/history/<id>`
    - expect: 状态标签「已完成」+「价格已填完」
    - expect: 无保存、无提交完成、无取消订单、无价格/履约输入框
    - expect: 「扣费单」显示编号链接
    - expect: 「扣费原币金额」显示如 `USD 10.00（折合 USD 10.00）`

#### 3.3. 历史筛选与分页

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 选择某个经销商查询
    - expect: 只显示该经销商的历史订单
  2. 清空筛选并翻到第 2 页（>20 条时）
    - expect: 按创建时间倒序返回第 2 页，每页 20 条
  3. 选择无数据经销商
    - expect: 显示「暂无数据」

#### 3.4. 经销商历史数据隔离

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 dealer 访问 `/goods/history`
    - expect: 只显示自己的历史订单
    - expect: 无经销商筛选
  2. 以 dealer 打开他人历史详情
    - expect: 出现「无权查看该订单」提示
    - expect: 页面显示「订单不存在」卡片
  3. 以 admin 访问 `/goods/history`
    - expect: 可见全部经销商历史订单

#### 3.5. 历史详情扣费单链接跳转

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 在历史详情点击「扣费单」链接
    - expect: 跳转 `/finance/deduction`
    - expect: 目标页表格中存在该扣费单编号
    - expect: 该扣费单状态为「待审核」（若尚未审核）

#### 3.6. 不存在的历史订单

**File:** `e2e/plan/03-goods-fulfill-history.spec.ts`

**Steps:**
  1. 以 ops 访问 `/goods/history/999999993`
    - expect: 出现「订单不存在」提示
    - expect: 页面显示「订单不存在」卡片，无白屏

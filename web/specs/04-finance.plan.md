# 04 财务模块测试计划

## Application Overview

财务菜单下四个页面：钱包 `/finance/wallet`、账户变动 `/finance/trade-log`、充值审核 `/finance/recharge`、扣费审核 `/finance/deduction`。

## 环境与前提

- baseURL：`http://localhost:5288`；seed：`e2e/seed.spec.ts`。
- 管理员：`admin@local.dev / Admin@123456`（超级管理员，可审核自己提交的单据）。
- 运营：`ops@local.dev / Ops@123456`（财务四项均 rw；非超级管理员，不能审核自己提交的单据）。
- 经销商：`dealer@local.dev / Dealer@123456`（仅有 wallet/trade_log 只读）。
- 钱包记账币种固定 USD；充值/扣费可选 USD/CNY/EUR/GBP/JPY，审核时按汇率折算 USD 入账/扣减。

## 关键业务规则（与实现一致）

- 充值/扣费金额必须 > 0（前端 InputNumber min 0.01 precision 2；服务端「金额必须大于 0」）。
- 提交成功提示「已提交，等待审核」，初始状态 `isVerify=0`（待审核）。
- 审核弹窗：单选项「通过」/「拒绝」，审核备注可选；提交成功「审核完成」。
- 非超级管理员不能审核自己提交的单据：界面审核按钮 disabled；接口报「不能审核自己提交的充值单」/「不能审核自己提交的扣费单」。
- 已审核单据：界面不再显示「审核」；接口报「该单已审核」。
- 通过充值：钱包不存在则创建；余额 += amountBase；写一条 direction=in 的流水。
- 通过扣费：钱包余额不足报「余额不足」且不扣款；足够时余额 -= amountBase；写一条 direction=out 的流水。
- 拒绝：仅更新状态与审核人/时间，不影响余额和流水。
- 充值列表支持经销商 + 审核状态（待审核/已通过/已拒绝）筛选；扣费列表只支持经销商筛选（无状态筛选）。
- 列表均为服务端分页，每页 20 条。
- 钱包/账户变动对经销商只返回本人数据；充值/扣费菜单对经销商不可见，直接访问接口返回 403。

## 实测界面与文案

- 所有金额统一为「币种 + 两位小数」文本，例如 `USD 50378.80`、`EUR 10.00`，不是 `$`/`€` 符号。
- 经销商下拉占位「选择经销商」；充值审核状态下拉占位「审核状态」；账户变动方向下拉占位「方向」。
- 钱包列：钱包编号、经销商、币种、余额、最近交易、操作（「变动明细」）。
- 账户变动列：流水号、用户、方向、币种、原币金额、折算 USD、余额(USD)、关联单号、说明、时间。
- 充值列：单号、经销商、币种、原币金额、折算 USD、备注、提交人、状态、审核人、审核时间、提交时间、操作。
- 扣费列：单号、经销商、币种、原币金额、折算 USD、关联订单、备注、提交人、状态、审核人、时间、操作。
- 新增充值/新增扣费表单字段：经销商、币种、金额、备注。审核弹窗展示经销商、原币、入账/扣减 USD、提交人、备注，以及审核结果与审核备注。
- AntD 两字按钮可访问名带空格：`查 询`、`确 定`、`取 消`、`审 核`。
- 403 全局提示固定为 `Insufficient permission`，约 3 秒后消失。

## 数据安全（强制）

- 审核操作不可逆：只对本次用例新建的测试充值/扣费单执行；优先在弹窗阶段验证「取消」不改变数据。
- 不对既有真实单据执行通过/拒绝；余额不足等失败路径使用新建测试单据。
- 不删除任何单据、不清空钱包。
- 每次使用唯一备注（如 `pw-fin-<stamp>`）便于定位，执行后保留数据。
- 非 USD 汇率缺失场景只在 mock/隔离测试环境模拟，不得删除真实汇率配置。

## Test Scenarios

### 1. 钱包与账户变动

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 钱包列表结构与管理员筛选

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 admin 登录访问 `/finance/wallet`
    - expect: 卡片标题「钱包」
    - expect: 存在经销商下拉（占位「选择经销商」）与 `查 询` 按钮
    - expect: 表格列：钱包编号、经销商、币种、余额、最近交易、操作
    - expect: 余额显示为 `USD n.nn` 文本格式
    - expect: 每行操作列有「变动明细」

#### 1.2. 经销商只能查看自己的钱包且无筛选

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 dealer 登录访问 `/finance/wallet`
    - expect: 不显示经销商筛选下拉与查询按钮
    - expect: 表格仅包含当前经销商的钱包
    - expect: 币种为 USD

#### 1.3. 变动明细跳转并预选经销商

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 在钱包中定位 dealer 行，点击「变动明细」
    - expect: URL 为 `/finance/trade-log?userId=<dealerId>`
    - expect: 账户变动页的经销商下拉已预选该经销商
    - expect: 流水列表只显示该经销商记录

#### 1.4. 钱包空态与加载态

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 选择一个无钱包数据的经销商（或 mock 返回空数组）
    - expect: 表格显示「暂无数据」
    - expect: 页面不报错
  2. 刷新页面观察加载
    - expect: 表格出现加载遮罩，结束后遮罩消失

#### 1.5. 账户变动列表结构与方向筛选

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 admin 访问 `/finance/trade-log`
    - expect: 卡片标题「账户变动」
    - expect: 筛选区有经销商下拉、占位「方向」下拉和 `查 询` 按钮
    - expect: 表格列：流水号、用户、方向、币种、原币金额、折算 USD、余额(USD)、关联单号、说明、时间
    - expect: 没有导出按钮和日期范围筛选
  2. 选择方向「收入」并查询
    - expect: 所有行方向标签为「收入」
    - expect: 页码重置为 1
  3. 选择方向「支出」并查询
    - expect: 所有行方向标签为「支出」
  4. 清除方向
    - expect: 收入和支出均可能出现

#### 1.6. 账户变动分页与无结果

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 当流水超过 20 条时切到第 2 页
    - expect: 请求 page=2&pageSize=20
    - expect: 每页最多 20 条
  2. 选择一个无流水的经销商
    - expect: 显示「暂无数据」

#### 1.7. 经销商财务权限边界

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 dealer 访问 `/finance/trade-log`
    - expect: 只看得到自己的流水
    - expect: 无经销商筛选
    - expect: 保留方向筛选与查询
  2. 以 dealer 直接访问 `/finance/recharge`
    - expect: 菜单中无充值审核入口
    - expect: 页面渲染「充值审核」卡片但无「新增充值」
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格「暂无数据」，不显示审核按钮
  3. 以 dealer 直接访问 `/finance/deduction`
    - expect: 无「新增扣费」按钮，无审核按钮
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表格「暂无数据」

### 2. 充值审核

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 充值列表结构与筛选

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 ops 访问 `/finance/recharge`
    - expect: 卡片标题「充值审核」
    - expect: 存在「新增充值」按钮
    - expect: 筛选区有经销商下拉、占位「审核状态」下拉、`查 询` 按钮
    - expect: 表格列：单号、经销商、币种、原币金额、折算 USD、备注、提交人、状态、审核人、审核时间、提交时间、操作
    - expect: 待审核行显示「审 核」，已审核行操作列为「—」

#### 2.2. 新增充值必填校验

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 点击「新增充值」，直接点击「确 定」
    - expect: 经销商字段提示「请选择经销商」
    - expect: 金额字段提示「请输入金额」
    - expect: 弹窗不关闭
  2. 填写金额为 0 或负数
    - expect: InputNumber 最小值 0.01，无法提交 <=0
    - expect: 若通过脚本绕过，提交报「金额必须大于 0」

#### 2.3. 新增充值成功进入待审核

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 选择 dealer、币种 USD、金额 10、备注 `pw-fin-<stamp>`，点击「确 定」
    - expect: 出现「已提交，等待审核」
    - expect: 弹窗关闭，列表刷新
    - expect: 新记录状态「待审核」
    - expect: 原币金额 `USD 10.00`，折算 USD `USD 10.00`，提交人为当前 ops

#### 2.4. 审核弹窗先取消不改变数据

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 对新建的待审核充值单点击「审 核」，检查弹窗后点击「取 消」
    - expect: 弹窗标题「审核充值」
    - expect: 展示经销商、原币、入账 USD、提交人、备注
    - expect: 默认选中「通过」
    - expect: 取消后弹窗关闭
    - expect: 该单仍为「待审核」，仍显示「审 核」

#### 2.5. 审核通过后余额与流水正确

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 记录 dealer 当前钱包余额 B；由 ops 新建充值 10 USD，再由 admin 点击「审核」→「确 定」通过
    - expect: 出现「审核完成」
    - expect: 该单状态变为「已通过」，显示审核人/审核时间
    - expect: 操作列变为「—」
  2. 访问 `/finance/wallet` 查询该经销商
    - expect: 余额为 B + 10.00，显示为 `USD ...`
    - expect: 最近交易时间更新
  3. 访问 `/finance/trade-log` 查询该经销商
    - expect: 新增一条收入流水
    - expect: 原币金额 `USD 10.00`，折算 USD `USD 10.00`
    - expect: 余额(USD) = B + 10.00
    - expect: 说明/关联单号与充值单关联

#### 2.6. 审核拒绝不影响余额

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 记录 dealer 余额 B；由 ops 新建充值 5 USD，admin 审核时选择「拒绝」并填写 `pw-reject-<stamp>`，点击「确 定」
    - expect: 出现「审核完成」
    - expect: 状态变为「已拒绝」
    - expect: 审核备注在列表/接口中可查
  2. 再次查看钱包与流水
    - expect: 余额仍为 B
    - expect: 没有新增对应收入流水

#### 2.7. 非超管不能审核自己提交的充值单

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 ops 新建一笔充值，在列表中找到提交人为自己的待审核记录
    - expect: 该行「审 核」按钮为 disabled
  2. 通过接口直接调用审核接口
    - expect: 返回 403「不能审核自己提交的充值单」
    - expect: 单据仍为「待审核」
  3. 以 admin（超管）审核同一单据
    - expect: 审核按钮可用，可通过

#### 2.8. 已审核单据不可重复审核

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 对一条已通过/已拒绝的测试充值单发送审核请求
    - expect: 接口返回 400「该单已审核」
    - expect: 余额不重复变动

#### 2.9. 非 USD 币种按汇率折算入账

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 新建 EUR 10 的充值并审核通过
    - expect: 列表原币金额显示 `EUR 10.00`
    - expect: 折算 USD 等于按当前 EUR→USD 汇率换算结果
    - expect: 钱包余额增加对应 USD 金额
  2. 在 mock/隔离环境模拟缺少 EUR 汇率后新建 EUR 充值
    - expect: 提交报错「缺少汇率」或相似提示
    - expect: 不产生充值单
    - expect: 不得删除真实汇率配置

#### 2.10. 充值筛选与分页

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 按审核状态「待审核」查询
    - expect: 所有行状态为「待审核」
  2. 按经销商 + 已通过组合查询
    - expect: 结果同时满足两个条件
  3. 超过 20 条时翻页
    - expect: 每页 20 条，页码正确

### 3. 扣费审核

**Seed:** `e2e/seed.spec.ts`

#### 3.1. 扣费列表结构与关联订单

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 ops 访问 `/finance/deduction`
    - expect: 卡片标题「扣费审核」
    - expect: 有「新增扣费」按钮
    - expect: 筛选区只有经销商下拉与 `查 询`，没有审核状态筛选
    - expect: 表格列：单号、经销商、币种、原币金额、折算 USD、关联订单、备注、提交人、状态、审核人、时间、操作
    - expect: 由订单生成的扣费单「关联订单」为可点击订单号

#### 3.2. 新增扣费必填校验与成功进入待审核

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 点击「新增扣费」，不填直接确定
    - expect: 提示「请选择经销商」与「请输入金额」
  2. 选择 dealer、USD、金额 3.50、备注 `pw-ded-<stamp>`，确定
    - expect: 提示「已提交，等待审核」
    - expect: 新记录状态「待审核」
    - expect: 操作列显示「审 核」

#### 3.3. 审核通过扣减余额并写支出流水

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 确保 dealer 余额充足；记录余额 B，由 ops 新建扣费 3.50 USD，admin 审核通过
    - expect: 提示「审核完成」
    - expect: 状态变为「已通过」
  2. 查看钱包
    - expect: 余额为 B - 3.50
  3. 查看账户变动
    - expect: 新增一条方向「支出」流水
    - expect: 原币金额 `USD 3.50`，余额(USD) = B - 3.50
    - expect: 说明/关联单号对应扣费单

#### 3.4. 余额不足时扣费审核失败

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 新建一笔金额远大于 dealer 余额的测试扣费（如 999999 USD），由 admin 审核→通过→确定
    - expect: 出现「余额不足」错误
    - expect: 弹窗保持打开或状态仍为「待审核」
    - expect: 钱包余额未变化
    - expect: 无支出流水

#### 3.5. 审核拒绝不扣款

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 记录余额 B，新建扣费 2 USD，admin 审核选择「拒绝」并确定
    - expect: 状态「已拒绝」
    - expect: 余额仍为 B
    - expect: 无支出流水

#### 3.6. 非超管不能审核自己的扣费单

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 以 ops 新建扣费，找到自己提交的待审核行
    - expect: 「审 核」按钮 disabled
  2. 直接调用审核接口
    - expect: 403「不能审核自己提交的扣费单」

#### 3.7. 订单自动扣费单展示订单明细

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 使用 03 计划生成的订单扣费单（`DD...`，状态待审核），点击「审 核」
    - expect: 弹窗标题「审核扣费」
    - expect: 显示经销商、原币、扣减 USD、提交人、备注
    - expect: 显示「关联订单」链接，点击新标签打开 `/goods/history/<orderId>`
    - expect: 列出履约数量 > 0 的商品：URL × 数量 @ 单价
  2. 点击「取 消」
    - expect: 弹窗关闭，单据保持待审核

#### 3.8. 订单扣费单审核通过

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 在 dealer 余额充足前提下，由 admin 通过该订单扣费单
    - expect: 提示「审核完成」
    - expect: 状态「已通过」
    - expect: 钱包余额减少对应金额
    - expect: 账户变动新增支出流水且关联订单号

#### 3.9. 重复审核与不存在单据

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 对已审核测试扣费单再次调用审核接口
    - expect: 400「该单已审核」
    - expect: 余额不重复扣减
  2. 调用不存在的扣费单号
    - expect: 404「扣费单不存在」

#### 3.10. 扣费分页与筛选

**File:** `e2e/plan/04-finance.spec.ts`

**Steps:**
  1. 按经销商筛选
    - expect: 只显示该经销商扣费单
  2. 超过 20 条时翻页
    - expect: 每页 20 条
  3. 选择无数据经销商
    - expect: 显示「暂无数据」

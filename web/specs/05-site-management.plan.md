# 05 站点管理测试计划

## Application Overview

站点管理菜单下两个页面：汇率管理 `/site/exchange-rates`、全局配置 `/site/config`。

## 环境与前提

- baseURL：`http://localhost:5288`；seed：`e2e/seed.spec.ts`。
- 运营 `ops@local.dev / Ops@123456` 拥有 `exchange_rate`、`site_config` 读写权限；admin 为超级管理员。
- 经销商无站点菜单权限，用于权限边界验证。
- 只读界面可临时创建仅含 `exchange_rate: ro` / `site_config: ro` 的自定义角色与用户（参考 06 计划），执行后保留。
- 支持币种：USD、CNY、EUR、GBP、JPY；汇率基准独立于全局默认币种与钱包记账币种 USD。

## 关键规则（与实现一致）

- 汇率页为「本地编辑 + 显式保存」：新增/编辑/删除只改页面状态并置 dirty，点击「保存配置」才写入服务端；无改动时保存按钮 disabled。
- 切换基准弹出「切换汇率基准币种」确认框，确认后本地清空全部汇率并置 dirty，仍需保存。
- 弹窗标题「新增汇率」「编辑汇率」；币种下拉排除基准与已存在币种；编辑时币种不可改；汇率最小 0.00000001。
- 汇率列表无分页，按币种字典序；显示 8 位小数并附「例：100 X ≈ N base」。
- 「从聚合数据同步」：dirty 时先保存并提示「配置已先保存」，再同步；成功「同步完成」；未配置 key 时报「未配置 JUHE_EXCHANGE_APP_KEY，无法同步汇率」。
- 「删除」无二次确认，未保存前刷新可丢弃。
- 全局配置：默认国家 US/CN/GB/DE/JP，默认币种 USD/CNY/EUR/GBP/JPY；保存提示「已保存」；「重置」重新加载服务端值。
- 默认币种只影响充值/扣费表单默认选中，不改变钱包记账币种 USD。
- 无写权限：汇率页隐藏同步/保存/新增并禁用基准选择，操作列为「—」；全局配置表单 disabled 且隐藏保存/重置；接口 403 并弹出 `Insufficient permission`。

## 实测界面结构

- 汇率页：`Typography.Title`「汇率管理」+ 说明「维护各币种相对基准币种的汇率。财务充值/扣费折算使用此配置；与全局默认币种、钱包记账币种（USD）均相互独立。」；卡片「汇率默认设置」「币种汇率」；按钮「从聚合数据同步」「保存配置」「新增币种」；表格列 币种、相对 <BASE> 汇率、更新时间、操作。
- 全局配置：卡片「全局配置」；Alert「默认币种仅影响充值/扣费等表单的默认选中，不会修改钱包记账币种（始终为 USD）。」；字段「默认国家」「默认币种」；按钮「保存」「重置」。

## 数据安全

- 汇率是全局财务配置，直接影响充值/扣费折算：修改前记录原始基准与全部汇率，用例结束后必须恢复原配置。
- 不在未恢复的情况下清空真实汇率。
- 全局配置修改后恢复原始默认国家/默认币种。
- 除明确测试环境外，不执行外部同步覆盖真实配置。
- 不得为了测试「缺少汇率」而删除真实汇率；该场景只在 mock/隔离环境执行。

## Test Scenarios

### 1. 汇率管理页面与编辑流程

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 汇率页初始结构与默认设置

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 以 ops 登录访问 `/site/exchange-rates`
    - expect: 显示标题「汇率管理」及说明「维护各币种相对基准币种的汇率。财务充值/扣费折算使用此配置；与全局默认币种、钱包记账币种（USD）均相互独立。」
    - expect: 存在「汇率默认设置」卡片与「汇率基准币种」下拉
    - expect: 存在「币种汇率」卡片与「新增币种」「从聚合数据同步」「保存配置」按钮
    - expect: 表格列为 币种、相对 <BASE> 汇率、更新时间、操作
    - expect: 「保存配置」disabled（无改动）
    - expect: 页面无分页器
  2. 观察某行汇率
    - expect: 汇率保留 8 位小数
    - expect: 右侧显示「例：100 <币种> ≈ N <BASE>」

#### 1.2. 新增币种仅本地生效，保存后持久化

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 记录当前基准与全部汇率快照；点击「新增币种」
    - expect: 弹窗标题「新增汇率」
    - expect: 币种下拉不含基准币种与已存在币种
    - expect: 存在「相对 <BASE> 汇率」输入框
  2. 选择一个未使用的支持币种，汇率填 1.23456789，点击「确 定」
    - expect: 弹窗关闭
    - expect: 列表新增该币种行，汇率显示 1.23456789
    - expect: 「保存配置」变为可用
    - expect: 尚未产生网络保存请求
  3. 点击「保存配置」
    - expect: 出现「已保存」
    - expect: 按钮恢复 disabled
    - expect: 刷新后该币种仍在列表且汇率不变
  4. 恢复：删除该测试币种并点击「保存配置」
    - expect: 列表恢复原始状态
    - expect: 出现「已保存」

#### 1.3. 编辑已有汇率

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 记录某币种原汇率，点击其「编辑」
    - expect: 弹窗标题「编辑汇率」
    - expect: 币种下拉 disabled 且等于该币种
    - expect: 汇率回填原值
  2. 将汇率改为原值 * 1.01，点击「确 定」
    - expect: 弹窗关闭，列表显示新值，保存配置变为可用
  3. 点击「保存配置」并刷新
    - expect: 新值持久化
  4. 恢复原汇率并保存
    - expect: 列表恢复原值

#### 1.4. 删除汇率在保存前可丢弃

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 点击任意非基准币种行「删除」
    - expect: 无二次确认弹窗
    - expect: 该行立即从表格消失，保存配置变为可用
    - expect: 其他行不受影响
  2. 刷新页面
    - expect: 被删除的行重新出现（未保存改动丢弃）
    - expect: 「保存配置」恢复 disabled

#### 1.5. 基准币种切换确认与取消

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 在「汇率基准币种」下拉选择另一个币种
    - expect: 出现确认框「切换汇率基准币种」
    - expect: 内容包含「切换基准币种将清空现有币种汇率列表，需重新录入或从聚合数据同步。此设置与全局默认币种无关。是否继续？」
    - expect: 存在「继续切换」与「取消」
  2. 点击「取消」
    - expect: 下拉恢复原基准
    - expect: 汇率列表不变
    - expect: 保存配置仍 disabled

#### 1.6. 确认切换基准后清空列表并需保存

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 记录原基准与汇率快照；切换基准并点击「继续切换」
    - expect: 基准下拉变为新币种
    - expect: 币种汇率表变为空态「暂无数据」
    - expect: 保存配置可用，但尚未持久化
  2. 点击「保存配置」并刷新
    - expect: 出现「已保存」
    - expect: 刷新后基准为新币种，汇率列表为空
    - expect: 列标题变为「相对 <新基准> 汇率」
  3. 恢复：切回原基准、重新录入原汇率并保存
    - expect: 配置与快照一致

### 2. 汇率校验、同步与权限

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 新增汇率必填与最小边界

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 点击「新增币种」，不选择币种直接确定
    - expect: 提示「请选择币种」，弹窗不关闭
  2. 选择币种，汇率留空确定
    - expect: 提示「请输入汇率」
  3. 汇率输入 0 或负数
    - expect: InputNumber 最小值 0.00000001，无法提交非正值
  4. 输入 0.00000001 并确定
    - expect: 允许加入列表，显示 0.00000001
  5. 不保存并刷新页面
    - expect: 丢弃该改动

#### 2.2. 后端拒绝无效汇率与不支持币种

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 通过接口提交 rates 含 rateToBase=0
    - expect: 400「汇率无效: <CODE>」
    - expect: 配置不变
  2. 提交 baseCurrencyCode=ABC
    - expect: 400「不支持的基准币种，可选：USD, CNY, EUR, GBP, JPY」
  3. 提交 currencyCode=ABC
    - expect: 400「不支持的币种: ABC」

#### 2.3. 从聚合数据同步成功或明确报错

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 记录当前汇率；点击「从聚合数据同步」
    - expect: 按钮进入 loading，结束后恢复可用
    - expect: 成功时提示「同步完成」，列表刷新更新时间
    - expect: 未配置 key 时提示「未配置 JUHE_EXCHANGE_APP_KEY，无法同步汇率」
    - expect: 页面不崩溃
  2. 若同步成功，对比更新后的汇率；必要时恢复原快照并保存
    - expect: 配置最终恢复到测试前状态

#### 2.4. 有未保存改动时同步先保存

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 新增一个测试币种（不点保存），点击「从聚合数据同步」
    - expect: 先出现「配置已先保存」
    - expect: 随后出现「同步完成」或同步失败提示
    - expect: 若同步成功，刷新后测试币种仍在（先保存生效）
  2. 清理：删除测试币种并保存，或恢复快照
    - expect: 配置恢复

#### 2.5. 无写权限与未登录访问

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 以仅 `exchange_rate: ro` 的测试用户访问汇率页
    - expect: 无「新增币种」「从聚合数据同步」「保存配置」按钮
    - expect: 基准币种下拉 disabled
    - expect: 操作列显示「—」
  2. 以 dealer 直接访问 `/site/exchange-rates`
    - expect: 无站点管理菜单
    - expect: 页面渲染但显示空汇率
    - expect: 出现 `Insufficient permission` 提示
    - expect: 页面不白屏
  3. 未登录直接访问该 URL
    - expect: 重定向 `/login?redirect=%2Fsite%2Fexchange-rates`

### 3. 全局配置

**Seed:** `e2e/seed.spec.ts`

#### 3.1. 全局配置结构与加载

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 以 ops 访问 `/site/config`
    - expect: 卡片标题「全局配置」
    - expect: 显示 Alert「默认币种仅影响充值/扣费等表单的默认选中，不会修改钱包记账币种（始终为 USD）。」
    - expect: 「默认国家」下拉含 US—美国、CN—中国、GB—英国、DE—德国、JP—日本
    - expect: 「默认币种」下拉含 USD/CNY/EUR/GBP/JPY
    - expect: 存在「保存」「重置」按钮

#### 3.2. 保存全局配置并影响充值默认币种

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 记录原默认国家/币种；将默认币种改为 CNY，点击「保存」
    - expect: 出现「已保存」
    - expect: 刷新后仍为 CNY
  2. 访问 `/finance/recharge`，点击「新增充值」
    - expect: 币种字段默认选中 CNY（来自全局默认币种）
  3. 恢复原默认币种与国家并保存
    - expect: 出现「已保存」
    - expect: 充值表单恢复原默认币种

#### 3.3. 重置丢弃未保存修改

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 将默认国家改为 JP、默认币种改为 GBP（不保存），点击「重置」
    - expect: 表单恢复到服务端当前值
    - expect: 无「已保存」提示
  2. 刷新页面
    - expect: 值仍为服务端值

#### 3.4. 必填校验与非法原始值

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 清空默认国家或默认币种并提交
    - expect: 提示「请选择默认国家」/「请选择默认币种」
    - expect: 不发起保存
  2. 直接调用更新接口传 defaultCurrencyCode=ABC
    - expect: 400「不支持的币种，可选：USD, CNY, EUR, GBP, JPY」
  3. 传 defaultCountryCode=ZZ
    - expect: 如服务端有校验则返回 400；若未校验则记录为可测试缺陷点，不视为通过

#### 3.5. 只读权限界面

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 以仅 `site_config: ro` 的测试用户访问
    - expect: 两个下拉均 disabled
    - expect: 无「保存」「重置」按钮
  2. 以 dealer 直接访问 `/site/config`
    - expect: 页面渲染，无保存按钮
    - expect: 出现 `Insufficient permission` 提示
    - expect: 表单为空且 disabled，不白屏

#### 3.6. 全局配置接口异常提示

**File:** `e2e/plan/05-site.spec.ts`

**Steps:**
  1. 拦截网络使 `PUT /api/site/settings` 返回 500，修改值后点击保存
    - expect: 出现错误提示（服务端 message 或请求失败）
    - expect: 按钮 loading 结束恢复可用
    - expect: 表单保留用户输入
  2. 拦截 GET 设置接口返回 500
    - expect: 提示「加载配置失败」或服务端错误
    - expect: 页面显示空表单，不崩溃

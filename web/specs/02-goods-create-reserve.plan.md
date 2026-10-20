# 02 创建预约与预约订单测试计划

## Application Overview

订单管理下的「创建预约」页面、预约订单列表 `/goods/reserve`、预约订单详情 `/goods/reserve/:id`。

## 环境与前提

- baseURL：`http://localhost:5288`；seed：`e2e/seed.spec.ts`。
- 正常创建流程使用 dealer 登录态（`e2e/.auth/dealer.json` 或 `loginViaApi(page, 'dealer@local.dev', 'Dealer@123456')`）；管理/跨经销商视角使用 admin。
- Excel 模板表头：`url`、`数量`（服务端兼容「链接/地址」「qty/quantity」）；上传限制 `.xlsx/.xls`，服务端最大 5MB。
- 创建页没有「商品/数量/币种/经销商」表单；创建订单 = 上传 Excel + 可选经销商备注。币种取全局默认币种；初始状态 `reserving`（预约中），`priceStatus=0`（价格未齐）。

## 关键接口与规则

- `POST /api/goods/orders/import`：要求 `goods_reserve_create:rw`，且仅经销商或超级管理员；空文件/缺少 URL/数量非正整数返回 400。
- `GET /api/goods/orders/reserve`：要求 `goods_reserve_order:ro`；返回 reserving/pending_fulfill/partial_fulfill/fulfilled，包含已取消订单。
- 取消：仅 reserving 或 pending_fulfill 可取消；取消后 `cancelStatus=1`，状态标签保留原状态并追加「已取消」。
- 详情编辑：reserving 状态下经销商（本人）或超管可改单价与预约数量；单价 >= 0；预约数量必须为正整数。
- 提交履约：所有商品行必须有单价（0 视为已填）；提交后状态变为 `pending_fulfill`。
- 分页：每页 20 条，服务端分页。

## 实测界面结构

- 创建页：Alert 文案「上传 Amazon 商品下单 Excel（表头：url、数量）。创建后订单状态为「预约中」，请在预约订单中补全单价后再提交履约。」；按钮「下载模板」「选择 Excel」；备注占位「备注」；表格列 URL/数量，空态「请先上传并解析 Excel」；底部「确认创建」。
- 预约列表：卡片标题「预约订单」；只有状态下拉（占位「状态」）+「查 询」，没有经销商筛选；列依次为 订单号、经销商、状态、价格、币种、商品行、预约量、履约量、创建时间、操作；价格列显示「已齐/未齐」；操作列「查看」，可取消时额外显示「取消」。
- 预约详情：标题「订单 <订单号>」+ 状态标签 + 「价格已填完/价格未齐」；Descriptions 为 经销商、币种、创建时间、扣费单、经销商备注（完成后才出现「扣费原币金额」）；表格列 Amazon URL、预约数量、单价 (<币种>)、履约数量；编辑态右上角「保 存」「提交履约」「取消订单」，表格上方「同步全部价格」「同步未填价格」，每行「同步价格」。

## 权限与已知问题

- ops 菜单不显示创建预约/预约订单，但直接访问 `/goods/create` 页面骨架会渲染；下载模板与确认创建均因权限不足返回 403。
- ops 可以直接打开任意订单详情（后端 `assertCanView` 对 ops 放行），但在 `/goods/reserve/:id` 中为只读，无保存/提交/取消按钮。
- dealer 直接访问 `/goods/fulfill` 会得到 403；但打开自己的 `/goods/fulfill/:id` 可只读查看。
- 列表首次进入存在竞态，偶发先显示「暂无数据」；测试时若遇空表，先点击「查 询」再断言。
- AntD 两字按钮可访问名带空格：`查 询`、`保 存`、`确 定`、`取 消`；定位建议 `/查\s*询/`。
- 403 全局提示固定为 `Insufficient permission`，约 3 秒后消失，需在请求后立即等待。

## 数据安全

- 每个用例使用带时间戳的唯一 Amazon URL（如 `https://www.amazon.com/dp/B0PW<stamp>A`）创建独立订单。
- 不取消/删除他人既有订单；分页等多数据场景可批量创建带唯一前缀的测试订单，执行后保留。
- 外部 Amazon 价格同步可能返回 503/未配置，相关用例只断言「有明确提示且按钮恢复可用」。

## Test Scenarios

### 1. 创建预约页面与文件解析

**Seed:** `e2e/seed.spec.ts`

#### 1.1. 创建预约页初始结构与空态

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 以 dealer 登录并访问 `/goods/create`
    - expect: Header 与卡片标题均为「创建预约」
    - expect: 显示 Alert「上传 Amazon 商品下单 Excel（表头：url、数量）。创建后订单状态为「预约中」，请在预约订单中补全单价后再提交履约。」
    - expect: 存在「下载模板」「选择 Excel」按钮
    - expect: 存在占位符「备注」的多行输入框
    - expect: 表格空态显示「请先上传并解析 Excel」
    - expect: 「确认创建」按钮为禁用状态

#### 1.2. 下载 Excel 模板

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在 `/goods/create` 点击「下载模板」
    - expect: 触发浏览器下载事件
    - expect: 文件名为 `goods-reserve-template.xlsx`
    - expect: 按钮点击后保持可用，无错误提示

#### 1.3. 上传合法 Excel 后解析预览并可删除

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 准备含表头 `url,数量` 和两行数据的 xlsx，通过 `input[type=file]` 上传
    - expect: 出现提示「已解析 2 行」
    - expect: 预览表格显示两行：URL 列与数量列
    - expect: 「确认创建」由禁用变为可用
    - expect: 上传列表显示 1 个文件
  2. 点击上传列表的删除图标
    - expect: 预览表格清空并显示「请先上传并解析 Excel」
    - expect: 「确认创建」恢复禁用

#### 1.4. 再次上传会替换已选文件

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 上传文件 A（2 行），再上传文件 B（1 行）
    - expect: 文件列表只保留 1 个文件（maxCount=1）
    - expect: 预览表格只显示文件 B 的 1 行
    - expect: 提示「已解析 1 行」

### 2. 创建预约校验与提交

**Seed:** `e2e/seed.spec.ts`

#### 2.1. 非 Excel 文件解析失败

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 上传内容为 `not-excel` 的 `.txt` 文件（或把 txt 后缀改为 xlsx）
    - expect: 出现错误提示，匹配 /解析失败|缺少|没有有效/
    - expect: 预览表格为空
    - expect: 「确认创建」保持禁用
    - expect: URL 仍为 `/goods/create`
  2. 检查文件输入 accept 属性
    - expect: `accept` 包含 `.xlsx` 与 `.xls`

#### 2.2. Excel 缺少 url 时提示行号

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 上传表头 `url,数量`、第 2 行 url 为空、数量为 1 的 Excel
    - expect: 出现「第 2 行缺少 url」
    - expect: 不生成订单，不跳转详情

#### 2.3. 数量为 0、负数、小数或非数字时拒绝

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 分别上传数量为 `0`、`-1`、`1.5`、`abc` 的 Excel
    - expect: 每次均显示「第 2 行数量必须为正整数」
    - expect: 预览表格清空
    - expect: 「确认创建」保持禁用

#### 2.4. 只有表头没有数据行

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 上传只有 `url,数量` 表头、无数据行的 xlsx
    - expect: 出现「没有有效数据行」
    - expect: 不创建订单

#### 2.5. 备注与合法数据创建成功并跳转详情

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 上传两行合法数据，备注填 `pw-create-<stamp>`，点击「确认创建」
    - expect: 按钮进入 loading
    - expect: 出现「预约订单已创建」
    - expect: URL 在 60 秒内变为 `/goods/reserve/<id>`
  2. 检查详情页
    - expect: 标题包含「订单 GO...」
    - expect: 状态标签「预约中」
    - expect: 存在「价格未齐」标签
    - expect: 「经销商备注」为 `pw-create-<stamp>`
    - expect: 商品行数量与上传一致
    - expect: 扣费单为「—」且不显示「扣费原币金额」

#### 2.6. 后端 500 时创建失败并留在当前页

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 拦截 `POST /api/goods/orders/import` 返回 500，上传合法 Excel 后点击「确认创建」
    - expect: 出现错误提示（服务端 message 或请求失败）
    - expect: 按钮 loading 结束并恢复可用
    - expect: URL 仍为 `/goods/create`，预览数据保留

#### 2.7. ops 直接访问创建页无法真正创建

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 使用 ops 登录态访问 `/goods/create`，上传合法 Excel 并点击「确认创建」
    - expect: 页面可渲染且可完成本地解析
    - expect: 点击后出现 `Insufficient permission`（或「仅经销商可创建预约」）提示
    - expect: 不跳转详情页
    - expect: 该页面不在 ops 菜单中

### 3. 预约订单列表

**Seed:** `e2e/seed.spec.ts`

#### 3.1. 列表结构与筛选控件

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 以 dealer 登录访问 `/goods/reserve`
    - expect: 卡片标题「预约订单」
    - expect: 筛选区有占位「状态」的下拉和 `查 询` 按钮
    - expect: 不存在经销商筛选下拉
    - expect: 表格列依次为 订单号、经销商、状态、价格、币种、商品行、预约量、履约量、创建时间、操作
  2. 若首次显示「暂无数据」，点击「查 询」等待接口返回
    - expect: 加载完成后 `.ant-table-tbody` 可见
    - expect: 分页器 `.ant-pagination` 可见

#### 3.2. 按状态筛选并清空

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在状态下拉选择「预约中」
    - expect: 选择后自动触发请求（也可再点「查 询」）
    - expect: 列表中每行状态标签为「预约中」
    - expect: 页码重置为 1
  2. 依次切换「待履约」「部分履约」「已履约」
    - expect: 每行状态标签与选项一致
  3. 点击状态下拉的清除按钮
    - expect: 恢复显示全部状态的订单

#### 3.3. 查看订单详情

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在预约订单列表找到本次创建的订单行，点击「查看」
    - expect: URL 变为 `/goods/reserve/<id>`
    - expect: 详情页订单号与列表行一致
    - expect: 经销商、币种、创建时间等字段显示

#### 3.4. 从列表取消订单并显示已取消标签

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 创建一个「预约中」测试订单，在 `/goods/reserve` 定位其行并点击「取消」
    - expect: 出现确认框「取消订单」，内容包含「确认取消订单 GO...？取消后不可恢复。」
    - expect: 按钮为「确认取消」与「返回」
  2. 点击「确认取消」
    - expect: 出现「订单已取消」
    - expect: 该行在状态标签旁显示灰色「已取消」
    - expect: 该行不再显示「取消」
  3. 打开该订单详情
    - expect: 标题旁有「已取消」标签
    - expect: 不显示「保存」「提交履约」「取消订单」

#### 3.5. 取消确认框点返回不改变订单

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 对可取消订单点击「取消」，在确认框点击「返回」
    - expect: 确认框关闭
    - expect: 订单仍未取消，行上仍有「取消」
    - expect: 无「订单已取消」提示

#### 3.6. 已履约订单不显示取消按钮

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 准备一个 fulfilled 测试订单，进入 `/goods/reserve` 查看其行
    - expect: 状态标签「已履约」
    - expect: 操作列只有「查看」，没有「取消」

#### 3.7. 分页切换

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 当预约订单总数超过 20 时点击第 2 页
    - expect: 触发 page=2&pageSize=20 请求
    - expect: 表格内容更新，页码 2 高亮
    - expect: 每页最多 20 行
  2. 返回第 1 页
    - expect: 按创建时间倒序显示
    - expect: 第 1 页高亮

#### 3.8. 筛选无结果时显示空态

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 选择一个当前没有数据的状态
    - expect: 表格显示「暂无数据」
    - expect: 分页器隐藏或总数为 0
    - expect: 页面无报错

#### 3.9. 经销商数据隔离

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 以 admin 新建第二个经销商账号并分配 dealer 角色，以其登录创建一个带唯一 URL 的预约订单
    - expect: 订单创建成功
    - expect: 该订单的经销商字段为第二个经销商
  2. 切换回 seed dealer 登录，访问 `/goods/reserve`
    - expect: 列表看不到第二个经销商的订单
    - expect: 接口只返回当前登录经销商的订单
  3. 使用 admin 访问 `/goods/reserve`
    - expect: 可以看到所有经销商的订单

### 4. 预约订单详情

**Seed:** `e2e/seed.spec.ts`

#### 4.1. 详情页结构与可编辑区域

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 以 dealer 打开一个「预约中」测试订单详情
    - expect: 标题为「订单 <订单号>」并带「预约中」标签
    - expect: 存在「价格未齐」标签
    - expect: Descriptions 包含 经销商、币种、创建时间、扣费单（—）、经销商备注
    - expect: 表格列为 Amazon URL、预约数量、单价 (<币种>)、履约数量
    - expect: 右上角有「保 存」「提交履约」「取消订单」
    - expect: 表格上方有「同步全部价格」「同步未填价格」

#### 4.2. 填写单价并保存后价格状态变为已填完

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在单价输入框依次填入 10 和 5（可用 `data-testid=unit-price-<id>` 或 `window.__pwFillUnitPrices`）
    - expect: 输入框显示对应数值
    - expect: 未确认时出现「恢复」「确定」
  2. 点击「保 存」
    - expect: 出现「已保存」
    - expect: 「价格未齐」变为「价格已填完」
    - expect: 刷新后单价仍为 10 和 5

#### 4.3. 修改单价后恢复与确定

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 将已填单价从 10 改为 12
    - expect: 出现「恢复」「确定」
  2. 点击「恢复」
    - expect: 单价恢复为 10
    - expect: 「恢复」「确定」消失
  3. 再次改为 12 并点击「确定」
    - expect: 单价保持 12
    - expect: 「恢复」「确定」消失

#### 4.4. 修改预约数量并保存

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在预约数量输入框中将 2 改为 3，点击「保 存」
    - expect: 出现「已保存」
    - expect: 刷新后预约数量为 3
  2. 尝试输入 0 或负数
    - expect: 输入框 `min=1`、`precision=0`，无法提交 0/负数
    - expect: 若通过脚本绕过，保存时报「预约数量必须为正整数」

#### 4.5. 未填全部单价时提交履约被阻止

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 对至少一行未填单价的预约中订单点击「提交履约」
    - expect: 出现「请填写全部商品单价」
    - expect: 不出现提交履约确认框
    - expect: 订单状态仍为「预约中」

#### 4.6. 全部填价后提交履约并进入待履约

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 填写全部单价并保存，点击「提交履约」
    - expect: 出现确认框「提交履约」，内容「提交后订单进入「待履约」，单价将不可再修改。确认？」
  2. 点击确认框「确 定」
    - expect: 出现「已提交履约」
    - expect: 状态标签变为「待履约」
    - expect: 单价输入框变为只读文本
    - expect: 「提交履约」「同步价格」消失

#### 4.7. 在详情页取消订单

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 打开一个预约中订单详情，点击「取消订单」
    - expect: 出现确认框「取消订单」，含「确认取消订单 <订单号>？取消后不可恢复。」
  2. 点击「确认取消」
    - expect: 出现「订单已取消」
    - expect: 标题旁出现「已取消」
    - expect: 「保存」「提交履约」「取消订单」全部消失

#### 4.8. 单行同步价格

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在预约中订单详情点击某一行「同步价格」
    - expect: 按钮 loading 后恢复可用
    - expect: 成功时提示「已抓取 $x.xx → <币种> x.xx」
    - expect: 失败时提示同步失败/未配置/503 等明确错误
    - expect: 页面不崩溃，订单仍可编辑

#### 4.9. 批量同步价格与空行处理

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 全部单价已填时点击「同步未填价格」
    - expect: 提示「没有需要同步的商品行」
    - expect: 不发起外部抓取
  2. 点击「同步全部价格」
    - expect: 成功时提示「已同步 N 行价格（需点确定后保存）」，失败时提示「N 行失败：...」
    - expect: 按钮 loading 结束后恢复可用

#### 4.10. 非预约中状态不可编辑但待履约仍可取消

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 打开一个「待履约」订单的 `/goods/reserve/:id`
    - expect: 单价和预约数量显示为只读文本
    - expect: 不显示「保存」「提交履约」
    - expect: 仍显示「取消订单」

#### 4.11. 权限、越权与不存在订单

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 以 ops 打开一个经销商的预约订单 `/goods/reserve/<id>`
    - expect: 页面正常渲染订单详情（ops 可查看任意订单）
    - expect: 所有字段只读，不显示保存/提交履约/取消订单
    - expect: 不出现 403 提示
  2. 以 dealer 打开他人的预约订单
    - expect: 出现「无权查看该订单」提示
    - expect: 页面显示「订单不存在」卡片，不白屏
  3. 以 admin 访问 `/goods/reserve/999999991`
    - expect: 出现「订单不存在」提示
    - expect: 页面显示「订单不存在」卡片
  4. 访问 `/goods/reserve/not-a-number`
    - expect: 页面不崩溃
    - expect: 显示「订单不存在」

#### 4.12. 零单价边界

**File:** `e2e/plan/02-goods-reserve.spec.ts`

**Steps:**
  1. 在一个预约中订单把全部单价填为 0 并保存
    - expect: 允许保存（后端校验单价 >= 0）
    - expect: 出现「价格已填完」标签
  2. 点击「提交履约」并确认
    - expect: 允许提交，状态变为「待履约」
    - expect: 后续提交完成时预期报「扣费金额必须大于 0」（在 03 计划验证）

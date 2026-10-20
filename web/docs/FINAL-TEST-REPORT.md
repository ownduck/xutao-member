# 会员管理后台 E2E 测试最终报告

- 报告日期：2026-10-20
- 测试对象：会员管理后台（web / server）
- 测试框架：Playwright（Chromium，headless）
- 测试计划：`web/specs/00..06*.plan.md`
- 测试代码：`web/e2e/plan/*.spec.ts`

---

## 1. 结论摘要

| 指标 | 结果 |
|---|---|
| 计划用例 | 152 |
| 可执行用例 | 150 |
| 通过 | **150 / 150（100%）** |
| 主动跳过 | 2（`test.fixme`） |
| 产品功能 bug（本轮） | 0 |
| 全量运行时长 | 约 1.5 小时（首轮 2.0 小时） |

> 另含 3 个 `setup` 鉴权用例（admin / ops / dealer），全量统计为 **152 passed / 2 skipped / 0 failed**。

两处跳过：

- `00-navigation` 4.4：重置密码成功并强制退出，需要真实修改临时账号密码，按安全约束不执行。
- `02-goods-create-reserve` 3.9：经销商数据隔离，需要第二个经销商账号，当前环境不具备。

---

## 2. 测试范围

| 计划 | 测试文件 | 业务用例 |
|---|---|---|
| 00 应用概览、登录与通用导航 | `00-navigation.spec.ts` | 22 |
| 01 概览页 | `01-dashboard.spec.ts` | 7 |
| 02 创建预约与预约订单 | `02-goods-create-reserve.spec.ts` | 32 |
| 03 履约订单与历史订单 | `03-goods-fulfill-history.spec.ts` | 22 |
| 04 财务（钱包/账户变动/充值/扣费） | `04-finance.spec.ts` | 27 |
| 05 站点管理（汇率/全局配置） | `05-site-management.spec.ts` | 17 |
| 06 后台权限（管理员/角色/权限树） | `06-rbac.spec.ts` | 25 |
| **合计** | 7 个文件 | **152** |

覆盖要点：

- 登录、会话、退出、路由重定向、菜单权限过滤
- 订单创建（Excel 上传/解析/校验）、预约列表与详情、取消、履约、提交完成、历史订单
- 钱包、账户变动、充值审核、扣费审核、余额与流水联动
- 汇率本地编辑/保存/同步、基准切换、全局配置保存/重置/只读
- 管理员 CRUD、角色 CRUD、权限树读写级别、RBAC API 与菜单联动

---

## 3. 运行历史

| 阶段 | 结果 | 耗时 |
|---|---|---|
| 首轮全量 | 132 passed / 21 failed / 2 skipped | 2.0h |
| 修复 02（5）、03（4）、04（5）、05（4）、06（3） | — | — |
| 二轮全量 | 152 passed / 1 failed / 2 skipped | 1.5h |
| 修复最后 1 项并重跑 03 全文件 | **25/25 passed** | 20.8m |

最终状态：**无失败用例**。

---

## 4. 失败分析与修复

首轮 21 个失败、二轮 1 个失败，均为测试侧问题，未发现新的产品功能缺陷。分为三类：

### 4.1 后端响应慢导致超时（主因）

环境实测：

| 操作 | 耗时 |
|---|---|
| `/api/health` | 0.9–1.4s |
| 列表查询 | 20–40s |
| 详情查询 | 3–17.6s |
| 保存后自动刷新 | 30–40s |
| 下单导入 | 12.1s |
| 创建→填价→提交履约链路 | 90–120s |

原 60s 全局超时不足。修复方式：

- `test.setTimeout` 提升到 240–420s
- `page.request.*`、`waitForResponse` 显式 120s
- 列表/详情/保存/审核相关等待放宽到 60–120s

### 4.2 React StrictMode 二次加载竞态

- 05 汇率页、订单详情页挂载时会执行两次 `load()`，迟到的响应会覆盖测试刚写入的本地修改。
- 修复：跟踪初始请求（发起数 + 在途数归零）后再交互；`openReserveDetail` 等待全部初始 GET 结束。
- 未使用固定 `waitForTimeout`。

### 4.3 测试数据假设

- `03-3.4` 假设管理员历史订单第 1 页包含多个经销商；数据增长后第 1 页只有「示例经销商」。
- 修复：按 API 返回的总数与每页条数定位包含其他用户订单的页码，再断言该行在管理员列表中可见，保留隔离语义。

### 4.4 修复分布

| 文件 | 失败数 | 主要修复 |
|---|---|---|
| 02 | 5 | 文件级 240s；导航/订单/提交链路等待放宽 |
| 03 | 4 + 1 | 240–420s；保存后刷新等待 120s；分页定位替代首页假设 |
| 04 | 5 | `SLOW=120s`、`TEST_TIMEOUT=300s`；API/响应显式超时 |
| 05 | 4 | 300s；StrictMode 请求跟踪；恢复快照请求 120s |
| 06 | 3 | 420s；RBAC API 120s + 非 4xx 重试；context 关闭前确保操作完成 |

---

## 5. 产品缺陷与已知问题

### 5.1 已修复缺陷

**角色权限回显失败（阻断级，已于 2026-10-19 修复）**

- 现象：`GET /api/rbac/roles/:id/permissions` 返回权限对象数组，前端按 `{ permissionIds, readOnlyPermissionIds }` 解析，权限树始终 0 勾选；误点「确定」会清空角色权限。
- 修复：
  - `server/src/rbac/roles.service.ts` 改为返回 `{ permissionIds, readOnlyPermissionIds }`
  - `web/src/pages/rbac/RolesPage.tsx` 加载失败时关闭弹窗，避免误保存空权限
  - 服务端 e2e 用例更新为对象契约
- 回归：`06-rbac` 3.1/3.2 覆盖，已通过。

### 5.2 仍存在的已知问题（测试中按现状记录）

这些不是本轮引入的问题，部分用例按「缺陷复现」编写，待产品决策：

1. 无任何业务权限的用户仍显示一个无子项、不可点击的「后台权限」顶层菜单。
2. 无路由级权限守卫：直接访问无权限 URL 会先渲染骨架/空表，接口 403 后仅提示英文 `Insufficient permission`，不跳转。
3. 只读角色打开权限弹窗时，Tree 仍可勾选，仅「确定」按钮 disabled。
4. 列表首次进入存在空态竞态，偶发先显示「暂无数据」。
5. ops 可只读打开任意订单详情（含非本人订单），仅编辑受限。
6. 登录后 Header 显示名存在约 2 秒水合延迟。
7. 控制台存在 AntD 使用告警（`useForm is not connected`、静态 `message`/`Modal` 等）。

---

## 6. 测试环境与基础设施

- 前端：`http://localhost:5288`（Vite）
- 后端：`http://localhost:3000`（NestJS，单实例非 watch 模式）
- 账号：`admin@local.dev`、`ops@local.dev`、`dealer@local.dev`（seed）
- 认证：`e2e/auth.setup.ts` 生成 `.auth/{admin,ops,dealer}.json`
- 运行模式：headless，单 worker

已解决的环境问题：

1. **Playwright MCP 版本冲突**：根 `package.json` 声明 `playwright@1.64.1`，避免 npx 命中全局副本。
2. **后端进程冲突**：多个 `nest start --watch` 争抢 3000 端口会导致 502 与反复重编译，当前只保留一个实例。
3. **测试产物占用**：MCP 暂停测试会锁住 `test-results` 视频文件，运行测试时使用独立输出目录规避。

临时文件（`.tmp-pw.config.ts`、`.pw-out/`、`.playwright-mcp/`、`test-results/`）已删除。

---

## 7. 代码变更清单

### 测试代码

- `web/e2e/plan/00-navigation.spec.ts`
- `web/e2e/plan/01-dashboard.spec.ts`
- `web/e2e/plan/02-goods-create-reserve.spec.ts`
- `web/e2e/plan/03-goods-fulfill-history.spec.ts`
- `web/e2e/plan/04-finance.spec.ts`
- `web/e2e/plan/05-site-management.spec.ts`
- `web/e2e/plan/06-rbac.spec.ts`

### 测试基础设施

- `web/e2e/helpers/nav.ts`：就绪等待提升到 120s
- `web/e2e/helpers/goods.ts`：订单创建/详情/保存/提交等待放宽；等待全部初始 GET
- `web/e2e/helpers/finance.ts`：列表/提交/审核等待放宽

### 缺陷修复（前期）

- `server/src/rbac/roles.service.ts`
- `server/test/rbac-roles.e2e-spec.ts`
- `web/src/pages/rbac/RolesPage.tsx`
- `member/package.json`（workspace 根声明 `playwright`）
- `web/package.json`（`@playwright/test` 版本）

### 测试计划

- `web/specs/00..06*.plan.md`
- `web/docs/FINAL-TEST-REPORT.md`（本报告）

> 未执行任何 git 提交。

---

## 8. 风险与建议

1. **后端性能是最大风险**
   - 单请求 3–40s，部分链路 90–120s，全量 1.5–2h。
   - 建议排查 SQLite 所在磁盘、杀毒扫描、测试数据量增长；长期使用独立测试库。
2. **测试数据持续累积**
   - 每轮会新建 `pw-` 前缀订单、充值/扣费单；建议定期清理或增加清理钩子。
3. **超时余量**
   - 当前最大 420s；若后端进一步劣化仍需上调。
4. **CI 建议**
   - 按文件或 describe 并行；不要使用低于 180s 的全局超时。
5. **运行时序**
   - 确保只有一个后端实例；先确认 `/api/health` 正常再跑。
6. **已知产品问题**
   - 第 5.2 节的问题建议排期处理，尤其是「无路由级守卫」和「空后台权限菜单」。

---

## 9. 复现方式

```bash
cd F:/data/dev/html/xutao/member/web

# 前置：确保前后端已启动且仅一个后端实例
curl -s http://localhost:3000/api/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:5288

# 全量运行（预计 1.5–2 小时）
npx playwright test e2e/plan/ --project=chromium --reporter=line

# 单文件
npx playwright test e2e/plan/04-finance.spec.ts --project=chromium --reporter=line
```

说明：

- 使用项目正式配置 `playwright.config.ts`（超时 180s，`chromium` 依赖 `setup`）。
- 若环境中 `test-results` 被其他进程占用，可追加 `--output <独立目录>`。
- 不要用 `--timeout=60000` 运行全量，会把慢接口误判为失败。

# member 管理后台

同仓全栈：`web`（Vite + React + React Router + antd）+ `server`（NestJS + Drizzle + Better Auth + Neon）。

## 开发

```bash
# 配置 server/.env（参考 server/.env.example）
npm run db:push
npm run db:seed
npm run dev
```

- 前端：http://localhost:5288
- 后端：http://localhost:3000

默认超管（种子）：

- 邮箱：`admin@local.dev`
- 密码：`Admin@123456`（可用 `ADMIN_SEED_PASSWORD` 覆盖）

## 生产一次部署

```bash
npm run build
npm start
```

由 Nest 托管 `web/dist` 静态资源，并提供 `/api`。

## 一期范围

仅 RBAC：管理员用户 / 角色 / 权限绑定；超管不受限；其他用户由管理员创建并受角色限制。

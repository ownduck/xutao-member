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

`npm run build` 会把 `web/dist` 拷到 `server/public`，由 Nest 托管静态资源并提供 `/api`。

### Vercel（同源部署）

当前生产页能打开、但 `/api/auth/*` 返回 Vercel 的 `404 NOT_FOUND`，说明只部署了前端静态站，**Nest 没有作为 Function 跑起来**。按下面改项目设置后重新部署：

1. **Root Directory** 设为 `server`（不要用 `web`）
2. Framework Preset 选 **NestJS**（或 Other，让其识别 `src/main.ts`）
3. 清空自定义 **Output Directory**（不要指向 `web/dist`）
4. Install / Build 可用 `server/vercel.json` 里的命令（从 monorepo 根安装并 `npm run build`）
5. 环境变量（Production）：
   - `NODE_ENV=production`
   - `BETTER_AUTH_URL=https://member.jx42.com`
   - `WEB_ORIGIN=https://member.jx42.com`
   - `BETTER_AUTH_SECRET` / `DATABASE_URL` / `CRON_SECRET` 等按 `server/.env.example`
   - **不要**设 `PORT`（由平台注入）

验证：部署后访问 `https://你的域名/api/health` 应返回 `{"ok":true}`；登录 `POST /api/auth/sign-in/email` 应由 Nest/Better Auth 响应，而不是 Vercel 的 `NOT_FOUND` 页。

## 一期范围

仅 RBAC：管理员用户 / 角色 / 权限绑定；超管不受限；其他用户由管理员创建并受角色限制。

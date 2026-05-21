# LearnPilot AI Backend

后端仓库地址：[ice-a/learnpilot-ai-backend](https://github.com/ice-a/learnpilot-ai-backend)

前端仓库快速跳转：[ice-a/learnpilot-ai-frontend](https://github.com/ice-a/learnpilot-ai-frontend)

## 项目说明

LearnPilot AI 的后端服务，提供：

- 用户认证（注册、登录、找回密码、解锁）
- 模型配置管理（OpenAI 兼容）
- 学习计划与知识点 API
- AI 辅导会话 API
- 面试辅导与评分 API
- 个人中心相关 API

## 技术栈

- Node.js
- Express + TypeScript
- MongoDB + Mongoose
- JWT / bcryptjs / nodemailer

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

默认端口：`3000`

健康检查：`GET /health`

API 前缀：`/api/v1`

## 环境变量

必填：

- `MONGODB_URI`
- `MASTER_KEY`
- `JWT_SECRET`

常用：

- `NODE_ENV`
- `PORT`
- `APP_BASE_URL`

邮件（可选）：

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## 脚本

```bash
npm run dev
npm run build
npm start
npm run lint
npm test
npm run init:providers
```

## 目录结构

```text
src/
  middleware/
  models/
  routes/
  services/
  scripts/
  utils/
```

## 仓库关联

- Backend（当前）：[ice-a/learnpilot-ai-backend](https://github.com/ice-a/learnpilot-ai-backend)
- Frontend：[ice-a/learnpilot-ai-frontend](https://github.com/ice-a/learnpilot-ai-frontend)


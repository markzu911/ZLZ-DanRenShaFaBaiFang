# SofaGen AI 本地调试

这是一个本地优先的 React + Vite + TypeScript + Express AI Web App，用 Gemini 图像模型生成单人沙发电商场景图。

## 本地运行

1. 安装依赖：

```bash
npm install
```

2. 创建 `.env`，参考 `.env.example`：

```bash
GEMINI_API_KEY=你的 Gemini API Key
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_TEXT_MODEL=gemini-flash-latest
```

3. 启动：

```bash
npm run dev
```

4. 打开：

```text
http://localhost:3000
```

## 当前范围

- 本地可用优先，暂不要求部署上线。
- 没有 `userId` / `toolId` 参数时，不会调用 SaaS 扣点、校验和上传流程。
- 调试稳定后，再接入正式部署、平台鉴权、扣点和结果入库。

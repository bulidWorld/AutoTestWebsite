# 前端 Kubernetes 部署

从 `AutoTestWebsite/frontend` 目录构建镜像：

```bash
docker build -t YOUR_REGISTRY/autotest-frontend:1.0.0 .
```

前端容器内的 Nginx 监听 8090，提供 Vue 静态文件，并将 `/api/` 代理至同 namespace 的 `autotest-backend:31010`。`deploy/k8s/frontend.yaml` 创建 NodePort Service：`30111` → Service `80` → 容器 `8090`。完整构建和部署步骤见仓库根目录 README。

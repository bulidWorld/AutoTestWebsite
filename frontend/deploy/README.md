# Kubernetes 部署

生产环境运行 Nginx，提供 Vue 静态文件并代理 API；31011 是示例 NodePort，容器内 Nginx 监听 8080。开发配置 `vite.config.ts` 的代理与端口不会进入生产运行时。

请求链路：浏览器 → 节点 IP:31011 → 前端 Service:80 → Nginx:8080 → 后端 Service → 后端 Pod。

## 1. 对齐后端服务

后端须先部署，并通过 K8s Service 暴露。检查：

```bash
kubectl -n autotest get svc
kubectl -n autotest get endpointslices
```

修改 `k8s/frontend.yaml` 的 `BACKEND_UPSTREAM` 为后端 Service 名称及其 `spec.ports[].port`。例如 Service 名为 `autotest-backend` 且 port=31010，则填写 `autotest-backend:31010`。若 Service port=80、targetPort=31010，应填写 `autotest-backend:80`。31010 若是 NodePort，也不能据此认定 Service port 是 31010。

跨 namespace 使用 `autotest-backend.<后端namespace>.svc.cluster.local:31010`（集群 DNS 后缀按实际配置）。不能使用 `127.0.0.1`，因为它指向前端 Pod 自身。后端进程须监听 `0.0.0.0`，Service selector 匹配后端 Pod，NetworkPolicy 允许前端到后端及 DNS 的通信。

如果后端暂时在集群外，填写可从前端 Pod 到达的后端主机 IP:31010 或 DNS:31010。

## 2. 构建并推送镜像

从 `frontend/` 目录执行，替换镜像仓库和版本：

```bash
docker build -t YOUR_REGISTRY/autotest-frontend:1.0.0 .
docker push YOUR_REGISTRY/autotest-frontend:1.0.0
```

将 YAML 中的 `image` 替换为同一个镜像地址。私有仓库需要在 namespace 中配置 imagePullSecrets 并添加到 Pod spec。

## 3. 部署

示例使用 namespace `autotest`，也可用现有 namespace：

```bash
kubectl create namespace autotest --dry-run=client -o yaml | kubectl apply -f -
kubectl -n autotest apply -f deploy/k8s/frontend.yaml
kubectl -n autotest rollout status deployment/autotest-frontend
kubectl -n autotest get pods,svc
```

访问 `http://<可达的节点IP>:31011`。节点网络/防火墙须允许此端口，31011 不能被其他 Service 的 NodePort 占用，集群 NodePort 范围须包含该端口。

无节点访问权限时，可临时本地转发：

```bash
kubectl -n autotest port-forward svc/autotest-frontend 31011:80
```

然后打开 http://localhost:31011。

## 4. API 如何访问

浏览器请求当前站点的 `/api/v1/projects`，Nginx 保留完整路径转发至后端。浏览器不需要解析集群内 Service 名称，也无需跨域 CORS。Docker 构建显式使用空 `VITE_API_BASE_URL`，部署后的后端地址由 ConfigMap 决定，而非浏览器环境变量。

修改 ConfigMap 后重启前端，使 Nginx 在容器启动时重新生成配置：

```bash
kubectl -n autotest apply -f deploy/k8s/frontend.yaml
kubectl -n autotest rollout restart deployment/autotest-frontend
kubectl -n autotest rollout status deployment/autotest-frontend
```

Nginx 启动时解析 Service DNS，因此应先创建后端 Service。Deployment 健康探针检查前端，不代表后端可用。后端 Service 被删除重建、更换 ClusterIP 后应重启前端以重新解析。

## 5. 验证与排查

```bash
curl http://NODE_IP:31011/healthz
curl http://NODE_IP:31011/api/v1/health
kubectl -n autotest logs deployment/autotest-frontend
kubectl -n autotest exec deployment/autotest-frontend -- nginx -t
kubectl -n autotest exec deployment/autotest-frontend -- wget -qO- http://autotest-backend:31010/api/v1/health
```

最后一个地址应换成实际 BACKEND_UPSTREAM。502 通常需检查 Service DNS、Service port、EndpointSlice、后端监听及网络策略。上传限制已设为 6m 以容纳 5 MiB 文件和 multipart 开销，后端仍负责实际 5 MiB 校验；如前面还有 Ingress/网关，也需允许此请求大小。

需要域名与 HTTPS 时，将前端 Service 改为 ClusterIP，配置现有 Ingress/Gateway 将域名根路径 `/` 转发到 `autotest-frontend:80`，并配置 TLS 证书。API 仍由同域 Nginx 代理，无需单独暴露后端。具体 ingressClass、证书和上传限制按集群控制器配置。

# AutoTest 项目、接口与任务编排前端

基于 Vue 3、TypeScript、Vite，按阶段一项目契约及 `requirement/1-2.support_task_compose/spec.md`、`context/reference/api/rest-task.yaml` 实现项目资产管理与阶段二固定参数任务前端。对接已有后端，不在浏览器执行测试 HTTP 请求，不部署网站。

## 启动

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

开发地址 http://localhost:31011，端口在 `vite.config.ts` 中显式配置；端口被占用时启动失败。`/api` 代理到 http://127.0.0.1:31010。修改 `.env.local` 的 `API_PROXY_TARGET` 后重启开发服务器。

```bash
npm run generate:api  # 从提供的契约生成类型
npm run build         # 类型检查与生产构建
npm test              # 参数类型、绑定、敏感值保留等回归测试（Node 22.18+）
npm run preview       # 查看构建产物
```

生产部署使用 `dist/`，将 `/api/` 反向代理至真实后端。也可在构建前设置 `VITE_API_BASE_URL` 为后端域名（不含 `/api/v1`，不要带末尾斜杠），此时后端需配置 CORS。Vite preview 不提供开发代理。

## 功能

- 项目列表分页、名称搜索、创建、编辑与详情。
- 删除项目和文件前请求影响预览，展示文件、历史版本、接口、任务和运行记录数量，以及删除限制；确认后提交 `confirm=true`。
- multipart YAML 导入和新版本上传；客户端检查扩展名、5 MiB 上限、空文件、UTF-8，服务端负责完整 OpenAPI 校验及原子持久化。
- 文件列表、只读历史版本、按版本/方法/路径浏览接口，接口参数与嵌套 Schema、请求体、响应、认证及 servers 浏览。
- 接口详情中输入参数进行单次测试，展示本次请求与响应，不创建任务或保存历史。
- 原始内容仅从后端脱敏内容接口获取。任务执行使用后端任务 API；不包含回滚、差异比较。
- 空状态、忙碌状态、网络错误、错误码、字段路径及请求 ID 反馈。

`public/samples/` 提供有效、更新、无效 YAML：有效文件含 GET、POST、path/query 参数、嵌套对象和数组；更新样例修改 GET 摘要、移除 POST 并新增 GET 列表；无效样例含外部引用。样例用于验收，页面不展示下载入口。

## 验收

需运行符合契约的后端。按需求 P1-01 至 P1-06 在浏览器验证：创建项目、导入 valid.yaml、浏览接口、上传 updated.yaml，确认当前版本和历史版本内容；上传 invalid.yaml 应显示具体位置并保持版本不变；分别在两个项目导入同名逻辑文件；刷新浏览器及重启后端验证持久化。前端没有本地 mock 数据或存储替代，持久化与重名/任务约束由后端保障。

## Kubernetes 生产部署

Dockerfile、多阶段构建、Nginx API 代理、K8s Deployment/ConfigMap/NodePort Service 示例与完整步骤见 [部署说明](deploy/README.md)。示例前端 NodePort 为 31011，后端地址通过 ConfigMap 的 `BACKEND_UPSTREAM` 配置。

## 阶段二：任务编排与运行

进入项目后选择「任务编排与运行」。支持名称搜索、分页、创建、完整编辑、复制、删除影响预览及二次确认。运行中的任务在列表禁用运行和删除；后端仍须原子处理其他客户端的并发请求。

编辑器支持 HTTP/HTTPS 地址前缀、1～300 秒请求超时（默认 30 秒）、六种固定全局参数类型及敏感标记。选择本项目 YAML 文件和具体历史版本后添加步骤，可重复选择同一接口，复制、移除、上移、下移。已有步骤 ID 始终保留，新增和复制步骤省略 ID，由后端分配。新版本仅提示，显式重选清空该步旧绑定并重新校验。

path、query、header 和 JSON 字段均可整体引用全局参数或设置字面值。字符串直接输入；integer、number、boolean、object、array 输入 JSON。JSON 支持整个根对象/数组及嵌套对象字段（使用 JSON Pointer）；数组字段按完整数组绑定。根绑定和子字段绑定互斥。接口默认值仅首次选择时填入，重新打开不会补入未配置的可选字段。绑定未勾选则不发送；对象 query 明确报错；header 禁止覆盖 Host、方法、地址、超时等执行配置。

前端检查地址、超时、必填、参数重名、类型、引用存在、嵌套 JSON 必填、绑定重叠和对象 query；保存时后端完成权威校验。运行前先保存当前配置、调用 `/validate` 的 run 模式，再调用 `/runs`。校验失败不会调用运行入口。「校验已保存配置」不会发送测试请求。复制整个任务由后端复制敏感值，复制单步骤遇到已隐藏字面值时要求重新输入或改用全局参数引用，避免把脱敏占位符作为执行值。

敏感参数使用密码输入框，API 返回隐藏值后不写入占位符，原名称/类型的敏感参数留空保存时省略 value，保留后端原值。隐藏字面值仅同一稳定步骤、同一字段允许省略 value。Authorization、Cookie、Set-Cookie 请求及响应头额外默认隐藏。请求 URL、正文、错误及快照均使用后端脱敏结果，前端不请求原始敏感数据、不将任务存入浏览器存储或控制台日志。

历史支持分页、状态筛选和手动刷新；详情显示不可变配置快照、参数初始化结果、有序步骤状态、请求列表和单条请求详情。显示方法、实际 URL、头、正文、状态码、时间、耗时和错误分类，区分 HTTP 错误、超时、连接失败与重启中断。页面不自动重试、自动启动运行或轮询；刷新页面后进入任务历史即可查询服务端执行结果。

`rest-task.yaml` 同时包含阶段三 REST 响应参数契约。本阶段仅创建和编辑固定参数任务；遇到已有 REST 参数任务时阻止完整编辑，防止丢失配置，仍可从列表运行并查看历史。

## 阶段二验收

需要提供任务路由的后端。先用 `GET /api/v1/projects/{project_id}/tasks` 确认代理地址提供任务 API；404 时应检查后端部署版本及 `API_PROXY_TARGET`，不能以项目前端可用推断任务路由已加载。

本地可控 HTTP 服务和接口定义：

```bash
python3 scripts/task-mock.py --port 31013
# 如后端在另一主机/容器，按网络配置选择可达监听地址
python3 scripts/task-mock.py --host 0.0.0.0 --port 31013
```

导入 `public/samples/task-compose.yaml`，运行地址配置为**后端可访问**的 `http://127.0.0.1:31013/mock`（容器场景改为可达主机地址）。记录查询 `GET /records`，清空 `DELETE /records`。服务记录收到请求的顺序、解码后的 path、重复 query 数组、头和结构化正文；认证头及 token/password/secret 字段脱敏。记录接口仅用于本地验收，不放到生产。

| 场景 | 操作与预期 |
| --- | --- |
| P2-01 | 依次选择 GET `/items/{id}`、POST `/check`、GET `/finish`；排序、复制、保存再打开，确认步骤 ID、顺序、文件及版本不变。 |
| P2-02 | string `id` 使用 `中文 /?`，query `ids` 引用 integer 数组 `[1,2]`，Authorization 引用敏感 string 参数；POST 的 enabled 使用 boolean，payload 使用 object `{"name":"样例"}`，ids 使用 array。检查 `/records` 的顺序、解码 path、重复 query 和 JSON 类型，认证值隐藏。 |
| P2-03 | 移除必填 id、引用不存在参数、给 integer 输入 `"1"` 或给 enabled 引用 string。保存/运行定位字段错误，`/records` 不新增记录。 |
| P2-04 | POST status=200、delay=0；运行后手动刷新，三步成功，`/records` 顺序一致，每步一次，详情请求/响应完整。 |
| P2-05 | POST status=500；或任务超时=1 秒、POST delay=2；或第二步重选 `/disconnect`。运行失败，第三步跳过，分别显示 HTTP_STATUS_ERROR、TIMEOUT、CONNECTION_ERROR。 |
| P2-06 | 使用延迟启动运行，在另一页面修改任务或上传新版 YAML，再刷新历史；原快照和已生成请求保持不变，编辑器仅提示新版本。 |
| P2-07 | 延迟运行期间从另一页面再次启动同任务，后端返回 409；另一个任务独立执行。 |
| P2-08 | 延迟执行中重启后端，重新查询历史，未结束运行标记 EXECUTION_INTERRUPTED，未执行步骤跳过，服务收到请求不重复。 |
| P2-09 | 使用敏感全局参数及 Authorization，保存后重开、查看快照和请求详情；敏感值不直接展示，留空保留原值；后端日志同样脱敏。 |
| 重定向 | 选择 `/redirect`，返回 302 后失败，`/records` 中不应出现自动跟随的 `/finish` 请求。 |

服务端负责顺序执行、URL 编码/重复 query、快照隔离、持久化、并发限制和重启恢复；前端测试不能代替这些后端验收。HTTP fixture 的内存记录用于观察请求，后端运行历史由后端数据库持久化。


## 界面布局与预览

采用统一的浅色工作台布局，左侧导航区分项目管理、接口资产和任务编排；顶部保留项目上下文与设置入口。任务列表收敛行内操作，复制及删除放入更多操作菜单。

任务编辑分为「基本配置」「全局参数」「执行步骤」，保存与运行固定在页面标题区域。执行步骤采用左侧顺序列表与右侧单步编辑，保存后保留正在编辑的步骤，校验错误自动切换至对应分区。运行历史采用列表和详情分栏，步骤、请求、参数结果及配置快照分区展示；请求/响应详情使用侧边抽屉。

手机端任务列表使用卡片，步骤列表横向滚动，编辑区垂直排列。已检查 390、768、1024、1440 像素宽度；弹窗支持键盘焦点限制、Esc 关闭及关闭后焦点恢复。

`design-preview/` 中的截图来自契约模拟浏览器验证，示例数据仅用于截图，不注入实际页面：

- [任务编辑桌面预览](design-preview/task-editor.png)
- [运行历史桌面预览](design-preview/run-history.png)
- [手机端任务列表](design-preview/mobile-task-list.png)


## 接口单次测试

操作路径：进入项目 → 接口资产 → 浏览 YAML 文件 → 选择接口 → 「单次测试」。支持当前及历史 YAML 版本；方法、路径和版本由选中的接口资产确定。

填写 HTTP/HTTPS 运行地址（可带路径前缀）和 1～300 秒超时；配置 path、query、header 参数，可添加认证或自定义 Header。可选参数未勾选则不发送，数组 query 由后端以重复键编码；JSON 请求体支持完整对象或数组，类型与必填字段在发送前校验。仅支持 JSON 请求体，multipart 执行会被明确拒绝。

点击「发送测试」，通过 `POST /api/v1/projects/{project_id}/yaml-files/{file_id}/interfaces/{interface_id}/test` 让后端执行一次。结果包括实际 URL、请求/响应头与正文、HTTP 状态码、时间、耗时及错误原因。目标返回 500、请求超时或连接失败都展示为失败结果，不自动重试。测试期间禁用重复提交；API 校验错误定位字段。

敏感参数使用密码框输入，Authorization/Cookie 等认证头自动标记敏感；整个 JSON 正文可标记敏感。API 返回脱敏结果，结果中的认证及敏感响应头额外隐藏。

仅在当前页面内存保留输入与本次结果，新测试替换旧结果；在「接口定义」与「单次测试」间切换可保留当前编辑。切换至另一个接口或刷新页面会清空。支持手动清除结果；不使用 localStorage/sessionStorage，不创建任务、运行或请求历史。

后端需要加载包含 `testInterface` 的新版 `rest-project.yaml`。生产 Nginx 模板的 API 读取超时已设为 330 秒，以覆盖最长 300 秒的同步单次测试；自建代理应采用相应配置。

已使用真实后端与本地可控 HTTP 服务联调 JSON 请求、query 编码、数值类型、认证脱敏、HTTP 500、超时、连接失败、重复点击及页面刷新；任务数量保持不变，前端未调用任务创建或运行接口。

# REST 接口核对记录

核对基准：`context/reference/api/` 四份本地契约，2026-10-21。共 45 个操作，其中 43 个业务操作和 2 个健康/就绪探针。以下记录代码映射和静态核对结果，不代表真实后端联调通过。

所有模型均使用 `npm run generate:api` 从对应 YAML 生成。API 通用层统一处理 JSON、multipart、校验路径、错误码、X-Request-ID、网络异常及 204 空响应。

## rest-project.yaml

实现：src/App.vue、src/components/InterfaceTest.vue、src/interface-test.ts。

项目与 YAML 资产的 CRUD、删除预览、历史版本和接口单次测试；更新 OpenAPI 3.1 文案、组合 Schema 展示及 JSON 校验。health/ready 供部署探针使用，界面不主动调用。

| 方法 | 路径（省略 /api/v1） | operationId |
| --- | --- | --- |
| GET | `/health` | `health` |
| GET | `/ready` | `ready` |
| GET | `/projects` | `listProjects` |
| POST | `/projects` | `createProject` |
| GET | `/projects/{project_id}` | `getProject` |
| PATCH | `/projects/{project_id}` | `updateProject` |
| DELETE | `/projects/{project_id}` | `deleteProject` |
| GET | `/projects/{project_id}/deletion-preview` | `previewProjectDeletion` |
| GET | `/projects/{project_id}/yaml-files` | `listYamlFiles` |
| POST | `/projects/{project_id}/yaml-files` | `importYamlFile` |
| GET | `/projects/{project_id}/yaml-files/{file_id}` | `getYamlFile` |
| DELETE | `/projects/{project_id}/yaml-files/{file_id}` | `deleteYamlFile` |
| GET | `/projects/{project_id}/yaml-files/{file_id}/deletion-preview` | `previewYamlFileDeletion` |
| GET | `/projects/{project_id}/yaml-files/{file_id}/versions` | `listYamlVersions` |
| POST | `/projects/{project_id}/yaml-files/{file_id}/versions` | `updateYamlFile` |
| GET | `/projects/{project_id}/yaml-files/{file_id}/versions/{version_number}` | `getYamlVersion` |
| GET | `/projects/{project_id}/yaml-files/{file_id}/versions/{version_number}/content` | `getYamlVersionContent` |
| GET | `/projects/{project_id}/yaml-files/{file_id}/interfaces` | `listInterfaces` |
| GET | `/projects/{project_id}/yaml-files/{file_id}/interfaces/{interface_id}` | `getInterface` |
| POST | `/projects/{project_id}/yaml-files/{file_id}/interfaces/{interface_id}/test` | `testInterface` |

## rest-task.yaml

实现：src/components/TaskWorkspace.vue、src/task-editor.ts、src/components/RunNodeResult.vue。

编辑由扁平序列迁移至统一执行树；明确类型、scope、position 和临时父引用。保留 XML 导入、复制、预览删除、静态校验和运行查询；Header 独立、raw_body 原文保留，运行按节点类型显示，叶子/控制节点分开统计，展示主错误与清理阶段。

| 方法 | 路径（省略 /api/v1） | operationId |
| --- | --- | --- |
| GET | `/projects/{project_id}/tasks` | `listTasks` |
| POST | `/projects/{project_id}/tasks` | `createTask` |
| POST | `/projects/{project_id}/tasks/import` | `importTask` |
| GET | `/projects/{project_id}/tasks/{task_id}` | `getTask` |
| PUT | `/projects/{project_id}/tasks/{task_id}` | `updateTask` |
| DELETE | `/projects/{project_id}/tasks/{task_id}` | `deleteTask` |
| POST | `/projects/{project_id}/tasks/{task_id}/copy` | `copyTask` |
| GET | `/projects/{project_id}/tasks/{task_id}/deletion-preview` | `previewTaskDeletion` |
| POST | `/projects/{project_id}/tasks/{task_id}/validate` | `validateTask` |
| POST | `/projects/{project_id}/tasks/{task_id}/runs` | `startTaskRun` |
| GET | `/projects/{project_id}/tasks/{task_id}/runs` | `listTaskRuns` |
| GET | `/projects/{project_id}/tasks/{task_id}/runs/{run_id}` | `getTaskRun` |
| GET | `/projects/{project_id}/tasks/{task_id}/runs/{run_id}/requests` | `listRunRequests` |
| GET | `/projects/{project_id}/tasks/{task_id}/runs/{run_id}/requests/{request_id}` | `getRunRequest` |

## rest-parameter.yaml

实现：src/components/ParameterEditor.vue、src/components/ParameterConfig.vue、src/parameter-preview.ts、src/components/TaskWorkspace.vue。

来源限定 main REST；流程预览提交完整树并遵循屏障，不执行 finally；单次响应提取仍通过 extract。敏感预览不伪造真实输入，运行值显示 published，草稿继承依赖与独立运行可用性分开处理。

| 方法 | 路径（省略 /api/v1） | operationId |
| --- | --- | --- |
| POST | `/projects/{project_id}/tasks/{task_id}/parameters/preview` | `previewRestParameter` |
| POST | `/parameters/rest/extract` | `extractRestParameter` |

## rest-task-collection.yaml

实现：src/components/CollectionWorkspace.vue、src/task-collection.ts。

补齐组查询、完整保存、删除及运行查询；批次允许重复与间断，同批并发；共享参数、覆盖审计及成员运行跳转。列表只提交契约声明的分页参数，名称筛选仅作用于当前页；删除正确接受 204。

| 方法 | 路径（省略 /api/v1） | operationId |
| --- | --- | --- |
| GET | `/projects/{project_id}/task-collections` | `listTaskCollections` |
| POST | `/projects/{project_id}/task-collections` | `createTaskCollection` |
| GET | `/projects/{project_id}/task-collections/{collection_id}` | `getTaskCollection` |
| PUT | `/projects/{project_id}/task-collections/{collection_id}` | `updateTaskCollection` |
| DELETE | `/projects/{project_id}/task-collections/{collection_id}` | `deleteTaskCollection` |
| POST | `/projects/{project_id}/task-collections/{collection_id}/runs` | `startTaskCollectionRun` |
| GET | `/projects/{project_id}/task-collections/{collection_id}/runs` | `listTaskCollectionRuns` |
| GET | `/projects/{project_id}/task-collections/{collection_id}/runs/{run_id}` | `getTaskCollectionRun` |
| GET | `/projects/{project_id}/task-collections/{collection_id}/runs/{run_id}/overrides` | `listTaskCollectionOverrides` |

## 验证与限制

- 类型生成、Vue/TypeScript 检查、生产构建及 44 项单元回归测试（6 个文件）通过。
- 新增覆盖：树排序/父引用、控制节点字段隔离、并行屏障输入可用性、finally 来源限制、Header 脱敏保留、raw_body 空文本与互斥、整树参数预览、任务组批次及 204 响应。
- 断言语法、断言隐式依赖、活动组预约、服务级调度和事务原子性由后端权威校验；前端展示服务端 issues。
- 本地后端 `127.0.0.1:31010` 健康检查超时，本次未完成真实接口联调。
- 本机 Chromium 缺少 `libnspr4.so`，契约模拟浏览器脚本未能启动；本次不声称已通过桌面/移动端交互验收。

## 后端可用后的验收

1. 导入含 main rest/wait/parallel 和 finally 的 XML，打开后保存，确认节点 ID、parent、position、headers、raw_body 与断言完整往返。
2. 创建并行节点并加入两个子节点；验证最大并发、同组参数互读、嵌套并行及非法 finally 子节点的字段错误。
3. 让 main 失败、finally 成功/失败，刷新运行详情，确认阶段与主错误保留，全部清理结束前持续显示 running。
4. 验证并行请求计数与可查看请求列表数的差异，失败屏障下参数提取成功但 published=false。
5. 参数流程预览等待完整并行屏障且不执行 finally；敏感值不显示、不回存为固定值。
6. 创建同批并发和后续继承批次的任务组，查询成员运行与覆盖审计；活动组修改返回 409；删除 204 后配置消失且历史保留。
7. 导入 OpenAPI 3.1 组合 Schema，查看结构并发送有效/无效 JSON 单次测试。

# HTTP API

API 与前端同源，路径前缀 `/api`。Cookie 为唯一认证载体；无 Bearer API key / 跨域 CORS。除登录外，修改请求都需要 `X-CSRF-Token`，从登录响应或 `/api/me` 获取。

JSON 请求使用 `Content-Type: application/json`。API 错误返回 `{ "error": "...", "requestId": "..." }`，并附 `X-Request-ID`。认证失败 401，权限失败 403，同企业不存在资源或其他企业资源均返回 404，状态冲突 409，格式错误 400，配额 / 体积超限 413，登录或任务限流 429。

## 会话与企业

| 方法 | 路径 | 内容 |
|---|---|---|
| GET | `/health` | 无认证：版本与存活状态，不代表深度存储健康检查 |
| POST | `/login` | `{email,password}`；设置 Cookie，返回 `{csrf}` |
| GET | `/me` | 当前用户 id、email、role、tenant 名称、csrf |
| POST | `/logout` | 撤销当前会话 |
| POST | `/password` | `{currentPassword,password}`；撤销该账号全部会话 |

登录限流为每连接源 IP 在 15 分钟内最多 12 次尝试，包含成功尝试；并发密码派生最多 4 个。同一账号再次登录会撤销前一会话，绝对有效期 8 小时。

## 项目与数据集

| 方法 | 路径 | 权限 / 请求 |
|---|---|---|
| GET | `/projects` | 全角色，返回本企业最多 200 个项目 |
| POST | `/projects` | admin / analyst，`{name,description?}` |
| GET | `/datasets?project=<id>` | 全角色，本项目最多 200 个 ready 数据集 |
| POST | `/datasets` | admin / analyst，二进制规范化体素，见下 |
| POST | `/demo` | admin / analyst，`{projectId}`，生成固定种子 96³ phantom |
| GET | `/datasets/<id>/raw` | 全角色，规范化 unsigned 小端体素二进制 |

二进制导入需 `Content-Type: application/octet-stream`，`X-Volume-Meta` 为 `encodeURIComponent(JSON.stringify(metadata))`：

```json
{
  "projectId": "project-uuid",
  "name": "Specimen-01",
  "dims": [96, 96, 96],
  "spacing": [8, 8, 12],
  "bits": 16,
  "format": "RAW"
}
```

请求体长度必须正好等于分析网格的 `X×Y×Z×bits/8`。API 接收规范化小端数据；大端转换、文件头去除、RAW 区域采样和图片解码在前端进行。返回 id、sha256 和 meta。不会接受客户端传入的 tenant_id。数据集没有更新 / 删除接口。

RAW 区域导入可附加 `rawSource`，字段包括原始 `dims`、`spacing`、`bits`、`offset`、`littleEndian`、`origin`、`size` 与 `stride`。例如从 `[8,8,8]`、间距 `[1,1.5,2]`、步长 `[2,2,2]` 生成网格时，顶层 `dims` 为 `[4,4,4]`、`spacing` 为 `[2,3,4]`。服务端校验计算得到的网格与顶层参数一致，将规范化后的源参数保存到 `meta.source.rawImport`，并包含在分析报告中。完整字段定义见 [导入指南](DATA_IMPORT.md)。

## 分析任务

| 方法 | 路径 | 内容 |
|---|---|---|
| GET | `/jobs?project=<id>&limit=25&offset=0` | 全角色，limit 1–100，offset 0–100000 |
| POST | `/jobs` | admin / analyst；返回 202 和任务 ID |
| GET | `/jobs/<id>` | 任务状态、设置、错误、耗时和时间 |
| POST | `/jobs/<id>/cancel` | admin / analyst；仅 queued / running |
| GET | `/jobs/<id>/report` | succeeded 结果 JSON |
| GET | `/jobs/<id>/labels` | uint32 LE 连通域标签，0 为非保留孔隙 |
| GET | `/jobs/<id>/roi` | 每体素一个 uint8，0/1 |
| GET | `/jobs/<id>/vertices` | float32 LE，每点 `[x,y,z,component_size_color]` |

提交格式（所有设置字段必须提供）：

```json
{
  "datasetId": "dataset-uuid",
  "settings": {
    "method": "otsu",
    "threshold": 95,
    "dark": true,
    "connectivity": 26,
    "minSize": 4,
    "shape": "box",
    "inset": 0
  }
}
```

`method`: manual / otsu；threshold: 0–65535；connectivity: 6 / 26；minSize: 正整数，不超过总体素数；shape: box / cylinder；inset: 0–0.4。Otsu 忽略手动 threshold，实际阈值在报告 `settings.effectiveThreshold` 中。

结果包括 `summary`、`components`、`profile`、`sensitivity`、`histogram`、`settings`、`volume`、`cloud`、`provenance`。所有体积单位为 µm³、长度为 µm，porosity 为 0–1 的比例。二进制数据布局与输入索引一致。

## 复核、团队与审计

| 方法 | 路径 | 权限 / 请求 |
|---|---|---|
| GET | `/jobs/<id>/reviews` | 全角色，追加记录列表 |
| POST | `/jobs/<id>/reviews` | admin / analyst，`{decision:"accepted"或"rejected",comment}`，仅 succeeded 任务 |
| GET | `/users` | admin，当前企业最多 200 个成员，不返回密码哈希 |
| POST | `/users` | admin，`{email,password,role}`；密码至少 12 字符且最多 256 UTF-8 bytes |
| POST | `/users/<id>/disable` | admin，停用本企业其他成员、撤销会话；不可停用自己 |
| GET | `/audit?offset=0` | admin，最多 100 条事件及完整企业审计链校验结果 |

复核不允许覆盖或删除。账号 email 全局唯一；企业归属由管理员当前会话确定。管理员不能通过 API 把用户放入另一个企业。

API 的设计面向同源 Web 工作台，不含公开 SDK、服务账户、幂等键或版本兼容承诺。集成时请固定应用版本，使用自己的测试数据跑完整工作流。

# 部署与运维

## 本地运行

Node 24.x，`npm start`，默认只监听 `127.0.0.1:8787`。数据目录默认为当前项目的 `data/`。首次初始化生成随机管理员密码；已有数据库再次启动不会替换密码。

| 环境变量 | 默认值 / 用途 |
|---|---|
| `DATA_DIR` | `data`，数据库、输入体数据和计算结果目录 |
| `HOST` | `127.0.0.1`；网络监听需要 HTTPS 模式 |
| `PORT` | `8787` |
| `VOXELSCOPE_TENANT` | 首次初始化企业名 |
| `VOXELSCOPE_ADMIN_EMAIL` | 首次管理员 `admin@local` |
| `VOXELSCOPE_ADMIN_PASSWORD` | 首次密码；不设置则随机生成，只在首次终端显示 |
| `SECURE_COOKIES` | 网络部署必须为 `true` |
| `PUBLIC_ORIGIN` | 网络部署显式设置，例如 `https://ct.example.com` |

修改初始化变量不会更新既有账号。密码恢复用下方维护命令。不要把真实密码写进源码、GitHub Actions 日志或公开 README。

## Docker Compose + HTTPS

```bash
cp .env.example .env
# 编辑 .env，更换初始密码；生产域名需要同时修改 SITE_HOST 和 PUBLIC_ORIGIN。
docker compose up --build -d
docker compose logs app
```

PowerShell 可使用 `Copy-Item .env.example .env`。本地地址 `https://localhost`，Caddy 本地证书需按你的操作系统配置证书信任。域名部署需预先配置 DNS 和 80 / 443 入口，Caddy 才能完成证书签发。

应用容器以非 root 身份运行，只读根文件系统，数据使用独立卷；API 不直接映射公网端口。Compose 默认 1 GiB 内存和 2 CPU，分析线程并发为 1。对容器镜像的标签固定只是方便启动；正式发布需要固定镜像 digest，并做漏洞扫描。

**本交付环境没有 Docker，因此未实际构建和运行 Compose。** 部署文件提供了服务、卷、健康检查及代理配置；请在目标服务器先执行 `docker compose config`、构建、启动和验收。

## 多企业配置 / 管理员恢复

拥有服务器文件权限的运维人员可以配置第二个企业。以下在应用项目目录运行，使用与服务相同的 DATA_DIR。

PowerShell：

```powershell
$env:VOXELSCOPE_ADMIN_PASSWORD = '请替换成你自己的长随机密码'
node scripts/provision.mjs --tenant "第二家检测企业" --email admin@company.example
Remove-Item Env:VOXELSCOPE_ADMIN_PASSWORD
```

Linux：

```bash
VOXELSCOPE_ADMIN_PASSWORD='choose-your-own-long-random-password' node scripts/provision.mjs --tenant 'Second company' --email admin@company.example
```

恢复既有账号使用 `--reset --email ...`，不加 `--tenant`。恢复会启用账号、更新密码、撤销该账号会话，并写入审计记录。该工具只面向拥有服务器访问权限的运维人员；网页管理员不能创建别的企业。

## 一致性备份

```bash
node scripts/backup.mjs backups/snapshot-01
```

目标目录必须尚不存在，且不能在 DATA_DIR 内部。脚本先用 SQLite 在线备份 API 生成快照，再按快照复制 ready 输入和 succeeded 输出。结果文件和体数据在应用层不可修改，因此可在单实例服务运行时执行。

只有完整成功的备份才写入 `BACKUP.json` 且 `complete=true`。失败备份不能当作可恢复副本。备份包含密码哈希和有效会话哈希，应按敏感业务数据管理。建议加密、异机复制并定期演练。

恢复步骤：

1. 停止应用服务。选择含完整 `BACKUP.json` 的备份目录，保留当前 DATA_DIR 副本。
2. 将备份复制到一个新的恢复目录，把 DATA_DIR 指向该目录。
3. 在恢复目录的 SQLite 中执行 `DELETE FROM sessions;`，撤销快照中的旧会话。可使用受信任的 SQLite 管理工具；不要恢复旧会话到新的公网部署。
4. 启动单个服务实例。queued 任务恢复执行，running 标为中断失败。
5. 登录，核对项目、输入指纹、任务报告和审计链，抽查一份重新计算结果。

## 容量与维护边界

- 每个企业最多 200 项目 / 200 数据集 / 200 用户，10 个排队或运行任务，2000 个任务记录。
- 输入体数据总量默认限额为 512 MiB；结果、数据库、日志和备份另占空间。需要监控磁盘，设置服务器级磁盘配额和报警。
- 不自动删除结果与业务记录。失败上传、取消任务或进程中断可能留下不完整文件 / 未 ready 记录；维护清理需先备份、确认无运行任务，并按数据库引用核对，不要直接按日期删目录。
- 同一 DATA_DIR 仅允许一个应用实例。不要通过增加 Compose 副本来水平扩容。
- 登录限流当前按 TCP 对端 IP：反向代理下所有用户共享代理限流桶。此实现不信任 X-Forwarded-For，不能直接据此抵御大规模公网攻击；生产可在入口加独立限流 / 身份提供者。
- `node:sqlite` 在 Node 24 仍可能有 API 变化。固定 Node 24，升级先跑数值、HTTP、运维和浏览器测试。
- 没有 SSO、MFA、项目级 ACL、自动日志外送、软件自动更新、法规电子签名或渗透测试结论。

## 企业试点验收

使用独立测试账号分别验证三角色与第二企业隔离；用实际扫描样件确认阈值 / ROI / 体素间距；验证账号停用和密码恢复；模拟任务超时与服务重启；至少执行一次备份恢复；测量目标硬件上的实际体数据耗时、RSS 和并发访问体验。合成体测试不替代真实检测验证。

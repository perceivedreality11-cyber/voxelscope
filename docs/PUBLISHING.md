# 发布到 GitHub

源码包包含应用、测试、文档、演示截图、MIT 许可证和 GitHub Actions 工作流，不包含 Git 历史、账号密码、数据库或真实 CT 数据。截图中使用合成 phantom 与测试账号。

## 先本地运行

解压源码包，进入其中的 `voxelscope` 目录。安装 Node.js 24.x 后运行：

```bash
npm run check
npm test
npm start
```

无需 `npm install` 即可启动。打开 http://127.0.0.1:8787，使用终端显示的 `admin@local` 初始密码登录，创建项目并加载演示数据。按 `Ctrl+C` 停止服务。

## 创建仓库并上传

1. 登录你的 GitHub 账号，打开 [创建 voxelscope 仓库](https://github.com/new?name=voxelscope&description=Self-hosted%20CT%20porosity%20analysis%20and%20team%20collaboration%20platform)。
2. 选择 Public 或 Private。创建一个空仓库，不勾选自动添加 README、许可证或 `.gitignore`，这些文件已包含在源码中。
3. 安装 Git，在解压后的 `voxelscope` 目录打开终端，运行以下命令。把邮箱替换成自己的 Git 提交邮箱，也可使用 GitHub 提供的 noreply 邮箱：

```bash
git init -b main
git config user.name "perceivedreality11-cyber"
git config user.email "YOUR_GITHUB_COMMIT_EMAIL"
git add .
git status --short
git commit -m "Initial VoxelScope CT analysis platform"
git remote add origin https://github.com/perceivedreality11-cyber/voxelscope.git
git push -u origin main
```

示例仓库地址使用当前连接账号 `perceivedreality11-cyber`；若改用其他账号，替换用户名。首次 push 时通过 Git Credential Manager 的浏览器登录完成身份验证，不要将令牌写进远端 URL 或源码。

若使用当前工作区而非解压后的源码，已有 Git 仓库时可省略 `git init`。若已有 `origin`，先用 `git remote -v` 检查，确认目标后使用 `git remote set-url origin ...`。若远端已有内容，先获取并检查历史，不要强制覆盖。

上传前检查 `git status --short`，确保不包含 `.env`、`data/`、`backups/`、日志和真实工件数据。默认 `.gitignore` 已排除常见运行数据，但仍需检查自定义文件。

## 检查自动化验证

push 成功后进入仓库的 Actions 页面。`checks` 工作流包含：

- Ubuntu 与 Windows 的语法检查、数值 / HTTP / 运维 / RAW 区域读取测试，以及独立账号并发访问验证。
- Chromium 中的登录、项目创建、分析、导出内容核对、复核、团队权限、手机布局和数据导入回归。
- 浏览器运行产生的截图作为工作流构建产物保留 7 天。

浏览器任务需要从 npm 下载 Playwright 并安装 Chromium；首次运行时间会长于基础测试。远端 Actions 状态以对应提交的实际运行结果为准。

## 仓库展示与部署

README 展示功能、示意图、真实运行截图和自动化测试入口。导入网格预算、采样分辨率、部署参数与测量定义分别在技术手册中记录；演示截图标识为合成 phantom。

MIT 许可证允许商业使用。按 [部署手册](DEPLOYMENT.md) 配置 HTTPS、账号和备份，使用 [验证记录](VALIDATION.md) 中的验收表登记目标环境结果。

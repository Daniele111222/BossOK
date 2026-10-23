# 老板批了

两人使用的每日预算、记账和超支审批应用。

当前已完成 T01–T03 的本地开发与验收：受控登录和两人绑定、预算版本及分类口径、幂等记账、账本筛选和双方剩余额度。审批、账目更正/退款、统计和推送尚未实现。Module 职责与后续实现约束见 [架构设计](docs/架构设计.md)。

## 环境与安装

- Node.js **24.x**（`.nvmrc` 与 `package.json` 已约束）。
- npm，使用根目录的 npm workspaces 和统一 `package-lock.json`。
- 手机调试与签名打包需 HBuilderX；原生鸿蒙另需 DevEco Studio 和相应签名配置。

```bash
nvm use
npm ci
```

如果没有安装 nvm，使用其他方式切换到 Node 24 即可，运行 `node -v` 确认。SQLite 驱动包含原生扩展；无法获取当前平台预编译文件时，需要本机编译工具。

## 本地运行

在根目录打开两个终端，分别启动：

```bash
npm run dev:server
```

```bash
npm run dev:app
```

- 浏览器访问 `http://127.0.0.1:5173`，首页检查服务连接，底部切换五个页面。
- 健康接口：`GET http://127.0.0.1:3000/api/health`。
- 正常响应：`{"status":"ok","service":"bossok-api","database":"ok"}`。
- H5 开发的 `/api` 经 Vite 代理到本地 3000 端口。自定义服务端口时同步调整 `app/vite.config.ts` 的代理。
- 服务启动时创建 `server/data/bossok.sqlite` 并按文件名依次应用 `server/migrations/*.sql`；重复启动不重复执行迁移。
- 迁移依次建立身份、预算和账目表，不写入测试账号或虚构账目；账号通过本机受控命令创建。

## 环境变量

可选地复制示例配置：

```bash
cp server/.env.example server/.env
cp app/.env.example app/.env.local
```

服务端从 `server/.env` 读取 `HOST`、`PORT`、`DATABASE_PATH`，默认监听 `127.0.0.1:3000`。配置集中校验，数据库相对路径固定以 `server/` 为基准，不依赖启动目录；生产环境使用持久化目录。

手机端的 `VITE_API_BASE_URL` 填写包含 `/api` 的完整地址，在构建时注入。例如 `https://你的接口域名/api`。此变量对用户可见，不能放密钥。

手机不能用自身的 `localhost` 访问电脑服务。局域网调试需让服务监听 `0.0.0.0`，填写电脑局域网地址，并按平台配置开发网络权限。当前没有跨域放行；浏览器开发使用同源代理，生产 H5 应通过反向代理将 `/api` 转发到服务端。

## 检查与构建

```bash
npm run typecheck
npm test
npm run build
```

也可以运行 `npm run check` 执行以上三项。

- `npm run build`：输出 `server/dist/` 和 `app/dist/build/h5/`。
- `npm run build:app`：编译 App 资源到 `app/dist/build/app/`，**不生成可安装 APK**。
- `npm run start --workspace @bossok/server`：运行已构建服务，仍需保留 `server/migrations/`、`packages/contracts/dist/`、已安装的工作区依赖和持久化数据目录。
- 根级命令自动先编译共享契约；修改契约后运行 `npm run build:contracts` 并重启开发进程。工作区内的单独命令假定契约已编译。

测试由根目录统一运行，使用真实 SQLite 内存库与临时文件，不接触开发数据库。覆盖配置校验、健康检查、错误隐藏、迁移幂等、持久化、跨端契约、网络失败和模块依赖规则。

初始化验证（2026-10-23，Node 24.22.1）：类型检查、2 项测试、服务端/H5 构建及 App 资源编译通过；浏览器确认首页服务与数据库连接正常，五个导航页面均可打开。未验证安卓或鸿蒙真机安装。

架构调整验证（2026-10-23，Node 24.22.1）：类型检查、20 项测试、服务端/H5 构建及 App 资源编译通过；构建产物的契约包加载、数据库迁移定位与健康检查通过。具体变更见 [架构设计](docs/架构设计.md)。

## 安卓与鸿蒙安装包

`app/src/manifest.json` 的 `appid` 留空，需要在正式运行或发行前使用自己的 DCloud 应用标识，不能填造假的 App ID。

1. 安装兼容当前编译器的 HBuilderX，打开 `app/` 工程并配置 DCloud App ID。
2. 安卓：在 HBuilderX 中运行到 Android 设备；发行时使用自己的包名、签名与证书生成 APK。
3. 原生鸿蒙：按 HBuilderX 的 App-Harmony 运行/发行流程，配置 DevEco Studio、鸿蒙应用标识、签名和目标设备。
4. 分别验证安装、网络、系统权限与覆盖升级。浏览器或 App 资源编译成功不等于真机验收成功。

当前没有提供虚假签名、鸿蒙成品包或推送配置。`app-harmony` 保留平台配置入口，具体配置根据真实设备及开发者账号完成。安卓与鸿蒙不能默认共用一个安装包。

签名文件、数据库、环境文件和构建产物已加入 `.gitignore`；正式使用时务必备份签名及数据库，数据库在线备份应使用 SQLite 备份机制，不单独复制正在写入的主文件。

## 目录

```text
app/                  uni-app + Vue 3 + TypeScript
  src/features/       功能 Module 的公开 Interface
  src/shared/http/    请求与错误处理
  src/platform/       uni.request Adapter
  src/pages/          首页、账本、审批、月度汇总、我的
packages/contracts/   前后端共享类型、Schema 和运行时校验
server/               Fastify + TypeScript + better-sqlite3
  src/modules/        路由与业务 Module
  src/infrastructure/ SQLite 初始化与迁移
  src/http/           HTTP 错误处理
  migrations/         顺序执行的 SQL 迁移
  tests/              后端行为、跨端契约与架构依赖规则
docs/                 产品与技术文档
```

- [核心产品需求](docs/核心产品需求.md)
- [技术方案与开发计划](docs/技术方案与开发计划.md)
- [架构设计](docs/架构设计.md)
- [项目文档导航](docs/README.md)：需求池、功能规格、开发任务与验收计划。

后续从 T04 继续实现更正退款、审批、节省反馈、通知及真机交付。本次仅本地验收，不代表部署或真机安装已完成。

依赖版本参考 [uni-app 官方 Vue 3 TypeScript 模板](https://github.com/dcloudio/uni-preset-vue/tree/vite-ts)，DCloud 编译依赖保持同一版本，Vite 与其插件要求一致。升级时一起验证类型检查、H5、App 资源编译和真机兼容性。

## 已知依赖风险

2026-10-23 安装并执行非强制 `npm audit fix` 后，审计仍报告 42 项依赖风险（29 高、6 中、7 低）。这包含同一漏洞沿依赖链传播的包级报告，主要涉及 uni-app 固定编译链、Vite 5、Vue 服务端渲染及旧的间接依赖；不能解读为 42 个独立业务漏洞。

当前编译链按官方模板固定版本，尚未验证可以安全跨版本升级，未使用 `--force` 或强制覆盖依赖。开发服务默认只监听本机；正式对外发布前，需要核查适用场景并完成框架兼容升级和复测。当前检查通过不等于依赖安全审计通过。

## 受控账户管理（T01）

账户只由本机管理命令创建，审批人/申请人各一个，不开放注册。用户亲自输入自己的密码（10–128 字符），密码不作为命令行参数或写入文件。在 zsh 中执行：

```zsh
read -s 'account_password?请输入自己的密码：'; print
print -r -- "$account_password" | npm run admin --workspace @bossok/server -- create 你的账号 approver
unset account_password
```

申请人将角色替换为 `applicant`。重置使用 `reset-password 你的账号`（省略角色），同样从标准输入读取新密码，同时撤销该账号全部旧会话。先在“我的”登录，审批人生成邀请码，申请人阅读共享说明后输入邀请码绑定。邀请码单次使用、24 小时有效；会话 7 天有效，退出立即失效。管理命令需 Node 24，生产环境应由用户在可信终端输入密码。


## 预算与记账（T02–T03）

审批人在“我的”设置预算、计日分类及原因，双方可查看预算历史。首次当日生效；日额度及分类变更次日生效，月预算当月立即生效；下月沿用金额，不结转。申请人在“账本”填金额、分类、真实消费日及备注；首页在进入前台/切换回来或刷新时读取最新额度。审批人可查看全部共享账目，不能代为录入。

- 接口：`GET /api/me`；`POST /api/login`、`/logout`、`/invitations`、`/bind`；`GET/POST /api/budget`；`GET /api/balances`；`GET/POST /api/expenses`。除登录外使用 `Authorization: Bearer <token>`，关系从可信会话取得，不接受客户端指定关系。
- 金额为整数分，单笔/预算范围 0.01–1,000,000 元；消费日为上海日期，允许 2000-01-01 至当日，不允许未来日期；备注最长 500 字，预算原因最长 300 字。
- 账本按 `month=YYYY-MM` 和可选 `category` 筛选；`page` 为 1–100000，`pageSize` 为 1–100（默认 20）。一次只查询一个月，不提供无界全量接口。
- 创建请求提供唯一 `requestId`；同标识同内容返回原记录，改内容返回 409。网络错误或会话失效保留待确认内容与标识，重新登录后重试同一笔；待确认期间不可改内容。草稿按账号存于当前设备，勿清理应用数据直到确认成功。
- 预算前补记独立标明，不扣预算；未审批超支照实保存并保留录入时标记，之后提高预算不抹掉该标记。生活缴费默认只扣月预算。

本地验收证据见 [开发验收记录](docs/开发验收记录.md)。真机、后台推送、部署及依赖风险处理仍是后续交付内容。

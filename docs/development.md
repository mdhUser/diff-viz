# 开发、测试与发布

## 目录结构

```text
diff-viz/
├── bin/diff-viz.mjs        # CLI 入口
├── src/
│   ├── cli.mjs             # 参数解析与命令分发
│   ├── collect.mjs         # diff → 依赖图 → 数据文件
│   ├── review-store.mjs    # 拆分存储：清单 + 逐节点内容文件、旧格式读取/升级
│   ├── diff-parse.mjs      # unified diff 解析 / TODO 扫描
│   ├── deps.mjs            # import 解析 + 扫描缓存
│   ├── cache.mjs           # 文件级解析缓存（mtime + size）
│   ├── languages.mjs       # 语言注册表（内置 + 自定义语言）
│   ├── workspace.mjs       # 多仓库工作区：manifest 依赖检测、服务级影响传播
│   ├── git.mjs             # Git 命令封装、批量 blob 读取、.git/info/exclude 写入
│   ├── hub.mjs             # 常驻 hub：仓库注册、历史 Review、watch/SSE、状态与注解 API
│   ├── server.mjs          # 单 Review HTTP 服务（兼容/测试）
│   └── util.mjs
├── web/                    # React + Vite + Tailwind 前端源码
├── dist/                   # 已构建前端资源（提交进仓库）
├── test/                   # node:test 测试
├── scripts/demo.mjs        # 生成演示仓库并启动
├── docs/                   # CLI 参考、数据契约、语言解析等文档
├── SKILL.md                # Agent Skill 说明
├── CHANGELOG.md
└── README.md
```

## 本地开发

改前端需要装依赖并重新构建 `dist/`；只改 CLI 可直接运行源码。

```bash
git clone https://github.com/mdhUser/diff-viz.git
cd diff-viz
npm install
npm run build
node bin/diff-viz.mjs        # 或 npm link 后直接 diff-viz
```

```bash
npm test                  # node:test，自动发现 test/*.test.mjs
npm run typecheck         # tsc --noEmit
npm run release:check     # 校验当前版本在 CHANGELOG.md 中有发布说明
npm run demo              # 创建 .demo 演示仓库并启动界面
npm run package:skill     # 薄 skill 包（只含 SKILL.md）
npm run package:skill:standalone  # 可选：离线自包含包（含 bin/src/dist）
```

前端技术栈：React 18、Vite、Tailwind CSS v4、`@xyflow/react`、`dagre`、`react-diff-viewer-continued`、`lucide-react`。`dist/` 是提交物，改了 `web/` 必须 `npm run build`，否则 npm 包与 skill 包里还是旧 UI。

CI（`.github/workflows/ci.yml`）在 ubuntu / macOS / Windows 上跑 `release:check`、`typecheck`、`test`，并在 ubuntu node20 上跑一次 `build`。

## 发布新版本

1. 在 `CHANGELOG.md` 的 `## [Unreleased]` 下写清 `Added` / `Changed` / `Fixed`，说明用户能感知到什么。
2. 把 `Unreleased` 改成新版本号并补日期，同时更新 `package.json` 的 `version`（两者必须一致）。
3. 跑检查：

   ```bash
   npm run release:check
   npm run typecheck
   npm test
   npm run build
   ```

4. 提交、打 annotated tag、推送：

   ```bash
   git add -A
   git commit -m "Release vX.Y.Z: <主题>"
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

5. 在 GitHub Releases 创建对应 tag 的 release，把 CHANGELOG 该版本内容作为 notes（可上传 `release/diff-viz-skill.zip`）。
6. 发布 npm（包名 `diff-viz-cli`，命令仍是 `diff-viz`）：

   ```bash
   npm login --registry=https://registry.npmjs.org
   npm publish --registry=https://registry.npmjs.org
   npx -y diff-viz-cli@latest --version
   ```

   `prepublishOnly` 会先跑 release check、typecheck、test、build。注意：

   - 本机 registry 可能是 npmmirror，发布时显式带 `--registry`。
   - 新包首次发布会先创建 `0.0.0-stage` 占位版本，真实版本可能延迟几分钟可见。
   - 启用 staged publishing 时，`npm publish` 会变成 `npm stage publish` + `npm stage approve`，未审批的版本不会公开。

7. 确认 CI 通过、npm 能拉到新版本、Release 页面可访问。

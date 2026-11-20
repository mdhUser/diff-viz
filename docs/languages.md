# 依赖解析与自定义语言

diff-viz 通过静态解析 import / require / use 构建文件之间的依赖边，再从变更文件反向找下游，得到「受影响但没改过」的文件。解析不执行代码，也不处理运行时动态路径。

## 内置语言

| 语言 | 解析内容 | 解析范围 |
| --- | --- | --- |
| JS / TS / JSX / TSX / Vue / Svelte | `import`、`export ... from`、`require()`、动态 `import()` | 相对路径、`tsconfig.json` / `jsconfig.json` 的 `baseUrl`、`paths`、`index.*`、`.js` → `.ts` |
| Python | `import a.b`、`from a.b import x`、相对 import | 仓库根目录与 `src/`，`module.py` / `module/__init__.py` |
| Go | `import "..."`、import block | `go.mod` 的 module 前缀 → 目录下的 `.go` 文件 |
| Java | `import com.foo.Bar;`、`import static ...`、`import com.foo.*`、同包类引用 | 按 `package` + 文件名建立 FQCN 索引，支持 Maven/Gradle 的 `src/main/java`、多模块目录 |
| Kotlin | `import com.foo.Bar`、`import com.foo.*` | 同 `package` + 文件名索引；忽略 `kotlin.*` / `java.*` / `androidx.*` 等标准库 |
| C# | `using Acme.Services;`、`using static ...` | 按 `namespace` + 文件名索引，先匹配命名空间再匹配类；忽略 `System.*` / `Microsoft.*` |
| Rust | `mod foo;`、`use crate::a::b::C;`、`super::` / `self::` | `foo.rs` / `foo/mod.rs`；`crate::` 映射到 `src/`，逐段回退到最近的模块文件 |
| Ruby | `require_relative 'x'`、`require 'x'` | 相对当前文件解析，或按 `lib/`、仓库根目录查找 `x.rb` / `x/index.rb` |

其他文件仍会作为变更节点展示，只是没有依赖边。

## 自定义语言

仓库里放 `.diff-viz/languages.json`（或用 `--languages <file>` 指定）即可注册新语言，不需要改代码：

```json
{
  "languages": [
    {
      "id": "foo",
      "label": "Foo",
      "extensions": [".foo"],
      "strategy": "package",
      "packagePattern": "^package ([\\w.]+)",
      "importPatterns": ["^use ([\\w.]+)"]
    }
  ]
}
```

- `strategy: "package"`：文件头声明包名，import 写成 `包名.文件名`（Kotlin / C# 这类）；`packagePattern` 用第一个捕获组取包名。
- `strategy: "relative"`：import 是相对路径（Ruby 这类），用 `indexNames` 指定目录入口文件名。
- `ignorePrefixes` 可排除标准库命名空间。配置写错会直接报错，不会静默丢边。

## 影响分析

从每个变更文件出发，沿「被 import」的反向关系寻找下游文件，最多 `--impact-depth` 层（默认 3，最多 6）、`--max-impact` 个节点（默认 120），并为每个受影响文件记录 `impactChain`，详情里能看到「A → B → C」的传播路径。只展示仓库内文件；`node_modules`、`vendor`、`dist` 等目录会被跳过。

已知近似：Java 同包引用靠标识符匹配，注释/字符串里出现同名类可能产生少量误报（界面里可一键「忽略」）；tsconfig 只读仓库根目录，不处理 `extends` 和 monorepo 子包；超过 15,000 个代码文件只扫描前 15,000 个，并在 `meta.warnings` 中提示。

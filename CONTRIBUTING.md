# 参与开发

此预览优先维护 Mac 上 Codex 与 Claude Code 的项目交接。新功能先说明具体用户问题，不把 AI 观察变成用户确认。不要提交真实聊天、项目记忆、个人设置或凭据。

## 本机运行与验证

```sh
cd station
npm ci
npm test
npm run build
npm start
```

自动检查使用临时目录和虚构材料。界面修改应在独立数据目录、独立端口上检查，避免使用真实用户项目。测试真实 AI 时，单独记录工具、任务、读取版本、结果与未验证事项；模拟输出不能写成真实模型通过。

## Mac 构建

需要 Apple Silicon Mac、Xcode Command Line Tools、Python 3、Node 与 npm。安装依赖后：

```sh
npm run desktop:build
```

输出在仓库的 desktop-release/，不包含数据目录。选用的 Node 发行版必须带有其 LICENSE；可通过 MEMORY_STATION_BUILD_NODE 指定该发行版中的 node 可执行文件。应用自带 Node，最终用户不需另装。

默认使用本机签名。公开应用分发前需由维护者完成可用的 Developer ID 签名、公证及新电脑验收；当前脚本没有自动完成这些步骤。可用 MEMORY_STATION_SIGN_IDENTITY 指定已安装的签名身份，不能把签名私钥提交到仓库。

## 重新导出干净源码

在仓库根目录运行 `node release/export-source.mjs --out /tmp/project-memory-preview`。目标必须不存在。导出器只收取清单中的代码目录和发布文档，拒绝符号链接，排除运行数据、构建物及本机配置，生成文件校验清单。规则扫描不能代替发布前人工审查。

仓库根 README 是给新用户的当前说明；历史实验记录不作为安装步骤。修改行为时同步说明、限制和相关检查。PR 应解释问题、最终行为及验证边界。

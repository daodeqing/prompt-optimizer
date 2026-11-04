# 提示词优化器

Cindy 插件：根据用户目标、项目资料和历史方案，生成清晰、可执行且节省上下文的提示词。

## 功能

- 将用户原话改写为可供下一次 AI 使用的提示词
- 支持 draft、standard、best 三档上下文与输出预算
- 可引用用户明确选择的项目文件、历史记录和导入资料
- 通过 Cindy 卡片展示可复制结果，不执行改写后的任务

## 项目结构

- `ghost.json`：插件清单与工具声明
- `main.js`：插件逻辑
- `main-view.html`、`main-view.css`、`main-view.js`：插件界面
- `node/worker.cjs`：按需运行的 Node worker
- `manual/`：使用手册

## 安装

通过 Cindy 的插件管理功能安装项目中的 `.cindy` 文件。最低 Cindy 版本见 `ghost.json`。

## 许可证

本项目采用 MIT License，详见 [LICENSE](LICENSE)。

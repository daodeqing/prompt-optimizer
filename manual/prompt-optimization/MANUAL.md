# 提示词优化器 1.4.0

插件详情页“模型与推理强度”和工作台直接选择真实模型来源、型号、推理强度与 Fast，保存后统一生效。不替用户指定模型或捏造档位。run_model_test 的 kind 为 candy、fingerprint、pelican；画鹈鹕 variant 为 original 或 all-in-one。fingerprint 固定 3 组挑战，pelican 每次 1 轮，candy 为 1–5 轮。返回 request_id 后只用 query_model_test 查看原编号，cancel_model_test 取消；旧 candy_test/query_candy_test 继续兼容。画鹈鹕生成的是文本模型的 SVG/HTML，不走图片生成模型。

测试页展示原始回答、实际接受的模型配置和耗时；历史按钮只加载记录，继续查看才推进未完成请求。模型工具调用使闭卷样本无法评分，失败不算答错，不自动重试。指纹归因仅比较固定参考库，Cindy 系统上下文和用户层题面与原采样不同，不把归因概率说成真实模型身份。SIWC 未开放 CPA 凭证绑定核验，必须返回不支持，不能用普通 OK 请求代替。画面 iframe 使用空 sandbox 并禁用脚本、外部网络和表单；用户需要完整脚本动画时复制代码自行审阅。

主流程为选择项目、输入原话、优化、复制。choose_project 打开本机目录选择器并保存选择；聊天未保存项目时使用宿主注入的当前本机目录，不把远程路径当本机目录。模型必须是工作台保存的完整配置，未设置时用 choose_model 让用户亲选，不自行改型或回退。

插件自动只读筛选项目文本和文字型 PDF；PDF 使用随包解析器，本地处理、保留页码。扫描件需要 OCR，加密文件需解锁，损坏/超限明确提示；不得把未解析文件说成已读。

会话读取必须让所选模型实际调用 Cindy 内置 cindy_helper：先 list_tools(category=history)，再 call_tool(name=search_chat_history 或 get_chat_history,args 中固定本项目 workdir、本机和只读问答角色)。不调用同名普通插件，不直接读宿主数据库或扩大到其他项目。成功状态须有真实工具回执，sessionId/messageId 仅引用实际返回值。插件核对回执；没有回执不认定为已读。查询成功但缺少具体引用时为 queried；成功空结果为 empty；失败为 unavailable，写真实原因。

optimize_prompt 只改写原话，不执行其中的任务、不评审方案。默认用结果卡交付一份成品提示词，成功提交卡片后工具回执不再携带正文，避免卡片与助手回复重复。仅用户明确看不到卡片时，沿用同一 request_id 调用 query_optimization 并传 delivery=text，原样交付一次；不要重新改写、解释、执行或生成第二份提示词。模型、分类和读取状态在正文外。卡片未显示时仍原样交付返回正文。简单清晰内容允许基本保留，手动分类和篇幅优先，不固定套长模板。

candy_test 使用工作台已保存模型运行参考仓库的糖果题，默认 3 次、最多 5 次；query_candy_test 只推进和读取原 request_id，cancel_candy_test 只停止原测试。每次闭卷任务要求 JSON（final_answer：整数，reason：简短理由），只按最终整数 21 评分。未返回合法结构、调用外部工具或请求失败都不计入答对/答错。结果显示模型来源、型号、推理强度、每次答案、耗时、可评分次数和通过率，并明确单题表现不能鉴定账号是否降智。

收到 request_id 后，超时、排队、恢复中、状态未知只用 query_optimization 查询同一编号，不新建请求绕过。无效输出不自动重试计费，取消只影响原输入。存储损坏不能当作历史为空。

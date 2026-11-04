# 提示词优化器 1.2.0

主流程为选择项目、输入原话、优化、复制。choose_project 打开本机目录选择器并保存选择；聊天未保存项目时使用宿主注入的当前本机目录，不把远程路径当本机目录。模型必须是工作台保存的完整配置，未设置时用 choose_model 让用户亲选，不自行改型或回退。

插件自动只读筛选项目文本和文字型 PDF；PDF 使用随包解析器，本地处理、保留页码。扫描件需要 OCR，加密文件需解锁，损坏/超限明确提示；不得把未解析文件说成已读。

会话读取必须让所选模型实际调用 Cindy 内置 cindy_helper：先 list_tools(category=history)，再 call_tool(name=search_chat_history 或 get_chat_history,args 中固定本项目 workdir、本机和只读问答角色)。不调用同名普通插件，不直接读宿主数据库或扩大到其他项目。成功状态须有真实工具回执，sessionId/messageId 仅引用实际返回值。插件核对回执；没有回执不认定为已读。查询成功但缺少具体引用时为 queried；成功空结果为 empty；失败为 unavailable，写真实原因。

optimize_prompt 只改写原话，不执行其中的任务、不评审方案。只交付 optimized_prompt；模型、分类和读取状态在正文外。卡片未显示时仍原样交付返回正文。简单清晰内容允许基本保留，手动分类和篇幅优先，不固定套长模板。

收到 request_id 后，超时、排队、恢复中、状态未知只用 query_optimization 查询同一编号，不新建请求绕过。无效输出不自动重试计费，取消只影响原输入。存储损坏不能当作历史为空。

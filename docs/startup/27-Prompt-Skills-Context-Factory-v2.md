# Vizruna Harness Governance v2

| 项目 | 内容 |
| --- | --- |
| 文档编号 | RFC-004 |
| 日期 | 2026-09-01 |
| 状态 | Implemented；验证中，尚未发布 |
| 适用范围 | Local Web、Desktop 兼容宿主、Headless Runtime |

## 1. 目标

本轮不更换 Pi Agent 内核，也不复制 DeepSeek Harness 的完整插件系统。升级聚焦四个直接服务
Vizruna 使命的能力：让提示词可解释、Skill 真正按需、长上下文可治理、Agent 构建可复测。

## 2. Prompt Contract v2

- Pi 核心提示词作为一个上游区段保留，不在 Vizruna 内复制维护。
- Vizruna 对工具、追加提示词、Agent 配置、项目上下文、Skill 路由和工作目录声明明确所有者、
  生效条件、顺序、稳定性与来源。
- 每次运行记录最终提示词摘要、实际工具摘要和组合请求摘要；默认不复制完整敏感提示词到证据包。
- Pi Inspector 展示契约版本、请求短摘要与各区段稳定性；完整提示词继续按点击懒加载。

## 3. Skill Runtime v2

- 通用会话的完整 Skill 目录不进入 System Prompt。
- `skill_search` 只返回紧凑元数据，不暴露本机文件路径。
- `skill_load` 按精确名称重新读取当前磁盘上的完整 `SKILL.md`，附带资源基准目录和内容摘要。
- 保留 Pi 原生 `/skill:name`；固定 Agent 仍使用冻结后的 Pi Skill 清单，确保可复现。
- 记录目录摘要、冲突诊断、搜索次数、加载次数和实际加载名称。

## 4. Context Governor

- 超过 48,000 字符的纯文本工具结果写入本机私有目录，文件权限为仅当前用户可读写。
- 模型上下文只保留头部、尾部、完整文件引用和 SHA-256，不丢失可追溯性。
- `skill_load` 不截断，避免破坏 Skill 指令完整性；图片结果保持 Pi 原生处理。
- 不改写 Pi 原生压缩算法；只为压缩开始、完成、失败或中止增加事务 ID 和持久日志。

## 5. Agent Factory Loop

- 新增 `run_agent_factory_loop`，仅用于 Agent 构建、评测和 Harness 改良。
- 最多 8 轮；每轮使用新的 Pi 子会话，但顺序共享同一本地工作区作为长期记忆。
- 模型只提交 `continue | complete | blocked` 结构化报告；循环、轮次、超时和停止由代码控制。
- 没有真实验证证据时，即使模型报告 complete，也会进入独立验证轮，不能直接完成。
- 不引入第二套 Agent Runtime、工作流脚本 VM 或外部子代理框架。

## 6. 安全与兼容边界

- 上下文落盘只发生在本机 Agent 配置目录，不上传、不遥测。
- 既有会话和 Agent 配置字段保持向后兼容；新增证据字段全部为可选。
- 固定 Agent 的资源过滤始终保留 Vizruna 内置治理扩展，但不会放宽用户选择的第三方扩展。
- 当前版本完成自动化验证和手动真实模型回归前不提交、不发布。

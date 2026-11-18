# 验证记录

环境：DSH 0.2.2-rc.3，Desktop / Electron 44.7.0，2026-11-17。

## 已通过

- `npm test`：25 项测试通过，覆盖未过滤目录、真实账户路由、部分失败、目录超时/取消、只读 RPC 与原路由/图片读取边界。
- `npm run check`：5 个运行时 JavaScript 模块语法通过。
- `ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" test/runtime-smoke.mjs`：使用当前安装版本真实 Schemastery、Cordis、ToolsService，验证配置范围、白名单精确匹配、按步骤注入 schema/执行准入、非匹配及步骤外不可执行；测试上下文已清理，不修改用户配置。
- 本地 bundle 安装返回 `application: applied`、无运行时 warnings。
- Live Inspect：Host 配置条目 `include:vision-router` 可用，4 个字段均为 volatile，空配置有默认值。
- Live Inspect：Client `settings.section` 的 `vision-router` 和 `plugins.bundle.config` 的 `@lichen/dsh-vision-router` 均 active。
- 默认白名单为空，当前 Agent 工具目录没有 `vision_read`。
- 原创 SVG 图标、中英 metadata 与运行时模块已列入包导出和 files；不提供可选装饰性详情大图，以保持轻量。

## 体验代码复核

入口：独立设置分区，插件详情内也可编辑。空列表状态、精确模型 ID 提示、出错兜底顺序与图片发送目的地均有说明。视觉列表支持添加/删除/上下调整。保存采用单次原子 mutate 与 revision fence，失败保留草稿，支持放弃修改读取最新值。含 loading、只读、不可用、未保存、成功/失败反馈；使用 DSH 主题 token，中英文文案、输入标签与按钮 focus-visible。

0.1.1 独立 UI/UX 代码审查已完成。根据意见，为已选列表增加 260px 限高滚动，避免 100 项白名单挤走搜索及视觉配置。两区独立搜索/提供商筛选/只看已选，候选目录限高、保存栏 sticky；目录刷新与部分失败不会清空草稿、既有模型或兜底顺序。实际视觉未验证。

0.1.1 重新安装尝试被管理器以 `already-installed` 拒绝。未卸载插件、未修改用户已有配置；本地链接已更新代码，但新增 Host 目录接口须重启 DSH 后加载，尚未确认当前进程新接口已生效。

## 0.1.2 目录加载修复

- 根因：0.1.1 错误注册 `/api` 单例 RPC interceptor，与 DSH Gateway 冲突。
- 已改为 `connection.fetch.register` 精确路由 `/api/vision-router/catalog`，保留标准 ClientRequest/ServerResponse、rpcId、JSON/输入校验与 no-store；沿用连接层认证及 owner 限制，不改前端调用、不覆盖系统 Gateway。
- 25 项单元测试及语法检查通过。真实 DSH HostConnectionService 回归测试先注册 Gateway 拦截器并复现第二次 interceptor 注册必然失败，再注册修复后的精确路由：模型目录返回 200、实际模型数据和原 rpcId，Gateway ping 仍正常返回；隔离上下文已清理。
- 未卸载插件、未改用户配置。当前进程是否热加载未确认，建议重启 DSH 后重新打开设置并刷新目录。

## 0.2.0 设置页重构：添加式选模型 + 实时生效

- 按需求重做设置页：不再展示整页模型目录，而是点击「＋ 添加」弹出模糊搜索面板（支持名称 / 模型 ID / 提供商多词、子序列如 `gpt41`→`gpt-4.1`，不截断候选），点选即加入列表；两个列表各自维护，↑/↓ 排序、× 移除。
- 所有更改实时生效：新增 `ui-state.js` 自动写入状态机（微任务合批、单写队列、首编辑 revision fence、成功推进 revision、失败/冲突保留草稿并明确恢复动作），移除底部保存栏、放弃修改、脏状态提示等控件与文案。
- 参数（超时、输出上限）输入合法值即写入，非法值仅标记不提交。
- `npm run build` 将 `ui-state.js` 内联合成 `client.js`；`npm run check` 校验 7 个模块语法并确认产物与源一致，防止手改产物漂移。
- 新增 `test/bundle.test.js`：在 vm 域用最小 React 渲染真实构建产物，验证无保存/确认按钮、添加流、模糊排序、自动写入的操作内容与 revision、排序/移除即时提交、越界输入不提交、目录失败在面板内提示且不写设置。
- 修复过程中发现并消除一个真实隐患：目录加载在发布 loading 状态前未先占用去重槽位，同步重入可能重复发起请求；现先占位后发布。
- 0.1.2 的模型目录 Fetch 路由与 Host 端未改动；`runtime-smoke` 继续通过。

## 0.2.0 UI/UX 代码审查与整改

- 由独立 UI/UX 审查（纯代码审查，未运行浏览器）确认：添加式选模型主流程、控件精简、实时生效反馈、边界（空列表/上限/目录失败/只读）、可访问性与主题 token 使用均成立，无 P1。
- 按审查意见整改：
  - P2 空搜索词按 Enter 不再静默添加目录第一项（须有关键词）。
  - P2 添加面板每次打开强制刷新目录（加载中保留旧数据）；`connection/reset` 无条件标记缓存过期并在页面打开时重载，新增连接可被搜到。
  - P2 点选后面板保持打开，支持连续添加；已添加项自动从候选排除。
  - P3 删除 `BundleConfig` 死分支（宿主仅以 `view:'page'` 渲染，直接复用 Page）；移除条目后焦点回到「添加」按钮；上限提示带数值、标题计数显示 `n / max`；「暂不可用」并入行文本（原 `!` 标记改为 aria-hidden）；数字输入改为失焦/回车提交，避免逐键写盘；两个面板互斥；Esc 先清空搜索词再关面板；error 状态新增「放弃修改并重新载入」。
- 集成测试扩至覆盖以上行为（空 Enter、Esc 两段式、互斥、面板常开连续添加、逐键不写盘、打开强制刷新、reset 重载）；44 项测试与 `npm run check`、安装版 runtime-smoke 均通过。
- 实际视觉与浏览器交互仍受自动化认证限制未验证。

## 0.3.0 图片准入放行

- 需求：白名单中的非多模态模型跳过 DSH 消息准入层的图片检查（参考 dsh-scoped-models 会话「新增模型视觉能力开关」的第一层）。
- 核实调用图后选定包装点：公共 `llm.resolveModelInfo` 仅被准入类检查使用（会话提示准入 commands.ts:352、ACP、子代理、内置图片工具）；派发/预检路径经 `adapter.prepareCall` 与内部 `resolveModelInfoFor` 自行解析，不经过该公共方法。
- 实现 `admission.js`：仅对白名单内、声明为纯文本（`inputModalities` 定义且不含 `image`）的模型在准入视图中补 `image`；未声明或原生支持的模型不受影响（与 dsh-scoped-models 单向纠错语义一致）。包装可安全 dispose：被后续包装链覆盖时退化为直通，不破坏他人链条。
- 效果：图片进入会话后，请求层仍按 DSH 原生投影替换为 `[image omitted …; attachment sha256:xxxxxxxx]` 占位符；`vision_read` 工具说明已引导模型对占位符调用工具，`image.js` 支持无歧义的 8 位前缀解析（占位符只暴露 8 位）。
- 验证：新增 `test/admission.test.js`（白名单定向放宽、不改写适配器结果、链式 dispose、原型方法还原）；`test/image.test.js` 增加前缀唯一/歧义/未命中共 6 断言组；`runtime-smoke` 增加真实 `LlmRuntime` 回归——注册桩适配器后，公共 `resolveModelInfo` 视图被放宽、`prepareCall` 返回的声明 `inputModalities` 仍为 `['text']`、dispose 后还原。共 50 项测试通过，`npm run check`（8 个模块）通过。
- 已知边界：内置 `read_image` 等以当前模型为视觉引擎的工具在白名单模型上同样放行准入，但其图片结果对纯文本模型仍是占位符；实际识别依赖 `vision_read`。pi-ai 家族的适配器内部发送检查不受影响（图片在派发前已被投影为文本）。
- 浏览器实际粘贴发送行为未验证（GUI 认证限制），需重启 DSH 后由用户粘贴图片到白名单模型确认。

## 0.3.1 按步骤优先使用视觉路由

- 需求：仅「非视觉模型」名单内的模型屏蔽原生 `read_image`，并明确要求直接使用 `vision_read`；名单外、模型切换与子代理独立处理。
- 核对真实调用顺序：DSH 先 `tools.resolve` 再组装系统提示，最后才触发 `agent/pre-step`。`tools.restrict` 无法屏蔽同一 agent 作用域内的预设工具，影子注册也可能同名冲突，因此选择窄包装公共 `tools.resolve`。
- 新增 `step-policy.js`：仅在本插件定义的 `vision_read` 已获准入时，包装该步骤的 `ResolvedToolSet.view`，每次保留底层最新视图并只删除 `read_image`，不修改全局注册。声明和执行共同遵循该集合；按实际定义 identity 匹配，避免误处理其他插件的同名工具。
- 路由指令通过唯一命名的 `systemPrompt.section` 注册，以同一步骤工具准入为条件；强化工具描述为直接入口，支持路径和占位符 `sha256` 引用，无需先加载。完整替换系统提示的第三方预设可能忽略附加 section，但不影响工具集合屏蔽。
- 单元测试 60 项与 `npm run check` 通过；新增 10 项步骤策略回归，覆盖不修改原集合、作用域隔离、定义失效、卸载与后续包装链、原型还原、进行中解析及取消/错误传播。真实 Cordis 方法读取会返回新的追踪代理，恢复逻辑比较原始属性 descriptor 而非方法读取 identity，已加入专门回归。
- 当前安装版 Electron / DSH 的 `runtime-smoke` 全部通过：真实 Cordis 插件挂载、追踪服务接收者、系统提示组装、预设本地工具、独立/子作用域与模型切换；原生执行器强行调用被隐藏的工具返回 `UNKNOWN_TOOL`，工具体执行次数为 0，名单外仍正常执行。还验证了同名替换的 identity 隔离、已有工具限制、完整提示边界和卸载属性恢复/步骤失效。保留的目录 Gateway 共存与 LLM 准入回归也通过。
- `npm pack --dry-run --ignore-scripts` 确认新模块列入发布文件。
- 已安装源为当前工作目录的本地 link；管理器重新安装返回 `already-installed`、`changed: false`、`application: failed`。未卸载重装、未更改用户配置，需重启 DSH 加载新版 Host 代码；未声称当前 GUI 已热更新。
- 独立工具流 UX / 代码复核完成，未发现新的确切 bug：直接入口明确、名单外不误影响、兜底为空时在文件读取和供应商请求前返回中文配置提示；完整系统提示边界已注明。无真实模型或 GUI 操作证据。
- 本次只调整 Host 工具流，没有修改设置页面或客户端产物，没有发送用户图片或发起付费模型请求。

## 未验证

- 自动化浏览器访问现有 GUI URL 返回 authentication required。未搜索或提取认证 token，也未替换服务器。浏览器会话已由 idle timeout 自动关闭。
- 因此设置页面的实际渲染、图标解码/明暗主题对照、浏览器 console、真实保存交互未能完成视觉或浏览器验证。Slot 注册成功不代表这些已验证。
- 未擅自选择或修改用户模型、未发送用户图片、未发起付费模型端到端调用。实际识别应在用户配置视觉模型后测试。
- 本地 link 安装报告 peer dependency 解析提醒；当前 Host 已成功激活并读取 schema，真实运行时 smoke 也通过。

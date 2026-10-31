/**
 * dsh-remote-automation —— 浏览器端。
 *
 * 在侧栏注册「云端任务」菜单项（sidebar.panellist），主区页面走 main 槽位。
 * 页面内含：服务商卡片（编辑凭证，已保存密钥留空沿用）、执行位置切换、
 * 任务状态列表、配置指南弹窗。
 */
window.__ModuleLoader__.load({
	id: "dsh-remote-automation",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

		const react = require("react")
		const reactDom = require("react-dom")
		const h = react.createElement

		const API_BASE = "/dsh-remote-automation"
		const TOKEN = (window.__DSH_REMOTE_AUTOMATION__ || {}).token || ""
		const TOKEN_MISSING = !TOKEN

		const POLICY_JSON = `{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunCommand",
        "ecs:DescribeInvocationResults",
        "ecs:DescribeCloudAssistantStatus",
        "ecs:DescribeInstances",
        "ecs:InstallCloudAssistant"
      ],
      "Resource": "*"
    }
  ]
}`

		// ---- styles -----------------------------------------------------
		const CSS = `
.dsh-ra-page { box-sizing: border-box; height: 100%; overflow: auto; padding: 22px 26px 56px; color: var(--dsw-alias-label-primary, inherit); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.dsh-ra-page * { box-sizing: border-box; }
.dsh-ra-page-head { display: flex; align-items: center; gap: 12px; }
.dsh-ra-page-head h1 { margin: 0; font-size: 18px; font-weight: 650; }
.dsh-ra-page-head .right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.dsh-ra-sub { margin: 4px 0 16px; font-size: 12px; opacity: .6; }
.dsh-ra-btn { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); background: transparent; color: inherit; border-radius: 8px; padding: 4px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.dsh-ra-btn:hover { border-color: rgba(10,132,255,.55); }
.dsh-ra-btn:disabled { opacity: .5; cursor: default; }
.dsh-ra-btn.danger:hover { border-color: rgba(255,59,48,.6); color: #d70015; }
.dsh-ra-provider { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 11px; }
.dsh-ra-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #8e8e93; }
.dsh-ra-dot.on { background: #34c759; }
.dsh-ra-provider-name { font-weight: 600; font-size: 12.5px; }
.dsh-ra-provider-state { font-size: 11.5px; opacity: .6; word-break: break-all; }
.dsh-ra-provider .dsh-ra-btn { margin-left: auto; }
.dsh-ra-setup { margin-top: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 11px; }
.dsh-ra-setup label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; opacity: .75; }
.dsh-ra-setup input { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 7px; background: transparent; color: inherit; padding: 6px 9px; font: inherit; }
.dsh-ra-setup input::placeholder { opacity: .55; }
.dsh-ra-setup .wide { grid-column: 1 / -1; }
.dsh-ra-q { border: 0; background: transparent; color: inherit; opacity: .5; cursor: pointer; font-size: 11px; margin-left: 5px; padding: 0 2px; }
.dsh-ra-q:hover { opacity: 1; }
.dsh-ra-form-actions { display: flex; gap: 8px; align-items: center; }
.dsh-ra-help { border: 0; background: transparent; color: inherit; opacity: .65; cursor: pointer; font: inherit; font-size: 12px; padding: 2px 4px; }
.dsh-ra-help:hover { opacity: 1; }
.dsh-ra-error { margin-top: 10px; padding: 9px 12px; border-radius: 9px; background: rgba(255,59,48,.12); color: #d70015; font-size: 12px; white-space: pre-wrap; }
.dsh-ra-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.dsh-ra-item { padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2)); border-radius: 11px; }
.dsh-ra-item-top { display: flex; align-items: center; gap: 8px; }
.dsh-ra-name { font-weight: 600; word-break: break-all; }
.dsh-ra-badge { margin-left: auto; padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(127,127,127,.14); white-space: nowrap; }
.dsh-ra-badge.running { background: rgba(10,132,255,.15); color: #0a84ff; }
.dsh-ra-badge.success { background: rgba(52,199,89,.15); color: #248a3d; }
.dsh-ra-badge.failed { background: rgba(255,59,48,.15); color: #d70015; }
.dsh-ra-meta { margin-top: 3px; font-size: 11.5px; opacity: .6; word-break: break-all; }
.dsh-ra-actions { display: flex; gap: 6px; margin-top: 8px; }
.dsh-ra-actions .dsh-ra-btn { padding: 2px 9px; }
.dsh-ra-log { margin-top: 9px; padding: 8px 10px; max-height: 220px; overflow: auto; border-radius: 8px; background: rgba(127,127,127,.1); font: 11.5px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.dsh-ra-empty { margin-top: 14px; padding: 40px 16px; text-align: center; opacity: .55; border: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 12px; }
.dsh-ra-mask { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.45); }
.dsh-ra-modal { width: min(880px, 100%); max-height: 84vh; overflow: auto; padding: 22px 24px 20px; border-radius: 16px; background: var(--dsw-specific-menu, #fff); color: inherit; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); box-shadow: 0 24px 64px rgba(0,0,0,.35); }
.dsh-ra-modal h2 { margin: 0; font-size: 17px; font-weight: 650; }
.dsh-ra-modal-sub { margin: 4px 0 16px; font-size: 12px; opacity: .6; }
.dsh-ra-close { position: sticky; top: 0; float: right; border: 0; background: transparent; color: inherit; font-size: 20px; cursor: pointer; opacity: .6; }
.dsh-ra-cols { display: grid; grid-template-columns: 1.05fr 1fr; gap: 22px; }
.dsh-ra-cols h3 { font-size: 13px; margin: 0 0 8px; }
.dsh-ra-cols ol { margin: 0 0 14px; padding-left: 18px; font-size: 12.5px; line-height: 1.85; }
.dsh-ra-cols li { margin-bottom: 3px; }
.dsh-ra-policy { margin: 6px 0 10px; padding: 10px 12px; border-radius: 9px; background: rgba(127,127,127,.1); font: 11.5px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.dsh-ra-note { margin-top: 10px; font-size: 12px; line-height: 1.7; opacity: .75; }
.dsh-ra-icon { display: inline-flex; align-items: center; justify-content: center; }
@media (max-width: 760px) { .dsh-ra-cols { grid-template-columns: 1fr; } .dsh-ra-setup { grid-template-columns: 1fr; } }
`
		const STYLE_ID = "dsh-remote-automation/page.css"
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
			const tag = document.createElement("style")
			tag.dataset.plugin = "dsh-remote-automation"
			tag.dataset.pluginCss = STYLE_ID
			tag.textContent = CSS
			document.head.appendChild(tag)
		}

		// ---- api --------------------------------------------------------
		function api(path, options) {
			if (TOKEN_MISSING) {
				return Promise.reject(new Error("页面令牌缺失：请完全退出 DSH 后重新启动。"))
			}
			options = options || {}
			const headers = { "x-dsh-ra-token": TOKEN }
			const init = { method: options.method || "GET", headers, credentials: "same-origin" }
			if (options.body !== undefined) {
				headers["content-type"] = "application/json"
				init.body = JSON.stringify(options.body)
			}
			return fetch(API_BASE + path, init).then((response) =>
				response.text().then((text) => {
					let data
					try {
						data = text ? JSON.parse(text) : {}
					} catch {
						throw new Error("接口返回异常（HTTP " + response.status + "）")
					}
					if (!response.ok) throw new Error(data.error || "HTTP " + response.status)
					return data
				}),
			)
		}

		// ---- small pieces ----------------------------------------------
		function Icon() {
			return h(
				"span",
				{ className: "dsh-ra-icon" },
				h(
					"svg",
					{ width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
					h("path", {
						d: "M8 1.8a4.6 4.6 0 0 0-4.6 4.6c0 1.3.5 2.2 1.2 3 .4.5.6.9.7 1.4h5.4c.1-.5.3-.9.7-1.4.7-.8 1.2-1.7 1.2-3A4.6 4.6 0 0 0 8 1.8Z",
						stroke: "currentColor",
						"strokeWidth": 1.2,
					}),
					h("path", { d: "M6.4 12.7h3.2", stroke: "currentColor", "strokeWidth": 1.2, "strokeLinecap": "round" }),
					h("path", { d: "M7.4 10.4 8 8.6l.6 1.8", stroke: "currentColor", "strokeWidth": 1.2, "strokeLinejoin": "round" }),
				),
			)
		}

		function Badge({ status }) {
			if (!status) return h("span", { className: "dsh-ra-badge" }, "未知")
			if (status.state === "running") return h("span", { className: "dsh-ra-badge running" }, "运行中")
			if (status.state === "success") return h("span", { className: "dsh-ra-badge success" }, "成功")
			if (status.state === "failed") return h("span", { className: "dsh-ra-badge failed" }, "失败")
			return h("span", { className: "dsh-ra-badge" }, "空闲")
		}

		// ---- guide modal ------------------------------------------------
		function GuideModal({ onClose }) {
			const [copied, setCopied] = react.useState(false)
			const copy = () => {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(POLICY_JSON)
					setCopied(true)
					setTimeout(() => setCopied(false), 1500)
				}
			}
			return reactDom.createPortal(
				h(
					"div",
					{
						className: "dsh-ra-mask",
						onClick: (event) => {
							if (event.target === event.currentTarget) onClose()
						},
					},
					h(
						"div",
						{ className: "dsh-ra-modal", role: "dialog", "aria-modal": "true", "aria-label": "配置指南" },
						h("button", { className: "dsh-ra-close", onClick: onClose, "aria-label": "关闭" }, "×"),
						h("h2", null, "配置指南"),
						h("p", { className: "dsh-ra-modal-sub" }, "一次性配置，保存后表单自动收起。全程不需要开放安全组。"),
						h(
							"div",
							{ className: "dsh-ra-cols" },
							h(
								"div",
								null,
								h("h3", null, "1. 创建 RAM 子账号"),
								h(
									"ol",
									null,
									"RAM 控制台 → 身份管理 → 用户 → 创建用户",
									"访问方式只勾「OpenAPI 调用访问」，登录名随意",
									"创建后保存 AccessKey ID / Secret（Secret 只显示一次）",
									"安全手机、邮箱可以留空",
								),
								h("h3", null, "2. 建自定义策略"),
								h(
									"ol",
									null,
									"权限管理 → 权限策略 → 创建权限策略",
									"选「脚本编辑」，粘贴右侧 JSON",
									"名称填 dsh-ecs-remote，确定",
								),
								h("h3", null, "3. 授权给这个用户"),
								h(
									"ol",
									null,
									"用户列表点刚建的用户",
									"权限管理 → 新增授权 → 自定义策略",
									"勾选 dsh-ecs-remote，确定",
								),
							),
							h(
								"div",
								null,
								h("h3", null, "最小权限策略"),
								h("pre", { className: "dsh-ra-policy" }, POLICY_JSON),
								h("button", { className: "dsh-ra-btn", onClick: copy }, copied ? "已复制" : "复制策略"),
								h(
									"div",
									{ className: "dsh-ra-note" },
									h("b", null, "只允许"),
									"：查实例、查云助手状态、装云助手、下发命令、查命令结果。",
									h("br"),
									h("b", null, "做不了"),
									"：删机、改安全组、动磁盘、改网络。",
									h("br"),
									h("b", null, "注意"),
									"：region 和实例 ID 要填对；实例云助手需在线（公共镜像默认有）；安全组保持零入站即可。",
								),
							),
						),
					),
				),
				document.body,
			)
		}

		// ---- page -------------------------------------------------------
		function Page() {
			const [state, setState] = react.useState({
				loading: true,
				configured: true,
				config: null,
				tasks: [],
				error: TOKEN_MISSING ? "页面令牌缺失：请完全退出 DSH 后重新启动。" : "",
				editing: false,
				helpOpen: false,
				logs: {},
				busy: {},
				setup: { accessKeyId: "", accessKeySecret: "", region: "", instanceId: "", serverDir: "/opt/automation" },
			})

			const load = react.useCallback(() => {
				if (TOKEN_MISSING) {
					setState((prev) => ({ ...prev, loading: false }))
					return
				}
				api("/state")
					.then((data) => {
						setState((prev) => {
							const cfg = data.config || {}
							const tasks = Array.isArray(data.tasks) ? data.tasks : []
							const alive = new Set(tasks.map((task) => task.id))
							const logs = {}
							for (const [id, value] of Object.entries(prev.logs)) {
								if (alive.has(id)) logs[id] = value
							}
							const editing = data.configured === false ? true : prev.editing
							return {
								...prev,
								loading: false,
								configured: data.configured !== false,
								config: cfg,
								tasks,
								error: data.error || "",
								editing,
								logs,
								setup: {
									...prev.setup,
									region: editing ? prev.setup.region : prev.setup.region || cfg.region || "",
									instanceId: editing ? prev.setup.instanceId : prev.setup.instanceId || cfg.instanceId || "",
									serverDir: editing ? prev.setup.serverDir : cfg.serverDir || prev.setup.serverDir,
								},
							}
						})
					})
					.catch((error) => {
						setState((prev) => ({ ...prev, loading: false, error: error.message }))
					})
			}, [])

			react.useEffect(() => {
				load()
				const timer = setInterval(() => {
					if (document.visibilityState !== "hidden") load()
				}, 15000)
				return () => clearInterval(timer)
			}, [load])

			const patch = (values) => setState((prev) => ({ ...prev, ...values }))

			const runTask = (id) => {
				setState((prev) => ({ ...prev, busy: { ...prev.busy, [id]: true } }))
				api("/tasks/" + encodeURIComponent(id) + "/run", { method: "POST" })
					.then(() => setTimeout(load, 1200))
					.catch((error) => patch({ error: error.message }))
					.finally(() =>
						setState((prev) => {
							const busy = { ...prev.busy }
							delete busy[id]
							return { ...prev, busy }
						}),
					)
			}

			const deleteTask = (id) => {
				if (!window.confirm("确定删除这个云端任务？脚本、cron 和日志都会清理。")) return
				api("/tasks/" + encodeURIComponent(id) + "/delete", { method: "POST" })
					.then(() => {
						setState((prev) => {
							const logs = { ...prev.logs }
							delete logs[id]
							return { ...prev, logs }
						})
						return load()
					})
					.catch((error) => patch({ error: error.message }))
			}

			const toggleLogs = (id) => {
				if (state.logs[id] !== undefined) {
					const next = { ...state.logs }
					delete next[id]
					patch({ logs: next })
					return
				}
				api("/tasks/" + encodeURIComponent(id) + "/logs?lines=200")
					.then((data) => patch({ logs: { ...state.logs, [id]: data.log || "(暂无日志)" } }))
					.catch((error) => patch({ error: error.message }))
			}

			const saveConfig = () => {
				const body = {}
				for (const key of ["accessKeyId", "accessKeySecret", "region", "instanceId", "serverDir"]) {
					const value = (state.setup[key] || "").trim()
					if (value) body[key] = value
				}
				api("/config", { method: "POST", body })
					.then((data) => {
						setState((prev) => ({
							...prev,
							configured: data.configured,
							config: data,
							editing: false,
							error: data.configured ? "" : "还缺：" + (data.missing || []).join(", "),
							setup: { ...prev.setup, accessKeyId: "", accessKeySecret: "" },
						}))
						load()
					})
					.catch((error) => patch({ error: error.message }))
			}

			const updateSetup = (key) => (event) => {
				setState((prev) => ({ ...prev, setup: { ...prev.setup, [key]: event.target.value } }))
			}

			const maskedId = state.config && state.config.accessKeyIdMasked
			const providerState = state.configured
				? [state.config && state.config.region, state.config && state.config.instanceId].filter(Boolean).join(" · ")
				: "未配置"

			const rows = state.tasks.map((task) => {
				const meta = [task.schedule ? "cron " + task.schedule : "手动触发"]
				if (task.status && task.status.lastExit !== null && task.status.lastExit !== undefined) {
					meta.push("上次 exit " + task.status.lastExit)
				}
				if (task.status && task.status.lastLogTime) meta.push(task.status.lastLogTime)
				const log = state.logs[task.id]
				return h(
					"div",
					{ className: "dsh-ra-item", key: task.id },
					h(
						"div",
						{ className: "dsh-ra-item-top" },
						h("span", { className: "dsh-ra-name" }, task.name),
						h(Badge, { status: task.status }),
					),
					h("div", { className: "dsh-ra-meta" }, meta.join(" · ")),
					h(
						"div",
						{ className: "dsh-ra-actions" },
						h("button", { className: "dsh-ra-btn", disabled: state.busy[task.id], onClick: () => runTask(task.id) }, state.busy[task.id] ? "启动中" : "运行"),
						h("button", { className: "dsh-ra-btn", onClick: () => toggleLogs(task.id) }, log !== undefined ? "收起日志" : "日志"),
						h("button", { className: "dsh-ra-btn danger", onClick: () => deleteTask(task.id) }, "删除"),
					),
					log !== undefined ? h("pre", { className: "dsh-ra-log" }, log) : null,
				)
			})

			const setupForm = state.editing
				? h(
						"div",
						{ className: "dsh-ra-setup" },
						h(
							"label",
							{ className: "wide" },
							"AccessKey ID",
							h("input", {
								placeholder: maskedId ? "留空使用已保存凭据（" + maskedId + "）" : "LTAI...",
								value: state.setup.accessKeyId,
								onChange: updateSetup("accessKeyId"),
							}),
						),
						h(
							"label",
							{ className: "wide" },
							"AccessKey Secret ",
							h("button", { className: "dsh-ra-q", onClick: () => patch({ helpOpen: true }), title: "怎么获取 AccessKey" }, "?"),
							h("input", {
								type: "password",
								placeholder: state.configured ? "留空使用已保存凭据" : "必填",
								value: state.setup.accessKeySecret,
								onChange: updateSetup("accessKeySecret"),
							}),
						),
						h(
							"label",
							null,
							"地域 region",
							h("input", { placeholder: "cn-shenzhen", value: state.setup.region, onChange: updateSetup("region") }),
						),
						h(
							"label",
							null,
							"实例 ID",
							h("input", { placeholder: "i-xxxxxxxx", value: state.setup.instanceId, onChange: updateSetup("instanceId") }),
						),
						h(
							"label",
							{ className: "wide" },
							"脚本目录",
							h("input", { value: state.setup.serverDir, onChange: updateSetup("serverDir") }),
						),
						h(
							"div",
							{ className: "wide dsh-ra-form-actions" },
							h("button", { className: "dsh-ra-btn", onClick: saveConfig }, "保存"),
						),
					)
				: null

			return h(
				"div",
				{ className: "dsh-ra-page" },
				h(
					"div",
					{ className: "dsh-ra-page-head" },
					h("h1", null, "云端任务"),
					h(
						"div",
						{ className: "right" },
						h("button", { className: "dsh-ra-help", onClick: () => patch({ helpOpen: true }) }, "配置指南"),
						h("button", { className: "dsh-ra-btn", onClick: load }, state.loading ? "刷新中…" : "刷新"),
					),
				),
				h("p", { className: "dsh-ra-sub" }, "任务运行在远程服务器上，与本机是否开机无关；安全组零入站。"),
				h(
					"div",
					{ className: "dsh-ra-provider" },
					h("span", { className: "dsh-ra-dot " + (state.configured ? "on" : "off") }),
					h("span", { className: "dsh-ra-provider-name" }, "阿里云 ECS"),
					h("span", { className: "dsh-ra-provider-state" }, providerState),
					h("button", { className: "dsh-ra-btn", onClick: () => patch({ editing: !state.editing }) }, state.editing ? "取消" : "编辑"),
				),
				state.error ? h("div", { className: "dsh-ra-error" }, state.error) : null,
				setupForm,
				state.configured
					? state.loading && state.tasks.length === 0
						? h("div", { className: "dsh-ra-empty" }, "正在查询云端任务…")
						: state.tasks.length === 0
							? h("div", { className: "dsh-ra-empty" }, "还没有云端任务。在对话里让我创建，创建时会先问你跑云端还是本地。")
							: h("div", { className: "dsh-ra-list" }, rows)
					: null,
				state.helpOpen ? h(GuideModal, { onClose: () => patch({ helpOpen: false }) }) : null,
			)
		}

		// ---- apply ------------------------------------------------------
		function apply(ctx) {
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{ name: "sidebar.panellist", id: "remote-automation", order: 11, label: () => "云端任务" },
					Icon,
				),
			)
			ctx.slots.inject("main", () =>
				ctx.slots.register({ name: "main", key: "remote-automation" }, Page),
			)
		}

		exports.apply = apply
		exports.inject = ["slots"]
		return module.exports
	},
})

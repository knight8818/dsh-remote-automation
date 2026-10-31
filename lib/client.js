/**
 * dsh-remote-automation —— 浏览器端。
 *
 * 在侧栏注册「云端任务」菜单项（sidebar.panellist），主区页面走 main 槽位。
 * 页面内含：云厂商选择与凭证卡片（已保存密钥留空沿用）、任务状态列表、配置指南弹窗。
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

		const PROVIDERS = {
			aliyun: {
				label: "阿里云 ECS",
				fields: [
					{ key: "accessKeyId", label: "AccessKey ID", placeholder: "LTAI...", secret: false, wide: true },
					{ key: "accessKeySecret", label: "AccessKey Secret", secret: true, wide: true },
					{ key: "region", label: "地域 region", placeholder: "cn-shenzhen" },
					{ key: "instanceId", label: "实例 ID", placeholder: "i-xxxxxxxxxxxxxxxx" },
				],
			},
			tencent: {
				label: "腾讯云 CVM",
				fields: [
					{ key: "secretId", label: "SecretId", placeholder: "AKID...", secret: false, wide: true },
					{ key: "secretKey", label: "SecretKey", secret: true, wide: true },
					{ key: "region", label: "地域 region", placeholder: "ap-guangzhou" },
					{ key: "instanceId", label: "实例 ID", placeholder: "ins-xxxxxxxx / lhins-xxxxxxxx" },
				],
			},
			aws: {
				label: "AWS EC2 (SSM)",
				fields: [
					{ key: "accessKeyId", label: "Access Key ID", placeholder: "AKIA...", secret: false, wide: true },
					{ key: "secretAccessKey", label: "Secret Access Key", secret: true, wide: true },
					{ key: "sessionToken", label: "Session Token（可选）", placeholder: "临时凭证才需要", secret: true, wide: true },
					{ key: "region", label: "地域 region", placeholder: "us-east-1" },
					{ key: "instanceId", label: "实例 ID", placeholder: "i-xxxxxxxxxxxxxxxx" },
				],
			},
		}

		const ALIYUN_POLICY = `{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunCommand",
        "ecs:DescribeInvocationResults",
        "ecs:DescribeCloudAssistantStatus",
        "ecs:DescribeInstances",
        "ecs:InstallCloudAssistant",
        "ecs:SendFile",
        "ecs:DescribeSendFileResults"
      ],
      "Resource": "*"
    }
  ]
}`

		const TENCENT_POLICY = `{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "tat:RunCommand",
        "tat:DescribeInvocationTasks",
        "tat:DescribeAutomationAgentStatus"
      ],
      "resource": ["*"]
    }
  ]
}`

		const AWS_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation",
        "ssm:DescribeInstanceInformation"
      ],
      "Resource": "*"
    }
  ]
}`

		const GUIDES = {
			aliyun: {
				label: "阿里云 ECS",
				steps: [
					["1. 创建 RAM 子账号", ["RAM 控制台 → 身份管理 → 用户 → 创建用户", "访问方式只勾「OpenAPI 调用访问」，登录名随意", "创建后保存 AccessKey ID / Secret（Secret 只显示一次）", "安全手机、邮箱可以留空"]],
					["2. 建自定义策略", ["权限管理 → 权限策略 → 创建权限策略", "选「脚本编辑」，粘贴右侧 JSON", "名称填 dsh-ecs-remote，确定"]],
					["3. 授权给这个用户", ["用户列表点刚建的用户", "权限管理 → 新增授权 → 自定义策略", "勾选 dsh-ecs-remote，确定"]],
				],
				policy: ALIYUN_POLICY,
				allow: "查实例、查云助手状态、装云助手、下发命令、下发文件、查命令/文件结果。",
				deny: "删机、改安全组、动磁盘、改网络。",
				note: "region 和实例 ID 要填对；实例云助手需在线（公共镜像默认有）；安全组保持零入站即可。",
			},
			tencent: {
				label: "腾讯云 CVM",
				steps: [
					["1. 创建 CAM 子用户", ["访问管理 CAM 控制台 → 用户 → 用户列表 → 新建用户", "选「自定义创建」，访问方式勾「编程访问」", "保存 SecretId / SecretKey（SecretKey 只显示一次）"]],
					["2. 建自定义策略", ["策略 → 新建自定义策略 → 按策略语法创建", "粘贴右侧 JSON", "名称填 dsh-tat-remote，确定"]],
					["3. 授权给这个用户", ["用户列表点刚建的用户", "关联策略 → 自定义策略", "勾选 dsh-tat-remote，确定"]],
				],
				policy: TENCENT_POLICY,
				allow: "下发 TAT 命令、查询执行任务、查询自动化助手在线状态。",
				deny: "删机、改安全组、动磁盘、改网络。",
				note: "实例需安装并运行 TAT 自动化助手（公共镜像默认有）；region 和实例 ID 要填对；安全组保持零入站即可。",
			},
			aws: {
				label: "AWS EC2 (SSM)",
				steps: [
					["1. 创建 IAM 用户", ["IAM 控制台 → 用户 → 创建用户", "访问方式勾「编程访问」", "保存 Access Key ID / Secret Access Key（Secret 只显示一次）"]],
					["2. 建自定义策略", ["IAM → 策略 → 创建策略 → JSON", "粘贴右侧 JSON", "名称填 dsh-ssm-remote，创建"]],
					["3. 附加策略", ["用户列表点刚建的用户", "添加权限 → 直接附加策略", "勾选 dsh-ssm-remote"]],
				],
				policy: AWS_POLICY,
				allow: "下发 SSM 命令、查询执行结果、查询 SSM Agent 在线状态。",
				deny: "删机、改安全组、动磁盘、改网络。",
				note: "EC2 需安装并运行 SSM Agent，且实例角色允许 SSM；region 和实例 ID 要填对；安全组保持零入站即可。",
			},
		}

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
.dsh-ra-provider { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 11px; flex-wrap: wrap; }
.dsh-ra-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #8e8e93; }
.dsh-ra-dot.on { background: #34c759; }
.dsh-ra-provider-name { font-weight: 600; font-size: 12.5px; }
.dsh-ra-provider-state { font-size: 11.5px; opacity: .6; word-break: break-all; }
.dsh-ra-provider .dsh-ra-btn { margin-left: auto; }
.dsh-ra-select { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 8px; background: transparent; color: inherit; padding: 4px 8px; font: inherit; font-size: 12px; }
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
			if (status.state === "unconfigured") return h("span", { className: "dsh-ra-badge failed" }, "未配置")
			if (status.state === "error") return h("span", { className: "dsh-ra-badge failed" }, "查询失败")
			return h("span", { className: "dsh-ra-badge" }, "空闲")
		}

		// ---- guide modal ------------------------------------------------
		function GuideModal({ provider, onClose }) {
			const [copied, setCopied] = react.useState(false)
			const guide = GUIDES[provider] || GUIDES.aliyun
			const copy = () => {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard
						.writeText(guide.policy)
						.then(() => {
							setCopied(true)
							setTimeout(() => setCopied(false), 1500)
						})
						.catch(() => {
							// 浏览器拒绝写剪贴板时不要谎报「已复制」。
						})
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
						h("h2", null, guide.label + " · 配置指南"),
						h("p", { className: "dsh-ra-modal-sub" }, "一次性配置，保存后表单自动收起。全程不需要开放安全组。"),
						h(
							"div",
							{ className: "dsh-ra-cols" },
							h(
								"div",
								null,
								...guide.steps.map(([title, items]) =>
									h("div", { key: title }, h("h3", null, title), h("ol", null, ...items)),
								),
							),
							h(
								"div",
								null,
								h("h3", null, "最小权限策略"),
								h("pre", { className: "dsh-ra-policy" }, guide.policy),
								h("button", { className: "dsh-ra-btn", onClick: copy }, copied ? "已复制" : "复制策略"),
								h(
									"div",
									{ className: "dsh-ra-note" },
									h("b", null, "只允许"),
									"：",
									guide.allow,
									h("br"),
									h("b", null, "做不了"),
									"：",
									guide.deny,
									h("br"),
									h("b", null, "注意"),
									"：",
									guide.note,
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
				config: null,
				providers: {},
				provider: "aliyun",
				selected: "aliyun",
				tasks: [],
				error: TOKEN_MISSING ? "页面令牌缺失：请完全退出 DSH 后重新启动。" : "",
				editing: false,
				helpOpen: false,
				logs: {},
				busy: {},
				setup: { serverDir: "/opt/automation", values: {} },
			})

			const inFlight = react.useRef(false)
			const stopped = react.useRef(false)

			const load = react.useCallback(() => {
				if (TOKEN_MISSING || stopped.current) {
					setState((prev) => ({ ...prev, loading: false }))
					return
				}
				if (inFlight.current) return
				inFlight.current = true
				api("/state")
					.then((data) => {
						setState((prev) => {
							const cfg = data.config || {}
							const providers = cfg.providers || {}
							const tasks = Array.isArray(data.tasks) ? data.tasks : []
							const alive = new Set(tasks.map((task) => task.id))
							const logs = {}
							for (const [id, value] of Object.entries(prev.logs)) {
								if (alive.has(id)) logs[id] = value
							}
							let selected = prev.config === null ? cfg.provider || "aliyun" : prev.selected
							if (!PROVIDERS[selected] || !providers[selected]) selected = cfg.provider || "aliyun"
							const def = PROVIDERS[selected] || PROVIDERS.aliyun
							const pub = providers[selected] || {}
							const editing = prev.editing || !pub.configured
							const values = prev.editing ? prev.setup.values : {}
							if (!prev.editing) {
								for (const field of def.fields) {
									values[field.key] = field.secret ? "" : pub[field.key] || ""
								}
							}
							return {
								...prev,
								loading: false,
								config: cfg,
								providers,
								provider: cfg.provider || "aliyun",
								selected,
								tasks,
								error: data.error || "",
								editing,
								logs,
								setup: {
									serverDir: cfg.serverDir || prev.setup.serverDir,
									values,
								},
							}
						})
					})
					.catch((error) => {
						const message = String(error.message || "")
						if (/unauthorized|401/i.test(message)) {
							// 宿主进程重启后旧页面里的令牌就失效了，轮询只会一直 401。
							stopped.current = true
							setState((prev) => ({
								...prev,
								loading: false,
								error: "页面令牌已失效：请刷新页面（F5）重新加载。",
							}))
							return
						}
						setState((prev) => ({ ...prev, loading: false, error: message }))
					})
					.finally(() => {
						inFlight.current = false
					})
			}, [])

			react.useEffect(() => {
				load()
				const timer = setInterval(() => {
					if (!stopped.current && document.visibilityState !== "hidden") load()
				}, 15000)
				return () => clearInterval(timer)
			}, [load])

			const patch = (values) => setState((prev) => ({ ...prev, ...values }))

			const selectProvider = (id) => {
				const def = PROVIDERS[id]
				if (!def) return
				setState((prev) => {
					const pub = prev.providers[id] || {}
					const values = {}
					for (const field of def.fields) {
						values[field.key] = field.secret ? "" : pub[field.key] || ""
					}
					return {
						...prev,
						selected: id,
						editing: !pub.configured,
						error: "",
						helpOpen: false,
						setup: { serverDir: prev.setup.serverDir, values },
					}
				})
			}

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
				const def = PROVIDERS[state.selected] || PROVIDERS.aliyun
				const values = {}
				for (const field of def.fields) {
					const value = (state.setup.values[field.key] || "").trim()
					if (value) values[field.key] = value
				}
				const serverDir = (state.setup.serverDir || "").trim()
				api("/config", { method: "POST", body: { provider: state.selected, values, serverDir } })
					.then((data) => {
						setState((prev) => ({
							...prev,
							config: data,
							providers: data.providers || {},
							provider: data.provider || prev.provider,
							selected: data.provider || prev.selected,
							editing: false,
							error: "",
						}))
						load()
					})
					.catch((error) => patch({ error: error.message }))
			}

			const updateSetup = (key) => (event) => {
				setState((prev) => ({ ...prev, setup: { ...prev.setup, values: { ...prev.setup.values, [key]: event.target.value } } }))
			}

			const updateServerDir = (event) => {
				setState((prev) => ({ ...prev, setup: { ...prev.setup, serverDir: event.target.value } }))
			}

			const def = PROVIDERS[state.selected] || PROVIDERS.aliyun
			const pub = state.providers[state.selected] || {}
			const providerState = pub.configured
				? [pub.region, pub.instanceId].filter(Boolean).join(" · ")
				: "未配置"
			const maskedId = pub.maskedId || null

			const providerOptions = Object.keys(PROVIDERS).map((id) =>
				h("option", { value: id, key: id }, PROVIDERS[id].label),
			)

			const rows = state.tasks.map((task) => {
				const providerLabel = (PROVIDERS[task.provider] || {}).label || task.provider
				const meta = [providerLabel, task.schedule ? "cron " + task.schedule : "手动触发"]
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
						...def.fields.map((field) =>
							h(
								"label",
								{ key: field.key, className: field.wide ? "wide" : null },
								field.label,
								field.secret
									? h("button", { className: "dsh-ra-q", onClick: () => patch({ helpOpen: true }), title: "怎么获取密钥" }, "?")
									: null,
								h("input", {
									type: field.secret ? "password" : "text",
									placeholder: field.secret
										? maskedId
											? "留空使用已保存凭据（" + maskedId + "）"
											: "必填"
										: field.placeholder,
									value: state.setup.values[field.key] || "",
									onChange: updateSetup(field.key),
								}),
							),
						),
						h(
							"label",
							{ className: "wide" },
							"脚本目录",
							h("input", { value: state.setup.serverDir, onChange: updateServerDir }),
						),
						h(
							"div",
							{ className: "wide dsh-ra-form-actions" },
							h("button", { className: "dsh-ra-btn", onClick: saveConfig }, "保存并使用"),
							pub.configured
								? h("button", { className: "dsh-ra-btn", onClick: () => patch({ editing: false }) }, "取消")
								: null,
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
						h("button", {
							className: "dsh-ra-btn",
							onClick: () => {
								stopped.current = false
								inFlight.current = false
								load()
							},
						}, state.loading ? "刷新中…" : "刷新"),
					),
				),
				h("p", { className: "dsh-ra-sub" }, "任务运行在远程服务器上，与本机是否开机无关；阿里云 / 腾讯云 / AWS 均零入站。"),
				h(
					"div",
					{ className: "dsh-ra-provider" },
					h("span", { className: "dsh-ra-dot " + (pub.configured ? "on" : "off") }),
					h("select", { className: "dsh-ra-select", value: state.selected, onChange: (event) => selectProvider(event.target.value) }, providerOptions),
					h("span", { className: "dsh-ra-provider-name" }, def.label),
					h("span", { className: "dsh-ra-provider-state" }, providerState),
					h("button", { className: "dsh-ra-btn", onClick: () => patch({ editing: !state.editing }) }, state.editing ? "取消" : "编辑"),
				),
				state.error ? h("div", { className: "dsh-ra-error" }, state.error) : null,
				setupForm,
				state.tasks.length === 0
					? h(
							"div",
							{ className: "dsh-ra-empty" },
							state.loading ? "正在查询云端任务…" : "还没有云端任务。在对话里让我创建，创建时会先问你跑云端还是本地。",
						)
					: h("div", { className: "dsh-ra-list" }, rows),
				state.helpOpen ? h(GuideModal, { provider: state.selected, onClose: () => patch({ helpOpen: false }) }) : null,
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

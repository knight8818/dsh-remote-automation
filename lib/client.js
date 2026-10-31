/**
 * dsh-remote-automation —— 浏览器端。
 *
 * 没有自己的页面：把「云端任务」卡片注入官方「自动化任务」页面的
 * `section[data-testid="task-manager-page"]` 里，紧跟在页面标题之后，
 * 形成「本地任务 + 云端任务」同页。
 *
 * 这是手写产物（无构建步骤），格式与 @deepseek-ai/dsh-client-modules 的
 * 懒加载 CJS 工厂一致。
 */
window.__ModuleLoader__.load({
	id: "dsh-remote-automation",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

		const API_BASE = "/dsh-remote-automation"
		const TOKEN = (window.__DSH_REMOTE_AUTOMATION__ || {}).token || ""
		const REFRESH_MS = 8000

		const state = {
			configured: true,
			config: null,
			target: "cloud",
			tasks: [],
			error: "",
			loading: true,
			logs: {},
			busy: {},
			helpOpen: false,
			editing: false,
			setup: { accessKeyId: "", accessKeySecret: "", region: "", instanceId: "", serverDir: "/opt/automation" },
		}

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

		let wrapper = null
		let observer = null
		let timer = null

		// ---- styles -----------------------------------------------------
		const CSS = `
.dsh-ra-card { box-sizing: border-box; margin: 14px 0 6px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 12px; background: transparent; color: inherit; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.dsh-ra-card * { box-sizing: border-box; }
.dsh-ra-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-ra-title { font-weight: 650; font-size: 14px; }
.dsh-ra-sub { font-size: 11.5px; opacity: .55; }
.dsh-ra-head .dsh-ra-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.dsh-ra-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 8px; overflow: hidden; }
.dsh-ra-seg button { border: 0; background: transparent; color: inherit; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; opacity: .65; }
.dsh-ra-seg button.on { background: rgba(10,132,255,.14); color: #0a84ff; opacity: 1; font-weight: 600; }
.dsh-ra-btn { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); background: transparent; color: inherit; border-radius: 8px; padding: 4px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.dsh-ra-btn:hover { border-color: rgba(10,132,255,.55); }
.dsh-ra-btn:disabled { opacity: .5; cursor: default; }
.dsh-ra-btn.danger:hover { border-color: rgba(255,59,48,.6); color: #d70015; }
.dsh-ra-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
.dsh-ra-item { padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)); border-radius: 10px; }
.dsh-ra-item-top { display: flex; align-items: center; gap: 8px; }
.dsh-ra-name { font-weight: 600; word-break: break-all; }
.dsh-ra-badge { margin-left: auto; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(127,127,127,.14); white-space: nowrap; }
.dsh-ra-badge.running { background: rgba(10,132,255,.15); color: #0a84ff; }
.dsh-ra-badge.success { background: rgba(52,199,89,.15); color: #248a3d; }
.dsh-ra-badge.failed { background: rgba(255,59,48,.15); color: #d70015; }
.dsh-ra-meta { margin-top: 3px; font-size: 11.5px; opacity: .6; word-break: break-all; }
.dsh-ra-actions { display: flex; gap: 6px; margin-top: 7px; }
.dsh-ra-actions .dsh-ra-btn { padding: 2px 9px; }
.dsh-ra-log { margin-top: 9px; padding: 8px; max-height: 200px; overflow: auto; border-radius: 8px; background: rgba(127,127,127,.1); font: 11.5px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.dsh-ra-empty { margin-top: 10px; padding: 18px 12px; text-align: center; opacity: .55; font-size: 12.5px; border: 1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 10px; }
.dsh-ra-error { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: rgba(255,59,48,.12); color: #d70015; font-size: 12px; white-space: pre-wrap; }
.dsh-ra-setup { margin-top: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dsh-ra-setup label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; opacity: .7; }
.dsh-ra-setup input { border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3)); border-radius: 7px; background: transparent; color: inherit; padding: 5px 8px; font: inherit; }
.dsh-ra-setup .wide { grid-column: 1 / -1; }
.dsh-ra-provider { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 9px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22)); border-radius: 10px; }
.dsh-ra-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #8e8e93; }
.dsh-ra-dot.on { background: #34c759; }
.dsh-ra-dot.off { background: #8e8e93; }
.dsh-ra-provider-name { font-weight: 600; font-size: 12.5px; }
.dsh-ra-provider-state { font-size: 11.5px; opacity: .6; }
.dsh-ra-provider .dsh-ra-btn { margin-left: auto; }
.dsh-ra-q { border: 0; background: transparent; color: inherit; opacity: .5; cursor: pointer; font-size: 11px; margin-left: 4px; padding: 0 2px; }
.dsh-ra-q:hover { opacity: 1; }
.dsh-ra-form-actions { display: flex; gap: 8px; align-items: center; }
.dsh-ra-help { border: 0; background: transparent; color: inherit; opacity: .6; cursor: pointer; font: inherit; font-size: 12px; padding: 2px 4px; }
.dsh-ra-help:hover { opacity: 1; }
.dsh-ra-modal-mask { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.45); }
.dsh-ra-modal { width: min(880px, 100%); max-height: 84vh; overflow: auto; padding: 22px 24px 20px; border-radius: 16px; background: var(--dsw-specific-menu, #fff); color: inherit; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25)); box-shadow: 0 24px 64px rgba(0,0,0,.35); }
.dsh-ra-modal h2 { margin: 0; font-size: 17px; font-weight: 650; }
.dsh-ra-modal .sub { margin: 4px 0 16px; font-size: 12px; opacity: .6; }
.dsh-ra-modal .close { position: sticky; top: 0; float: right; border: 0; background: transparent; color: inherit; font-size: 20px; cursor: pointer; opacity: .6; }
.dsh-ra-cols { display: grid; grid-template-columns: 1.05fr 1fr; gap: 22px; }
.dsh-ra-cols h3 { font-size: 13px; margin: 0 0 8px; }
.dsh-ra-cols ol { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.85; }
.dsh-ra-cols li { margin-bottom: 4px; }
.dsh-ra-policy { margin: 6px 0 10px; padding: 10px 12px; border-radius: 9px; background: rgba(127,127,127,.1); font: 11.5px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.dsh-ra-note { margin-top: 10px; font-size: 12px; line-height: 1.7; opacity: .75; }
.dsh-ra-note b { font-weight: 600; }
@media (max-width: 760px) { .dsh-ra-cols { grid-template-columns: 1fr; } }
`
		const STYLE_ID = "dsh-remote-automation/card.css"
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
			const tag = document.createElement("style")
			tag.dataset.plugin = "dsh-remote-automation"
			tag.dataset.pluginCss = STYLE_ID
			tag.textContent = CSS
			document.head.appendChild(tag)
		}

		// ---- fetch ------------------------------------------------------
		function api(path, options) {
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

		// ---- render helpers ---------------------------------------------
		function esc(value) {
			return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
		}

		function badge(status) {
			if (!status) return '<span class="dsh-ra-badge">未知</span>'
			if (status.state === "running") return '<span class="dsh-ra-badge running">运行中</span>'
			if (status.state === "success") return '<span class="dsh-ra-badge success">成功</span>'
			if (status.state === "failed") return '<span class="dsh-ra-badge failed">失败</span>'
			return '<span class="dsh-ra-badge">空闲</span>'
		}

		let modalRoot = null

		function renderModal() {
			if (typeof document === "undefined") return
			if (!state.helpOpen) {
				if (modalRoot) modalRoot.innerHTML = ""
				return
			}
			if (!modalRoot) {
				modalRoot = document.createElement("div")
				modalRoot.addEventListener("click", onClick)
				document.body.appendChild(modalRoot)
			}
			modalRoot.innerHTML =
				'<div class="dsh-ra-modal-mask" data-action="close-help-bg">' +
				'<div class="dsh-ra-modal" role="dialog" aria-modal="true" aria-label="配置指南">' +
				'<button class="close" data-action="close-help" aria-label="关闭">×</button>' +
				"<h2>配置指南</h2>" +
				'<p class="sub">一次性配置，保存后此表单自动隐藏。全程不需要开放安全组。</p>' +
				'<div class="dsh-ra-cols">' +
				"<div>" +
				"<h3>1. 创建 RAM 子账号</h3>" +
				"<ol>" +
				"<li>打开 RAM 控制台：身份管理 → 用户 → 创建用户</li>" +
				"<li>登录名称随意，访问方式只勾「OpenAPI 调用访问」</li>" +
				"<li>创建后保存 AccessKey ID / Secret（Secret 只显示一次）</li>" +
				"<li>安全手机、邮箱可以留空</li>" +
				"</ol>" +
				"<h3>2. 建自定义策略</h3>" +
				"<ol>" +
				"<li>权限管理 → 权限策略 → 创建权限策略</li>" +
				"<li>选「脚本编辑」，粘贴右侧 JSON</li>" +
				"<li>名称填 <b>dsh-ecs-remote</b>，确定</li>" +
				"</ol>" +
				"<h3>3. 授权给这个用户</h3>" +
				"<ol>" +
				"<li>回到用户列表，点刚建的用户</li>" +
				"<li>权限管理 → 新增授权 → 自定义策略</li>" +
				"<li>勾选 dsh-ecs-remote，确定</li>" +
				"</ol>" +
				"</div>" +
				"<div>" +
				"<h3>最小权限策略</h3>" +
				'<pre class="dsh-ra-policy">' + esc(POLICY_JSON) + "</pre>" +
				'<button class="dsh-ra-btn" data-action="copy-policy">复制策略</button>' +
				'<div class="dsh-ra-note">' +
				"<b>只允许</b>：查实例、查云助手状态、装云助手、下发命令、查命令结果。<br>" +
				"<b>做不了</b>：删机、改安全组、动磁盘、改网络。<br>" +
				"<b>注意</b>：region 和实例 ID 要填对；实例的云助手需在线（公共镜像默认有）；安全组保持零入站即可。" +
				"</div>" +
				"</div>" +
				"</div>" +
				"</div>" +
				"</div>"
		}

		function render() {
			if (!wrapper) return
			const s = state
			const rows = s.tasks
				.map((task) => {
					const meta = [task.schedule ? "cron " + task.schedule : "手动触发"]
					if (task.status && task.status.lastExit !== null && task.status.lastExit !== undefined) {
						meta.push("上次 exit " + task.status.lastExit)
					}
					if (task.status && task.status.lastLogTime) meta.push(task.status.lastLogTime)
					const log = s.logs[task.id]
					return (
						'<div class="dsh-ra-item">' +
						'<div class="dsh-ra-item-top"><span class="dsh-ra-name">' + esc(task.name) + "</span>" + badge(task.status) + "</div>" +
						'<div class="dsh-ra-meta">' + esc(meta.join(" · ")) + "</div>" +
						'<div class="dsh-ra-actions">' +
						'<button class="dsh-ra-btn" data-action="run" data-id="' + esc(task.id) + '"' + (s.busy[task.id] ? " disabled" : "") + ">" + (s.busy[task.id] ? "启动中" : "运行") + "</button>" +
						'<button class="dsh-ra-btn" data-action="logs" data-id="' + esc(task.id) + '">' + (log !== undefined ? "收起日志" : "日志") + "</button>" +
						'<button class="dsh-ra-btn danger" data-action="delete" data-id="' + esc(task.id) + '">删除</button>' +
						"</div>" +
						(log !== undefined ? '<pre class="dsh-ra-log">' + esc(log) + "</pre>" : "") +
						"</div>"
					)
				})
				.join("")

			const provider =
				'<div class="dsh-ra-provider">' +
				'<span class="dsh-ra-dot ' + (s.configured ? "on" : "off") + '"></span>' +
				'<span class="dsh-ra-provider-name">阿里云 ECS</span>' +
				'<span class="dsh-ra-provider-state">' +
				(s.configured
					? esc((s.config && s.config.region ? s.config.region + " · " : "") + (s.config && s.config.instanceId ? s.config.instanceId : ""))
					: "未配置") +
				"</span>" +
				'<button class="dsh-ra-btn" data-action="edit-config">' + (s.editing ? "取消" : "编辑") + "</button>" +
				"</div>"

			const maskedId = s.config && s.config.accessKeyIdMasked
			const setup =
				s.editing && !s.loading
					? '<div class="dsh-ra-setup">' +
						'<label class="wide">AccessKey ID<input data-setup="accessKeyId" placeholder="' +
						(maskedId ? "留空使用已保存凭据（" + esc(maskedId) + "）" : "LTAI...") +
						'" value=""></label>' +
						'<label class="wide">AccessKey Secret <button class="dsh-ra-q" data-action="help" title="怎么获取 AccessKey">?</button><input data-setup="accessKeySecret" type="password" placeholder="' +
						(s.configured ? "留空使用已保存凭据" : "必填") +
						'" value=""></label>' +
						'<label>地域 region<input data-setup="region" placeholder="cn-shenzhen" value="' + esc(s.setup.region) + '"></label>' +
						'<label>实例 ID<input data-setup="instanceId" placeholder="i-xxxxxxxx" value="' + esc(s.setup.instanceId) + '"></label>' +
						'<label class="wide">脚本目录<input data-setup="serverDir" value="' + esc(s.setup.serverDir) + '"></label>' +
						'<div class="wide dsh-ra-form-actions"><button class="dsh-ra-btn" data-action="save-config">保存</button></div>' +
						"</div>"
					: ""

			wrapper.innerHTML =
				'<div class="dsh-ra-card" role="region" aria-label="云端自动化任务">' +
				'<div class="dsh-ra-head">' +
				'<span class="dsh-ra-title">云端任务</span>' +
				'<span class="dsh-ra-right">' +
				'<button class="dsh-ra-help" data-action="help" title="怎么配置 AccessKey 和权限">配置指南</button>' +
				'<span class="dsh-ra-seg">' +
				'<button data-action="target" data-target="cloud" class="' + (s.target === "cloud" ? "on" : "") + '">云端</button>' +
				'<button data-action="target" data-target="local" class="' + (s.target === "local" ? "on" : "") + '">本地</button>' +
				"</span>" +
				'<button class="dsh-ra-btn" data-action="refresh">' + (s.loading ? "刷新中…" : "刷新") + "</button>" +
				"</span>" +
				"</div>" +
				provider +
				(s.error ? '<div class="dsh-ra-error">' + esc(s.error) + "</div>" : "") +
				setup +
				(!s.configured ? "" : s.loading && s.tasks.length === 0 ? '<div class="dsh-ra-empty">正在查询云端任务…</div>' : s.tasks.length === 0 ? '<div class="dsh-ra-empty">还没有云端任务。在对话里让我创建，例如「每天 9 点跑 daily-report」。</div>' : '<div class="dsh-ra-list">' + rows + "</div>") +
				"</div>"
			renderModal()
		}

		// ---- actions ----------------------------------------------------
		function load() {
			if (state.loading && state.tasks.length > 0) return
			state.loading = true
			api("/state")
				.then((data) => {
					state.configured = data.configured !== false
					state.config = data.config || null
					state.target = data.target === "local" ? "local" : "cloud"
					state.tasks = Array.isArray(data.tasks) ? data.tasks : []
					state.error = data.error || ""
					if (!state.configured) state.editing = true
					const cfg = data.config || {}
					if (!state.setup.region && cfg.region) state.setup.region = cfg.region
					if (!state.setup.instanceId && cfg.instanceId) state.setup.instanceId = cfg.instanceId
					if (cfg.serverDir) state.setup.serverDir = cfg.serverDir
				})
				.catch((error) => {
					state.error = error.message
				})
				.finally(() => {
					state.loading = false
					render()
				})
		}

		function setTarget(target) {
			api("/target", { method: "POST", body: { target } })
				.then((data) => {
					state.target = data.target
					state.error = ""
					load()
				})
				.catch((error) => {
					state.error = error.message
					render()
				})
		}

		function runTask(id) {
			state.busy[id] = true
			render()
			api("/tasks/" + encodeURIComponent(id) + "/run", { method: "POST" })
				.then(() => setTimeout(load, 1200))
				.catch((error) => {
					state.error = error.message
					render()
				})
				.finally(() => {
					state.busy[id] = false
				})
		}

		function deleteTask(id) {
			if (!window.confirm("确定删除这个云端任务？脚本、cron 和日志都会清理。")) return
			api("/tasks/" + encodeURIComponent(id) + "/delete", { method: "POST" })
				.then(load)
				.catch((error) => {
					state.error = error.message
					render()
				})
		}

		function toggleLogs(id) {
			if (state.logs[id] !== undefined) {
				delete state.logs[id]
				render()
				return
			}
			api("/tasks/" + encodeURIComponent(id) + "/logs?lines=200")
				.then((data) => {
					state.logs[id] = data.log || "(暂无日志)"
					render()
				})
				.catch((error) => {
					state.error = error.message
					render()
				})
		}

		function saveConfig() {
			const body = {}
			for (const key of ["accessKeyId", "accessKeySecret", "region", "instanceId", "serverDir"]) {
				const value = (state.setup[key] || "").trim()
				if (value) body[key] = value
			}
			api("/config", { method: "POST", body })
				.then((data) => {
					state.configured = data.configured
					state.config = data
					state.editing = false
					state.setup.accessKeyId = ""
					state.setup.accessKeySecret = ""
					state.error = data.configured ? "" : "还缺：" + (data.missing || []).join(", ")
					load()
				})
				.catch((error) => {
					state.error = error.message
					render()
				})
		}

		function onInput(event) {
			const key = event.target && event.target.getAttribute && event.target.getAttribute("data-setup")
			if (key) state.setup[key] = event.target.value
		}

		function onClick(event) {
			const el = event.target.closest ? event.target.closest("[data-action]") : null
			if (!el) return
			const action = el.getAttribute("data-action")
			if (action === "refresh") return load()
			if (action === "target") return setTarget(el.getAttribute("data-target"))
			if (action === "run") return runTask(el.getAttribute("data-id"))
			if (action === "delete") return deleteTask(el.getAttribute("data-id"))
			if (action === "logs") return toggleLogs(el.getAttribute("data-id"))
			if (action === "save-config") return saveConfig()
			if (action === "help") {
				state.helpOpen = true
				return renderModal()
			}
			if (action === "close-help") {
				state.helpOpen = false
				return renderModal()
			}
			if (action === "close-help-bg") {
				if (event.target.classList && event.target.classList.contains("dsh-ra-modal-mask")) {
					state.helpOpen = false
					renderModal()
				}
				return
			}
			if (action === "edit-config") {
				state.editing = !state.editing
				return render()
			}
			if (action === "copy-policy") {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(POLICY_JSON)
				}
				return
			}
		}

		// ---- mount into the official page -------------------------------
		function mount() {
			const page = document.querySelector('[data-testid="task-manager-page"]')
			if (!page) {
				if (state.helpOpen) {
					state.helpOpen = false
					renderModal()
				}
				return
			}
			const heading = page.querySelector("h1")
			const content = heading && heading.parentElement && heading.parentElement.parentElement
			if (!heading || !content) return
			if (wrapper && wrapper.isConnected && wrapper.parentElement === content) return
			if (!wrapper) {
				wrapper = document.createElement("div")
				wrapper.setAttribute("data-dsh-remote-automation", "")
				wrapper.addEventListener("click", onClick)
				wrapper.addEventListener("input", onInput)
			}
			heading.parentElement.insertAdjacentElement("afterend", wrapper)
			render()
			load()
			if (!timer) {
				timer = setInterval(() => {
					if (wrapper && wrapper.isConnected && document.visibilityState !== "hidden") load()
				}, REFRESH_MS)
			}
		}

		function apply() {
			if (typeof document === "undefined") return
			const tick = () => mount()
			observer = new MutationObserver(() => {
				if (!wrapper || !wrapper.isConnected) tick()
			})
			observer.observe(document.body, { childList: true, subtree: true })
			document.addEventListener("keydown", (event) => {
				if (event.key === "Escape" && state.helpOpen) {
					state.helpOpen = false
					renderModal()
				}
			})
			tick()
		}

		exports.apply = apply
		exports.inject = []
		return module.exports
	},
})

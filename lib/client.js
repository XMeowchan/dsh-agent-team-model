// dsh-agent-team-model — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-agent-team-model/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load).
//
// The UI is built from DSH's own front-end primitives —
// `@deepseek-ai/dsh-client-ui-primitives` is a platform seed word (the same
// baseline module `dsh-codex-subscription` and the shipped ui-* packages
// require), so this bundle declares no dependency for it:
//   Modal   → the secondary surface (portaled, blurred mask, Escape/mask close)
//   Menu    → every provider / model / effort dropdown
//   Switch  → the enable toggle
//   Input   → the teammate-name field
//   Button  → trigger chip and actions
//   StateDot→ status dots
//   icons   → IconPersonalizeOutline16, IconChevronDownOutline14, …
// Only the grouping scaffold (inset grouped lists) is local CSS, styled from
// `--dsw-*` tokens.
//
// Two seats, scoped by the selected conversation's viewer role:
//   - `settings.section` → leader configuration or the current teammate only
//   - `conversation.input.right` → a working-count / own-model chip and Modal
// Provider-owned continuable teammates expose a read-only model panel, never
// the leader's configuration or roster.
//
// The "当前对话的团队" section shows exactly one conversation's Team: the
// composer seat passes its Session id to the host and the settings page reads
// the currently selected Session, so the host answers with that conversation's
// own roster. The Lead is labelled 队长 on its own row above a divider, the
// teammates follow under a 队员 caption, and an empty roster says 尚未创建队员.

window.__ModuleLoader__.load({
	id: "dsh-agent-team-model",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const Button = primitives.Button;
		const Input = primitives.Input;
		const Menu = primitives.Menu;
		const Modal = primitives.Modal;
		const StateDot = primitives.StateDot;
		const Switch = primitives.Switch;

		const API = "/agent-team-model/api";
		const POLL_MS = 4000;
		/** Id of the injected scaffold stylesheet. */
		const STYLE_ID = "agent-team-model-style";
		/** Loader entry name this bundle is mounted under: the HMR style owner key. */
		const STYLE_OWNER = "dsh-agent-team-model";

		/**
		 * Render a primitive icon by name, tolerating a build without it.
		 * @param name - exported icon component name.
		 * @param props - element props (a `key` keeps list children listable).
		 * @returns the icon element, or null when this build has no such icon.
		 */
		function icon(name, props) {
			const Component = primitives[name];
			if (Component === undefined) return null;
			return h(Component, props ?? null);
		}

		/**
		 * Render a read-only role tag with the shipped Tag primitive when this
		 * primitives build has one, falling back to a plain span so an older
		 * build cannot break the seat.
		 * @param text - the localized label.
		 * @returns the tag element.
		 */
		function roleTag(text) {
			const Component = primitives.Tag;
			if (typeof Component !== "function") {
				// Marked like the primitive so callers (and tests) read one shape in both builds.
				return h("span", { className: "atm_roleTag", "data-tone": "info", "data-atm-fallback": "tag" }, text);
			}
			return h(Component, { tone: "info", className: "atm_roleTag" }, text);
		}

		const css = `
.atm_root{
--atm-surface:var(--dsw-alias-bg-layer-2,#fff);
--atm-fg:var(--dsw-alias-label-primary,#202124);
--atm-fg-2:var(--dsw-alias-label-secondary,#727279);
--atm-fg-3:var(--dsw-alias-label-tertiary,#8b9199);
--atm-border:var(--dsw-alias-border-l2,#8883);
display:flex;flex-direction:column;gap:22px;padding:2px 2px 18px;
font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,1.5);
font-family:var(--dsw-font-family,inherit);color:var(--atm-fg)}
.atm_root *{box-sizing:border-box}
.atm_lead{margin:0;font-size:12.5px;line-height:1.6;color:var(--atm-fg-2)}
.atm_group{display:flex;flex-direction:column;gap:7px}
.atm_groupTitle{margin:0;padding:0 3px;font-size:12px;font-weight:500;color:var(--atm-fg-2)}
.atm_groupFoot{margin:0;padding:1px 3px 0;font-size:12px;line-height:1.55;color:var(--atm-fg-3)}
.atm_warn{color:var(--dsw-alias-state-warn-primary,#d9a13b)}
.atm_list{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--atm-border);border-radius:12px;background:var(--atm-surface)}
.atm_row{display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 14px}
.atm_row+.atm_row{border-top:1px solid var(--atm-border)}
.atm_rowLabel{flex:1 1 auto;min-width:0;font-size:14px;color:var(--atm-fg)}
.atm_rowNote{margin-top:1px;font-size:12px;color:var(--atm-fg-3)}
.atm_rowValue{flex:none;max-width:62%;font-size:13px;color:var(--atm-fg-2);text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.atm_rowControl{flex:none;display:flex;align-items:center;gap:8px}
.atm_stack{display:flex;flex-direction:column;gap:10px;padding:10px 14px 12px}
.atm_pickerRow{display:flex;gap:8px;flex-wrap:wrap}
.atm_pickerLabel{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atm_pickerChevron{flex:none;opacity:.7}
.atm_nameInput{width:100%}
.atm_leadRow{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.06))}
.atm_rowName{display:flex;align-items:center;gap:6px}
.atm_roleTag{flex:none}
.atm_divider{display:flex;align-items:center;gap:8px;padding:7px 14px 5px;border-top:1px solid var(--atm-border);
background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.06));
font-size:11.5px;font-weight:600;color:var(--atm-fg-3)}
.atm_emptyRow{padding:12px 14px;font-size:12.5px;color:var(--atm-fg-3)}
.atm_foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 3px}
.atm_status{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--atm-fg-2)}
.atm_footActions{display:flex;align-items:center;gap:8px}
.atm_mono{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;color:var(--atm-fg-3);word-break:break-all}
.atm_trigger{flex:none}
.atm_dotIcon{flex:none}
/* Sheet seat: the shipped Modal owns the chrome (header, mask, card radius), so
   these two classes only use the seams DSH itself uses for a tall dialog —
   Modal's className prop for the card bounds and its contentClassName prop for
   the one scrollable region (same shape as the shipped RiskConfirmation).
   Nothing here restyles a shipped class; every selector is our own atm_ name. */
.atm_sheetCard{box-sizing:border-box;width:min(520px,100%);max-height:calc(100vh - 48px);overflow:hidden}
.atm_sheetContent{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.atm_sheetBody{gap:14px;padding:0 0 2px}
.atm_sheetBody .atm_row{min-height:42px;padding:6px 14px}
.atm_sheetBody .atm_stack{padding:8px 14px 10px}
.atm_sheetBody .atm_group{gap:6px}
.atm_sheetBody .atm_divider{padding:6px 14px 4px}
.atm_sheetBody .atm_emptyRow{padding:10px 14px}
@supports (height:100dvh){.atm_sheetCard{max-height:calc(100dvh - 48px)}}
`;

		/**
		 * Inject the scaffold stylesheet, or refresh it when this bundle's CSS
		 * changed. The `data-plugin` attribute is the key dsh-client-hmr's
		 * removeOwnedStyles() uses when it hot-swaps this entry, and the text
		 * comparison keeps a live page in sync even when a tag survived a reload
		 * that dropped the module (otherwise stale CSS would outlive new JS).
		 */
		function ensureStyle() {
			const existing = document.getElementById(STYLE_ID);
			if (existing !== null && existing.textContent === css) {
				if (existing.getAttribute("data-plugin") !== STYLE_OWNER) existing.setAttribute("data-plugin", STYLE_OWNER);
				return;
			}
			const tag = existing ?? document.createElement("style");
			tag.id = STYLE_ID;
			tag.setAttribute("data-plugin", STYLE_OWNER);
			tag.textContent = css;
			if (existing === null) document.head.appendChild(tag);
		}

		/** One fenced JSON call to the host half. */
		async function call(method, extra) {
			const response = await fetch(API, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(Object.assign({ method }, extra ?? {}))
			});
			const body = await response.json().catch(() => null);
			if (!response.ok || body === null || body.ok !== true) {
				const message = body && body.error && body.error.message ? body.error.message : `HTTP ${response.status}`;
				throw new Error(message);
			}
			if (body.value === undefined || body.value === null) {
				// Fail loud instead of rendering "继承队长" over a configured route.
				throw new Error("host returned no view payload");
			}
			return body.value;
		}

		/** Route key of one provider/model pair, matching the host's catalog keys. */
		function routeKey(provider, model) {
			return `${provider}\u0000${model}`;
		}

		/** Drop empty fields; a route is usable only with both provider and model. */
		function pruneRoute(route) {
			const out = {};
			if (typeof route?.provider === "string" && route.provider !== "") out.provider = route.provider;
			if (typeof route?.model === "string" && route.model !== "") out.model = route.model;
			if (typeof route?.reasoningEffort === "string" && route.reasoningEffort !== "") out.reasoningEffort = route.reasoningEffort;
			return out.provider !== undefined && out.model !== undefined ? out : undefined;
		}

		/** Stored config -> editable draft. */
		function toDraft(config) {
			const overrides = config && typeof config.overrides === "object" && config.overrides !== null ? config.overrides : {};
			return {
				enabled: !config || config.enabled !== false,
				default: Object.assign({}, (config && config.default) || {}),
				rows: Object.entries(overrides).map(([name, route]) => ({ name, route: Object.assign({}, route) }))
			};
		}

		/** Editable draft -> stored config. */
		function fromDraft(draft) {
			const overrides = {};
			for (const row of draft.rows) {
				const name = typeof row.name === "string" ? row.name.trim() : "";
				if (name === "") continue;
				const route = pruneRoute(row.route);
				if (route === undefined) continue;
				overrides[name] = route;
			}
			const config = { enabled: draft.enabled === true, overrides };
			const fallback = pruneRoute(draft.default);
			if (fallback !== undefined) config.default = fallback;
			return config;
		}

		/** Warn when the host half mounted without its continuation hook. */
		function hookWarning(view) {
			if (!view || !view.hook || view.hook.installed === true) return null;
			return "宿主侧路由钩子未安装：队员仍会继承队长路由（重启 DSH 宿主后再看）。";
		}

		/** Explicit viewer identity wins; old hosts require an exact child-row match. */
		function isTeammateViewer(view, sessionId) {
			if (view?.viewer != null) return view.viewer.role === "teammate";
			return !!sessionId && (view?.members ?? []).some((member) => member?.id === sessionId && member.role === "teammate");
		}

		/** Never substitute the leader, a sibling, or the default route for this row. */
		function ownMember(view, sessionId) {
			const id = view?.viewer?.memberId || sessionId;
			return (view?.members ?? []).find((member) => member?.id === id && member.role === "teammate");
		}

		function memberModelLabel(member, catalog) {
			if (!member?.model || ["unknown", "unavailable"].includes(member.routeSource)) return "尚未获取模型";
			return catalog?.models?.[member.provider]?.find((entry) => entry.id === member.model)?.name || member.model;
		}

		function workingCountLabel(view) {
			const teammates = (view?.members ?? []).filter((member) => member?.role === "teammate");
			return `${teammates.filter((member) => member.status === "running").length}/${teammates.length} 个队员正在工作`;
		}

		/** Provenance is informative even when the teammate is not currently resident. */
		function memberRouteTitle(member) {
			const source = member?.routeSource;
			const labels = {
				persisted: "来自已保存的队员会话路由；无需唤醒队员即可查看。",
				live: "来自当前运行中的队员会话。",
				unknown: "尚未获取该队员的路由；不会以队长模型代替。",
				"persisted-descriptor": "来自已保存的队员恢复路由；无需唤醒队员即可查看。",
				"last-request": "来自该队员最近一次真实请求。",
				creation: "来自该队员创建时的路由。",
				unavailable: "尚未获取该队员的路由；不会以队长模型代替。"
			};
			return member?.routeError || labels[source] || (source ? `队员路由来源：${source}` : "该队员自身的路由；不会以队长模型代替。");
		}

		/** Member status -> StateDot semantic. */
		function memberDotState(status) {
			if (status === "running" || status === "provisioning") return "ongoing";
			if (status === "failed") return "error";
			if (status === "idle") return "done";
			return "idle";
		}

		/** Roster status -> short label. */
		function memberStatusText(status) {
			if (status === "running") return "运行中";
			if (status === "idle") return "空闲";
			if (status === "provisioning") return "创建中";
			if (status === "failed") return "失败";
			if (status === "inactive") return "未运行（可恢复）";
			return status || "未知";
		}

		/** Completion is durable; inactive residency alone does not mean completed. */
		function memberWorkLabel(member) {
			if (member?.status === "running") return "工作中";
			if (member?.status === "provisioning") return "创建中";
			if (member?.status === "failed") return "失败";
			const labels = { completed: "已完成", canceled: "已取消", pending: "待处理", interrupted: "未完成" };
			return labels[member?.workState] || memberStatusText(member?.status);
		}

		function memberWorkDot(member) {
			if (["running", "provisioning", "failed"].includes(member?.status)) return memberDotState(member.status);
			return member?.workState === "completed" ? "done" : memberDotState(member?.status);
		}

		/** Live route of one roster row: provider / model · effort. */
		function memberRouteText(member) {
			if (["unknown", "unavailable"].includes(member.routeSource)) return "尚未获取模型";
			const provider = typeof member.provider === "string" && member.provider !== "" ? `${member.provider} / ` : "";
			return `${provider}${member.model || "尚未获取模型"}${member.reasoningEffort ? " · " + member.reasoningEffort : ""}`;
		}

		/**
		 * One roster row: status dot + name (or a 队长 badge) + live route.
		 * @param key - React key.
		 * @param member - host roster row (TeamMemberView shape).
		 * @param nameNode - primary label of the row.
		 * @param note - secondary line, already carrying role and status.
		 * @param lead - whether this is the Lead row.
		 * @returns the row element.
		 */
		function memberRow(key, member, nameNode, note, lead) {
			return h("div", { key, className: lead === true ? "atm_row atm_leadRow" : "atm_row" }, [
				h(StateDot, { key: "dot", state: memberDotState(member.status), size: 8 }),
				h("div", { key: "label", className: "atm_rowLabel" }, [
					h("div", { key: "name", className: "atm_rowName" }, nameNode),
					h("div", { key: "meta", className: "atm_rowNote" }, note)
				]),
				h("span", { key: "route", className: "atm_rowValue", title: memberRouteTitle(member) }, memberRouteText(member))
			]);
		}

		/**
		 * The conversation the client currently shows, read from the shell's
		 * Session list — the settings page is root-scoped and has no Session
		 * prop of its own.
		 * @param ctx - client plugin context.
		 * @returns the current Session id, or undefined when the shell exposes none.
		 */
		function currentSessionId(ctx) {
			let sessions;
			try {
				sessions = typeof ctx?.get === "function" ? ctx.get("sessions") : undefined;
			} catch {
				return undefined;
			}
			try {
				const state = sessions?.list?.getSnapshot?.();
				return typeof state?.current === "string" && state.current !== "" ? state.current : undefined;
			} catch {
				return undefined;
			}
		}

		/** A DSH Menu dropdown with the shipped chevron affordance. */
		function RoutePicker(props) {
			const [open, setOpen] = React.useState(false);
			const items = (props.items ?? []).map((item) => ({ id: item.id, label: item.label, disabled: item.disabled }));
			return h(Menu, {
				open,
				onClose: () => setOpen(false),
				selectedId: props.value === "" || props.value === undefined ? undefined : props.value,
				align: props.align ?? "end",
				portal: true,
				autoFocus: true,
				items,
				onSelect: (id) => {
					setOpen(false);
					props.onSelect(id);
				},
				anchor: h(Button, {
					variant: "ghost",
					size: "sm",
					disabled: props.disabled === true,
					className: "atm_picker",
					"aria-haspopup": "menu",
					"aria-expanded": open ? "true" : "false",
					title: props.title,
					onClick: () => setOpen((current) => !current)
				}, [
					h("span", { key: "label", className: "atm_pickerLabel" }, props.label),
					icon("IconChevronDownOutline14", { key: "chevron", className: "atm_pickerChevron" })
				])
			});
		}

		/** Options for the three route fields, from the host model catalog. */
		function routeOptions(catalog, route) {
			const provider = route.provider || "";
			const models = (catalog.models && catalog.models[provider]) || [];
			const reasoning = (catalog.efforts && catalog.efforts[routeKey(provider, route.model)]) || null;
			return {
				provider: [{ id: "", label: "继承队长" }, ...(catalog.providers || []).map((entry) => ({ id: entry.id, label: entry.name || entry.id }))],
				model: [{ id: "", label: provider === "" ? "先选 Provider" : "选择模型" }, ...models.map((entry) => ({ id: entry.id, label: entry.name || entry.id }))],
				effort: [
					{ id: "", label: reasoning && reasoning.defaultEffort ? `模型默认 · ${reasoning.defaultEffort}` : "模型默认" },
					...(reasoning ? reasoning.efforts : []).map((entry) => ({ id: entry.id, label: entry.name || entry.id }))
				]
			};
		}

		/** Three stacked path rows: Provider / Model / Reasoning effort. */
		function RouteRows(props) {
			const route = props.route || {};
			const catalog = props.catalog || { providers: [], models: {}, efforts: {} };
			const options = routeOptions(catalog, route);
			const set = (patch) => props.onChange(Object.assign({}, route, patch));
			const row = (key, label, pickerProps) => h("div", { key, className: "atm_row" }, [
				h("span", { key: "label", className: "atm_rowLabel" }, label),
				h("div", { key: "control", className: "atm_rowControl" }, h(RoutePicker, pickerProps))
			]);
			return [
				row("provider", "Provider", {
					label: route.provider ? (catalog.providers || []).find((entry) => entry.id === route.provider)?.name || route.provider : "继承队长",
					value: route.provider || "",
					items: options.provider,
					disabled: props.disabled,
					onSelect: (id) => set({ provider: id || undefined, model: undefined, reasoningEffort: undefined })
				}),
				row("model", "Model", {
					label: route.model || (route.provider ? "选择模型" : "—"),
					value: route.model || "",
					items: options.model,
					disabled: props.disabled || route.provider === undefined,
					onSelect: (id) => set({ model: id || undefined, reasoningEffort: undefined })
				}),
				row("effort", "Reasoning effort", {
					label: route.reasoningEffort || "模型默认",
					value: route.reasoningEffort || "",
					items: options.effort,
					disabled: props.disabled || route.model === undefined,
					onSelect: (id) => set({ reasoningEffort: id || undefined })
				})
			];
		}

		/** The same three pickers in one wrapped row, for a named override. */
		function RoutePickerRow(props) {
			const route = props.route || {};
			const catalog = props.catalog || { providers: [], models: {}, efforts: {} };
			const options = routeOptions(catalog, route);
			const set = (patch) => props.onChange(Object.assign({}, route, patch));
			return h("div", { className: "atm_pickerRow" }, [
				h(RoutePicker, {
					key: "provider",
					label: route.provider ? (catalog.providers || []).find((entry) => entry.id === route.provider)?.name || route.provider : "Provider",
					value: route.provider || "",
					items: options.provider,
					disabled: props.disabled,
					align: "start",
					onSelect: (id) => set({ provider: id || undefined, model: undefined, reasoningEffort: undefined })
				}),
				h(RoutePicker, {
					key: "model",
					label: route.model || "Model",
					value: route.model || "",
					items: options.model,
					disabled: props.disabled || route.provider === undefined,
					align: "start",
					onSelect: (id) => set({ model: id || undefined, reasoningEffort: undefined })
				}),
				h(RoutePicker, {
					key: "effort",
					label: route.reasoningEffort || "effort",
					value: route.reasoningEffort || "",
					items: options.effort,
					disabled: props.disabled || route.model === undefined,
					align: "start",
					onSelect: (id) => set({ reasoningEffort: id || undefined })
				})
			]);
		}

		/** A teammate sees only its own observed route, with no editable controls. */
		function TeammateModel(props) {
			const { view, sessionId } = props;
			const member = ownMember(view, sessionId);
			const effort = ["unknown", "unavailable"].includes(member?.routeSource) ? undefined : member?.reasoningEffort;
			const effortName = view.catalog?.efforts?.[routeKey(member?.provider, member?.model)]?.efforts?.find((entry) => entry.id === effort)?.name;
			const reason = view.viewer?.modelEditReason || "当前 DSH 不支持热修改由 Provider 管理的可恢复队员的模型或推理强度；此处仅供查看。";
			const row = (key, label, value, title) => h("div", { key, className: "atm_row" }, [
				h("span", { key: "label", className: "atm_rowLabel" }, label),
				h("span", { key: "value", className: "atm_rowValue", title }, value)
			]);
			return h("div", { className: props.rootClass }, [
				!props.sheet && h("h3", { key: "title", className: "atm_groupTitle" }, "当前队员模型"),
				h("section", { key: "own", className: "atm_group" }, [
					h("div", { key: "list", className: "atm_list" }, [
						row("name", "队员", member?.name || member?.id || "尚未获取队员信息"),
						row("model", "模型", memberModelLabel(member, view.catalog), memberRouteTitle(member)),
						row("effort", "推理强度", effortName && effortName !== effort ? `${effortName} · ${effort}` : effort || "尚未获取推理强度"),
						row("status", "当前状态", h("span", { className: "atm_status" }, [
							h(StateDot, { key: "dot", state: memberWorkDot(member), size: 8 }),
							h("span", { key: "text" }, memberWorkLabel(member))
						]))
					]),
					h("p", { key: "reason", className: "atm_groupFoot" }, `只读：${reason}`),
					(view.membersError || props.error) && h("p", { key: "error", className: "atm_groupFoot atm_warn" }, `读取失败：${props.error || view.membersError}`)
				]),
				h("div", { key: "foot", className: "atm_foot" }, h(Button, { variant: "ghost", size: "sm", onClick: props.reload }, "重新读取"))
			]);
		}

		/**
		 * Shared editor body, keyed so a Session switch discards all old-role data.
		 * @param props.variant - `"page"` (settings page) or `"sheet"` (dialog):
		 *   the sheet drops the lead paragraph and the storage path so the dialog
		 *   stays short. Internal injection history is not shown in either seat.
		 */
		function ModelConfig(props) {
			return h(SessionModelConfig, Object.assign({}, props, { key: props.sessionId || "unbound" }));
		}

		function SessionModelConfig(props) {
			const sheet = props.variant === "sheet";
			const sessionId = props.sessionId;
			/** The dialog runs denser than the settings page so it stays short. */
			const rootClass = sheet ? "atm_root atm_sheetBody" : "atm_root";
			const [view, setView] = React.useState(null);
			const [draft, setDraft] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [note, setNote] = React.useState(null);

			const scope = React.useRef({ live: false, sequence: 0, view: null });
			// Full-document writes must commit in edit order. Response sequence fences
			// protect the UI only; this chain also prevents an older async host write
			// from reaching disk after a newer selection.
			const saveChain = React.useRef(Promise.resolve());
			const canMutate = React.useCallback(() => scope.current.live && scope.current.view !== null
				&& !isTeammateViewer(scope.current.view, sessionId) && scope.current.view.config != null, [sessionId]);

			// All operations, including manual reload/save, share teardown and
			// response-order fences. A stale callback cannot resurrect the old role.
			const requestView = React.useCallback(async (method, extra, keepDraft, successNote) => {
				if (!scope.current.live || (method !== "get" && !canMutate())) return;
				const sequence = ++scope.current.sequence;
				try {
					const value = await call(method, Object.assign({}, extra, { sessionId }));
					if (!scope.current.live || sequence !== scope.current.sequence) return;
					scope.current.view = value;
					setView(value);
					const readOnly = isTeammateViewer(value, sessionId) || value.config == null;
					setDraft((current) => readOnly ? null : keepDraft && current !== null ? current : toDraft(value.config));
					setError(null);
					if (readOnly || successNote !== undefined) setNote(readOnly ? null : successNote);
				} catch (reason) {
					if (!scope.current.live || sequence !== scope.current.sequence) return;
					setError(String(reason?.message || reason));
					setNote(null);
				}
			}, [canMutate, sessionId]);

			const reload = React.useCallback(() => requestView("get", null, false), [requestView]);
			React.useEffect(() => {
				scope.current.live = true;
				reload();
				const timer = setInterval(() => {
					if (document.visibilityState === "hidden") return;
					requestView("get", null, true);
				}, POLL_MS);
				return () => {
					scope.current.live = false;
					scope.current.sequence += 1;
					clearInterval(timer);
				};
			}, [reload, requestView]);

			const save = React.useCallback((next) => {
				if (!canMutate()) return;
				setDraft(next);
				const incomplete = [next.default, ...next.rows.map(row => row.route)]
					.some(route => route.provider && !route.model);
				if (incomplete) {
					setNote("请选择模型，完成后自动保存");
					return;
				}
				setNote("保存中…");
				const config = fromDraft(next);
				saveChain.current = saveChain.current.then(() =>
					requestView("set", { config }, true, "已保存，对下一个创建的队员生效"));
			}, [canMutate, requestView]);

			if (view !== null && isTeammateViewer(view, sessionId)) {
				return h(TeammateModel, { view, sessionId, rootClass, sheet, error, reload });
			}
			if (draft === null) {
				return h("div", { className: rootClass }, h("p", { className: "atm_lead", key: "status" }, error ? `加载失败：${error}` : view ? "当前对话未提供可编辑配置。" : "加载中…"));
			}

			const catalog = (view && view.catalog) || { providers: [], models: {}, efforts: {}, error: null };
			const members = (view && view.members) || [];
			const warning = hookWarning(view);
			const statusText = error
				? `错误：${error}`
				: warning || note || (catalog.error ? `模型目录不完整：${catalog.error}` : "就绪");
			const statusState = error ? "error" : warning !== null ? "warning" : note !== null ? "done" : "idle";

			const list = (key, children) => h("div", { key, className: "atm_list" }, children);

			const enableGroup = h("section", { key: "enable", className: "atm_group" }, [
				list("list", h("div", { key: "switch", className: "atm_row" }, [
					h("span", { key: "label", className: "atm_rowLabel" }, "启用队员路由覆盖"),
					h(Switch, {
						key: "control",
						checked: draft.enabled,
						label: "启用队员路由覆盖",
						onChange: (next) => save(Object.assign({}, draft, { enabled: next }))
					})
				])),
				!draft.enabled && h("p", { key: "foot", className: "atm_groupFoot" }, "关闭后新建队员完全继承队长的模型。")
			]);

			const defaultGroup = h("section", { key: "default", className: "atm_group" }, [
				h("h3", { key: "title", className: "atm_groupTitle" }, "默认队员路由"),
				list("list", RouteRows({
					route: draft.default,
					catalog,
					disabled: !draft.enabled,
					onChange: (route) => save(Object.assign({}, draft, { default: route }))
				})),
				// The dialog keeps only action-relevant copy; the settings page owns the explainers.
				!sheet && h("p", { key: "foot", className: "atm_groupFoot" }, "未单独配置的队员都走这条路由；Provider 选「继承队长」即跟随你当前的选择。")
			]);

			const overrideRows = [];
			draft.rows.forEach((row, index) => {
				overrideRows.push(h("div", { key: `name-${index}`, className: "atm_row" }, [
					h("div", { key: "input", className: "atm_rowLabel" }, h(Input, {
						className: "atm_nameInput",
						type: "text",
						placeholder: "队员名，如 researcher",
						value: row.name,
						onChange: (event) => {
							const next = draft.rows.slice();
							next[index] = Object.assign({}, row, { name: event.target.value });
							setDraft(Object.assign({}, draft, { rows: next }));
						},
						onBlur: () => {
							const next = draft.rows.slice();
							next[index] = Object.assign({}, row, { name: row.name.trim() });
							save(Object.assign({}, draft, { rows: next }));
						}
					})),
					h(Button, {
						key: "remove",
						variant: "ghost",
						size: "sm",
						icon: icon("IconTrashOutline16"),
						"aria-label": "移除覆盖规则",
						title: "移除",
						onClick: () => save(Object.assign({}, draft, { rows: draft.rows.filter((_entry, at) => at !== index) }))
					}, "\u00a0")
				]));
				overrideRows.push(h("div", { key: `route-${index}`, className: "atm_stack" }, h(RoutePickerRow, {
					route: row.route,
					catalog,
					disabled: !draft.enabled,
					onChange: (route) => {
						const next = draft.rows.slice();
						next[index] = Object.assign({}, row, { route });
						save(Object.assign({}, draft, { rows: next }));
					}
				})));
			});

			const overrideGroup = h("section", { key: "overrides", className: "atm_group" }, [
				h("h3", { key: "title", className: "atm_groupTitle" }, "按队员名覆盖"),
				draft.rows.length === 0
					? list("list", h("div", { key: "empty", className: "atm_emptyRow" }, "还没有覆盖规则。"))
					: list("list", overrideRows),
				h("div", { key: "add", className: "atm_list" }, h("div", { className: "atm_row" }, h(Button, {
					variant: "ghost",
					size: "sm",
					disabled: !draft.enabled,
					onClick: () => setDraft(Object.assign({}, draft, { rows: draft.rows.concat([{ name: "", route: {} }]) }))
				}, "添加覆盖规则")))
			]);

			const lead = members.find((member) => member && member.role === "lead");
			const teammates = members.filter((member) => member?.role === "teammate");
			// A host that could not read the roster must say so; "尚未创建队员"
			// would be a false claim about a conversation we failed to inspect.
			const rosterError = view && typeof view.membersError === "string" && view.membersError !== "" ? view.membersError : null;
			// The settings seat can exist with no conversation selected at all —
			// that state must ask for a selection, not claim an empty roster.
			const unbound = !(view && typeof view.sessionId === "string" && view.sessionId !== "");
			const memberRows = [];
			if (lead !== undefined) {
				memberRows.push(memberRow("lead", lead, roleTag("队长"), `当前对话 · ${memberStatusText(lead.status)}`, true));
				memberRows.push(h("div", { key: "divider", className: "atm_divider" }, teammates.length > 0 ? `队员 · ${teammates.length}` : "队员"));
			}
			if (rosterError !== null) {
				memberRows.push(h("div", { key: "error", className: "atm_emptyRow" }, `无法读取当前对话的团队：${rosterError}`));
			} else if (teammates.length === 0) {
				memberRows.push(h("div", { key: "empty", className: "atm_emptyRow" }, unbound ? "尚未选择对话" : "尚未创建队员"));
			} else {
				teammates.forEach((member, index) => {
					memberRows.push(memberRow(member.id || index, member, member.name || member.id || "—", `队员 · ${memberStatusText(member.status)}`, false));
				});
			}
			// Injection counters reset on restart; a zero is not evidence of a
			// broken route hook or of an existing teammate inheriting the leader.
			const membersGroup = h("section", { key: "members", className: "atm_group" }, [
				h("h3", { key: "title", className: "atm_groupTitle" }, "当前对话的团队"),
				list("list", memberRows)
			]);

			const foot = h("div", { key: "foot", className: "atm_foot" }, [
				h("span", { key: "status", className: "atm_status" }, [
					h(StateDot, { key: "dot", state: statusState, size: 8 }),
					h("span", { key: "text" }, statusText)
				]),
				h("div", { key: "actions", className: "atm_footActions" }, [
					h(Button, {
						key: "reload",
						variant: "ghost",
						size: "sm",
						onClick: reload
					}, "重新读取")
				])
			]);

			return h("div", { className: rootClass }, [
				!sheet && h("p", { key: "lead", className: "atm_lead" }, "决定队长创建队员时，队员实际使用的模型与推理强度。改动对下一个创建的队员生效；调用里显式指定 provider/model 时以调用为准。"),
				enableGroup,
				defaultGroup,
				overrideGroup,
				membersGroup,
				foot,
				!sheet && view && view.statePath ? h("div", { key: "path", className: "atm_mono" }, `配置存储：${view.statePath}`) : null
			]);
		}

		/**
		 * Settings-page wrapper around the shared editor body. The page is
		 * root-scoped, so it follows the shell's current Session selection
		 * instead of receiving a Session prop.
		 * @param props.ctx - client plugin context.
		 */
		function Panel(props) {
			const ctx = props.ctx;
			const [sessionId, setSessionId] = React.useState(() => currentSessionId(ctx));
			React.useEffect(() => {
				setSessionId(currentSessionId(ctx));
				const list = ctx?.get?.("sessions")?.list;
				if (list === undefined || typeof list.subscribe !== "function") return undefined;
				const dispose = list.subscribe(() => setSessionId(currentSessionId(ctx)));
				return () => {
					if (typeof dispose === "function") dispose();
				};
			}, [ctx]);
			return h(ModelConfig, { variant: "page", sessionId });
		}

		/** Session switches close the old dialog and discard its chip/view immediately. */
		function ComposerEntry(props) {
			const sessionId = typeof props?.sessionId === "string" && props.sessionId !== "" ? props.sessionId : undefined;
			return h(SessionComposerEntry, { key: sessionId || "unbound", sessionId });
		}

		function SessionComposerEntry(props) {
			const sessionId = props.sessionId;
			const [open, setOpen] = React.useState(false);
			const [view, setView] = React.useState(null);
			const [error, setError] = React.useState(null);

			React.useEffect(() => {
				let live = true;
				let sequence = 0;
				const load = async () => {
					const current = ++sequence;
					try {
						const value = await call("get", { sessionId });
						if (!live || current !== sequence) return;
						setView(value);
						setError(null);
					} catch (reason) {
						if (live && current === sequence) setError(String(reason?.message || reason));
					}
				};
				load();
				const timer = setInterval(() => {
					if (document.visibilityState === "hidden") return;
					load();
				}, POLL_MS);
				return () => {
					live = false;
					clearInterval(timer);
				};
			}, [sessionId]);

			const teammate = isTeammateViewer(view, sessionId);
			const member = teammate ? ownMember(view, sessionId) : null;
			const emptyTeam = view !== null && !teammate && !error && !view.membersError
				&& !(view.members ?? []).some((row) => row?.role === "teammate");
			const label = view === null ? (error ? "队员 · 读取失败" : "队员 · 加载中…")
				: teammate ? `${memberWorkLabel(member)} · 当前队员：${memberModelLabel(member, view.catalog)}`
				: view.membersError ? "队员 · 读取失败" : emptyTeam ? "" : workingCountLabel(view);
			const state = teammate ? memberWorkDot(member)
				: (view?.members ?? []).some((row) => row?.role === "teammate" && row.status === "running") ? "ongoing" : "idle";
			return h("span", { className: "atm_entry" }, [
				h(Button, {
					key: "trigger",
					variant: "outline",
					size: "sm",
					className: emptyTeam ? "atm_trigger atm_triggerEmpty" : "atm_trigger",
					disabled: view === null,
					title: error ? `读取失败：${error}` : view === null ? "正在读取当前对话的队员信息"
						: teammate ? "查看当前队员自己的模型与推理强度（只读）" : emptyTeam ? "队员配置" : `${label}；查看团队与新建队员路由配置`,
					"aria-label": emptyTeam ? "队员配置" : label,
					"aria-haspopup": "dialog",
					"aria-expanded": open ? "true" : "false",
					icon: emptyTeam ? icon("IconUserOutline16", { size: 16 }) : h(StateDot, { state: error ? "error" : state, size: 8, className: "atm_dotIcon" }),
					onClick: () => setOpen(true)
				}, label),
				h(Modal, {
					key: "modal",
					open,
					onClose: () => setOpen(false),
					title: teammate ? "当前队员模型" : "队员模型",
					description: teammate ? "仅查看当前队员自己的模型、推理强度与状态。" : "新建队员使用的模型与推理强度，改动对下一个创建的队员生效。",
					closeLabel: "关闭",
					className: "atm_sheetCard",
					contentClassName: "atm_sheetContent"
				}, h(ModelConfig, { variant: "sheet", sessionId }))
			]);
		}

		/** Register the settings page and the composer entry. */
		function apply(ctx) {
			ensureStyle();
			// Unload/disable (and any non-HMR reload) must not leave the scaffold
			// stylesheet behind: the HMR driver removes it via data-plugin, this
			// disposer covers every other teardown path.
			if (typeof ctx.effect === "function") {
				ctx.effect(() => () => {
					document.getElementById(STYLE_ID)?.remove();
				}, "dsh-agent-team-model: scaffold stylesheet");
			}
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("settings.section", () => slots.register(
				{ name: "settings.section", id: "agent-team-model", order: 120, label: "队员模型" },
				() => h(Panel, { ctx })
			));
			slots.inject("conversation.input.right", () => slots.register(
				{ name: "conversation.input.right", id: "agent-team-model", order: 60, label: "队员模型" },
				ComposerEntry
			));
		}

		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
	}
});

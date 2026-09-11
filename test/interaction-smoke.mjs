// Interaction smoke test for the dsh-agent-team-model browser half.
//
// Renders the composer seat inside jsdom against a stubbed host API, opens the
// secondary surface, and asserts the editor's real content and semantics:
// the DSH primitives (Modal / Menu / Switch / Input / Button / StateDot) are
// what render, the grouping scaffold is present, the condensed dialog drops the
// settings-page-only rows, and the team section is scoped to the conversation:
// the Session id rides every request, the Lead is labelled 队长 on its own row
// above a divider, teammates follow, and an empty roster says 尚未创建队员.
//
// Requires a module base with react, react-dom, jsdom and
// @deepseek-ai/dsh-client-ui-primitives:
//   set ATM_TEST_MODULES=<dir with those packages>

import { readFile } from "node:fs/promises";
import { createRequire, register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// DSH's compiled primitives import `.module.css`; stub those for Node.
register("./css-stub-loader.mjs", import.meta.url);

/**
 * Resolve a test-only module from an explicit base, the cwd, or this file.
 * @param specifier - module to resolve.
 * @returns the resolved module.
 */
function resolveTestModule(specifier) {
	const bases = [];
	if (typeof process.env.ATM_TEST_MODULES === "string" && process.env.ATM_TEST_MODULES.length > 0) {
		bases.push(createRequire(pathToFileURL(join(process.env.ATM_TEST_MODULES, "noop.js"))));
	}
	bases.push(createRequire(pathToFileURL(join(process.cwd(), "noop.js"))));
	bases.push(createRequire(import.meta.url));
	const failures = [];
	for (const base of bases) {
		try {
			return base(specifier);
		} catch (error) {
			failures.push(error && error.message);
		}
	}
	throw new Error(`cannot resolve "${specifier}"; install it or set ATM_TEST_MODULES (${failures.join(" | ")})`);
}

const BUNDLE = process.argv[2];
if (BUNDLE === undefined) throw new Error("usage: node interaction-smoke.mjs <client.js>");

const SESSION = "session-demo";

const { JSDOM } = resolveTestModule("jsdom");
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true, writable: true });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = resolveTestModule("react");
const { createRoot } = resolveTestModule("react-dom/client");
const act = React.act ?? resolveTestModule("react-dom/test-utils").act;

/** The Lead row the host reports for the current conversation. */
const LEAD = { id: SESSION, name: "lead", role: "lead", status: "running", provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" };

const hostView = {
	config: {
		enabled: true,
		default: { provider: "deepseek-official", model: "deepseek-flash" },
		overrides: { researcher: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" } }
	},
	catalog: {
		providers: [{ id: "deepseek-official", name: "DeepSeek" }, { id: "openai-codex", name: "ChatGPT subscription" }],
		models: {
			"deepseek-official": [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash" }, { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }],
			"openai-codex": [{ id: "gpt-6-astra", name: "gpt-6-astra" }]
		},
		efforts: { "deepseek-official\u0000deepseek-flash": { efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }], defaultEffort: "high" } },
		error: null
	},
	members: [
		LEAD,
		{ id: "m1", name: "researcher", role: "teammate", status: "running", provider: "deepseek-official", model: "deepseek-v4-pro" }
	],
	recent: [
		{ at: Date.now() - 60000, name: "researcher", agentOptions: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" }, source: "override" },
		{ at: Date.now() - 600000, name: "scout", agentOptions: { provider: "deepseek-official", model: "deepseek-flash" }, source: "default" },
		{ at: Date.now() - 1200000, name: "archivist", agentOptions: { provider: "deepseek-official", model: "deepseek-flash" }, source: "default" },
		{ at: Date.now() - 1800000, name: "editor", agentOptions: { provider: "deepseek-official", model: "deepseek-flash" }, source: "default" }
	],
	statePath: "C:\\Users\\Administrator\\.dsh\\agent-team-model.json",
	effectiveDefault: { provider: "deepseek-official", model: "deepseek-flash" },
	hook: { installed: true, subagents: true, agentTeams: true, injections: 2, lastInjectionAt: Date.now() - 1000 }
};

/** Every JSON payload the browser half sent, in order. */
const requests = [];

globalThis.fetch = async (_url, options) => {
	const payload = JSON.parse(options.body);
	requests.push(payload);
	if (payload.method === "set") hostView.config = structuredClone(payload.config);
	const value = structuredClone(hostView);
	// The real host echoes the conversation it answered for; the stub must too,
	// otherwise the "no conversation bound" state is indistinguishable.
	value.sessionId = typeof payload.sessionId === "string" && payload.sessionId !== "" ? payload.sessionId : null;
	return { ok: true, status: 200, json: async () => ({ ok: true, value }) };
};

let registration;
globalThis.window.__ModuleLoader__ = { load(value) { registration = value; } };
const source = await readFile(BUNDLE, "utf8");
new Function(`${source}\n//# sourceURL=${BUNDLE}`)();

const clientExports = registration.factory((specifier) => {
	if (specifier === "react") return React;
	if (specifier === "react-dom") return resolveTestModule("react-dom");
	if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return resolveTestModule(specifier);
	throw new Error(`unexpected require("${specifier}")`);
});

const registered = [];

/** Minimal stand-in for the shell Session list the settings page reads. */
const sessionList = {
	current: SESSION,
	listeners: new Set(),
	getSnapshot: () => ({ current: sessionList.current }),
	subscribe(listener) {
		sessionList.listeners.add(listener);
		return () => sessionList.listeners.delete(listener);
	},
	switchTo(next) {
		sessionList.current = next;
		for (const listener of [...sessionList.listeners]) listener();
	}
};

/** Teardown functions the seats registered through `ctx.effect`. */
const effectDisposers = [];

clientExports.apply({
	get(name) {
		if (name === "sessions") return { list: sessionList };
		if (name !== "slots") return undefined;
		return { inject: (_slot, callback) => callback(), register: (descriptor, render) => registered.push({ descriptor, render }) };
	},
	effect(run) {
		const dispose = run();
		if (typeof dispose === "function") effectDisposers.push(dispose);
		return () => {};
	}
});

const seat = registered.find((entry) => entry.descriptor.name === "conversation.input.right");
if (seat === undefined) throw new Error("composer seat was not registered");

const failures = [];
const assert = (condition, label) => {
	console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
	if (!condition) failures.push(label);
};
const text = () => document.body.textContent ?? "";
/** Both editor seats omit internal history, its actions, and redundant scope copy. */
const assertCleanEditor = (label) => {
	const editor = document.querySelector(".atm_root");
	const content = editor?.textContent ?? "";
	assert(editor !== null, `${label}: editor is mounted`);
	assert(!content.includes("只显示当前对话所属的团队"), `${label}: default conversation scope needs no explanatory footer`);
	assert(!content.includes("最近注入的路由"), `${label}: internal injection history has no section`);
	assert(!content.includes("还没有队员按配置创建。"), `${label}: internal history has no empty placeholder`);
	assert(!content.includes("清空记录"), `${label}: internal history has no clear action`);
	assert(!content.includes("条记录，在设置页查看。"), `${label}: internal history has no overflow hint`);
	assert(!content.includes("scout") && !content.includes("archivist") && !content.includes("editor"), `${label}: history-only member names stay hidden`);
	assert(content.includes("重新读取"), `${label}: the useful reload action remains`);
};
/** The members list of the 当前对话的团队 group. */
const teamList = () => [...document.querySelectorAll("section.atm_group")]
	.find((section) => (section.querySelector("h3")?.textContent ?? "") === "当前对话的团队")
	?.querySelector(".atm_list") ?? null;

/**
 * Mount the composer seat for one Session and open its dialog.
 * @param sessionId - the Session id the shell hands the seat.
 * @returns the React root plus its container.
 */
async function openSheet(sessionId) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(React.createElement(() => seat.render({ sessionId })));
		await Promise.resolve();
	});
	const trigger = container.querySelector(".atm_trigger");
	await act(async () => {
		trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
	});
	return { root, container };
}

// ── conversation with the Lead plus one teammate ───────────────────────────
const first = await openSheet(SESSION);

assert(first.container.querySelector(".atm_trigger") !== null, "composer trigger renders through the DSH Button primitive");
assert((first.container.querySelector(".atm_trigger")?.textContent ?? "").trim() === "1/1 个队员正在工作", `leader trigger shows running / total teammates (got "${first.container.querySelector(".atm_trigger")?.textContent ?? ""}")`);
assert((first.container.querySelector(".atm_trigger")?.getAttribute("title") ?? "").includes("1/1 个队员正在工作"), "the trigger's accessible title states the working count");

assert(document.querySelector('[role="dialog"]') !== null, "secondary surface opens as a DSH Modal (role=dialog)");
assert(document.querySelector(".atm_sheetCard") !== null, "the dialog bounds itself through Modal's className seam");
assert(document.querySelector(".atm_sheetContent") !== null, "the dialog scrolls inside Modal's contentClassName seam");
assert(document.querySelector(".atm_sheetBody") !== null, "the sheet body runs denser than the settings page");
assert(first.container.querySelector(".atm_trigger")?.getAttribute("aria-expanded") === "true", "the trigger reports the open dialog state");
assert(text().includes("队员模型"), "dialog title present");
assert(text().includes("默认队员路由") && text().includes("按队员名覆盖"), "grouped sections present");
assert(text().includes("配置存储") === false, "condensed dialog drops the storage path");
assert(document.querySelector('[role="switch"]') !== null || text().includes("启用队员路由覆盖"), "enable toggle rendered by the Switch primitive");
assert(document.querySelector('input[placeholder*="队员名"]') !== null, "override name rendered by the Input primitive");

const pickers = [...document.querySelectorAll(".atm_picker")];
assert(pickers.length >= 6, `route pickers rendered per rule block (got ${pickers.length})`);

await act(async () => {
	pickers[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await Promise.resolve();
});
const menuItems = [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent ?? "");
assert(document.querySelector('[role="menu"]') !== null, "provider dropdown opens as a DSH Menu (role=menu)");
assert(menuItems.some((item) => item.includes("ChatGPT subscription")), `menu lists both providers (${menuItems.join(" | ")})`);
assert(menuItems.some((item) => item.includes("继承队长")), "menu offers the inherit option");
await act(async () => {
	[...document.querySelectorAll('[role="menuitem"]')].find(n => n.textContent.includes('ChatGPT subscription')).click();
	await Promise.resolve();
});
assert(document.querySelectorAll('.atm_picker')[0].textContent.includes('ChatGPT subscription'), 'provider survives save round trip before model is selected');
assert(!document.querySelectorAll('.atm_picker')[1].disabled, 'model picker remains enabled after changing provider');

// Complete the route so the editor autosaves, then inspect the write's scope.
await act(async () => {
	document.querySelectorAll(".atm_picker")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await Promise.resolve();
});
const modelItems = [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent ?? "");
assert(modelItems.some((item) => item.includes("gpt-6-astra")), `the model menu follows the chosen provider (${modelItems.join(" | ")})`);
await act(async () => {
	[...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent.includes("gpt-6-astra")).click();
	await Promise.resolve();
});

const reads = requests.filter((request) => request.method === "get");
assert(reads.length >= 1, `the seat reads the host view (${reads.length} get calls)`);
assert(reads.every((request) => request.sessionId === SESSION), `every read is scoped to the conversation (got ${JSON.stringify([...new Set(reads.map((request) => request.sessionId))])})`);
assert(requests.some((request) => request.method === "set" && request.sessionId === SESSION), "the autosave write is scoped to the conversation too");

assert(text().includes("当前对话的团队"), "team section is titled for the current conversation");
const leadRow = document.querySelector(".atm_leadRow");
assert(leadRow !== null, "the Lead sits on its own row");
const leadTag = leadRow?.querySelector(".atm_roleTag");
assert((leadTag?.textContent ?? "") === "队长", `the Lead row is labelled 队长 (got "${leadTag?.textContent ?? ""}")`);
assert(leadTag?.getAttribute("data-tone") === "info", "the 队长 label rides the shipped Tag primitive, not plugin-drawn chrome");
assert(leadTag?.getAttribute("data-atm-fallback") === null, "this primitives build takes the shipped Tag arm, not the fallback");
assert((leadRow?.textContent ?? "").includes("当前对话 · 运行中"), "the Lead row states that it is this conversation and its status");
assert((leadRow?.textContent ?? "").includes("deepseek-official / deepseek-flash · high"), `the Lead row shows its live route (got "${leadRow?.textContent ?? ""}")`);

const rows = [...(teamList()?.children ?? [])];
const at = (predicate) => rows.findIndex(predicate);
const leadAt = at((node) => node.classList.contains("atm_leadRow"));
const dividerAt = at((node) => node.classList.contains("atm_divider"));
const teammateAt = at((node) => node.textContent.includes("researcher"));
assert(leadAt !== -1 && dividerAt === leadAt + 1, "a divider separates the Lead from the teammates");
assert((rows[dividerAt]?.textContent ?? "").includes("队员 · 1"), `the divider counts the teammates (got "${rows[dividerAt]?.textContent ?? ""}")`);
assert(teammateAt > dividerAt, "teammates render below the divider");
assertCleanEditor("sheet with history");
assert(text().includes("尚未创建队员") === false, "a conversation with teammates does not claim an empty roster");
assert(text().includes("注入接缝") === false, "a host that has injected before raises no seam warning");

assert(text().includes("researcher") && text().includes("deepseek-v4-pro"), "member row shows the live route");
await act(async () => {
	[...document.querySelectorAll('[role="dialog"] button')].find((node) => node.textContent.trim() === "重新读取").click();
	await Promise.resolve();
});
assert(requests.at(-1)?.method === "get" && requests.at(-1)?.sessionId === SESSION, "reload still reads only the current conversation");
assert(requests.every((request) => request.method !== "clear-recent"), "the editor never clears internal history");

const css = document.getElementById("agent-team-model-style")?.textContent ?? "";
assert(document.getElementById("agent-team-model-style")?.getAttribute("data-plugin") === "dsh-agent-team-model", "the injected stylesheet declares its HMR owner, so a hot-swap cannot leave stale CSS behind");
assert(css.includes(".atm_select") === false, "plugin no longer hand-rolls its own select styling");
assert(css.includes("appearance:none") === false, "plugin no longer overrides native control appearance");
// The plugin may only style its own selectors: nothing may target a shipped
// class (shipped class names never start with atm_). Comments carry prose, so
// strip them before looking at selectors.
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");
const injectedSelectors = [...cssRules.matchAll(/[^{}]+\{/g)]
	.map((match) => match[0].slice(0, -1).trim())
	.filter((selector) => !selector.startsWith("@"));
const foreign = injectedSelectors.find((selector) => selector.split(",").some((part) => !part.trim().startsWith(".atm_")));
assert(foreign === undefined, `every injected selector stays plugin-scoped (foreign: ${JSON.stringify(foreign ?? "none")})`);
assert(css.includes(".atm_sheetCard") && css.includes(".atm_sheetContent"), "the sheet seams are declared in the plugin stylesheet");
assert(source.includes('require("@deepseek-ai/dsh-client-ui-primitives")'), "bundle consumes the DSH primitives module");
assert(source.includes('document.visibilityState === "hidden"'), "both pollers skip their tick while the tab is hidden");

await act(async () => {
	first.root.unmount();
});
first.container.remove();

// ── conversation whose Lead has not spawned a teammate yet ─────────────────
hostView.members = [LEAD];
const savedRecent = hostView.recent;
hostView.recent = [];
const second = await openSheet(SESSION);
assertCleanEditor("sheet without history");
assert(second.container.querySelector(".atm_trigger")?.textContent.trim() === "", "an empty team shows only a small-person icon");
assert(second.container.querySelector(".atm_trigger")?.getAttribute("aria-label") === "队员配置", "icon-only entry retains an accessible name");
assert(second.container.querySelector(".atm_trigger svg") !== null, "empty-team entry renders the native person icon");

assert(text().includes("当前对话的团队"), "empty-roster conversation still shows the team section");
assert(text().includes("尚未创建队员"), "empty roster is stated explicitly");
assert(document.querySelector(".atm_leadRow") !== null, "the Lead row is still shown for an empty roster");
assert([...document.querySelectorAll(".atm_divider")].some((node) => (node.textContent ?? "") === "队员"), "the 队员 caption still separates the empty roster");

await act(async () => {
	second.root.unmount();
});
second.container.remove();
hostView.recent = savedRecent;

// ── host that cannot read the roster at all ────────────────────────────────
hostView.members = [];
hostView.membersError = "the roster read failed: boom";
const third = await openSheet(SESSION);

assert(text().includes("无法读取当前对话的团队"), "an unreadable roster says so");
assert(text().includes("boom"), "the unreadable-roster row carries the host's reason");
assert(text().includes("尚未创建队员") === false, "an unreadable roster does not make the false empty claim");

await act(async () => {
	third.root.unmount();
});
third.container.remove();
delete hostView.membersError;

// ── installed hook that never fired while teammates exist ──────────────────
hostView.members = [LEAD, { id: "m1", name: "researcher", role: "teammate", status: "running", provider: "deepseek-official", model: "deepseek-v4-pro" }];
hostView.hook = { installed: true, subagents: true, agentTeams: true, injections: 0, lastInjectionAt: null };
const fourth = await openSheet(SESSION);

assert(text().includes("注入接缝") === false, "zero injection history after restart is not a broken-hook warning");
assert(text().includes("researcher"), "existing teammates remain visible without in-memory injection history");

await act(async () => {
	fourth.root.unmount();
});
fourth.container.remove();

// ── profile without the official Agent Teams layer ─────────────────────────
// The missing prerequisite must be named, not reported as a plain seam gap: the
// plugin configures teammate routes, teammates come from the upstream layer.
hostView.members = [];
hostView.hook = { installed: false, subagents: true, agentTeams: false };
const noUpstream = await openSheet(SESSION);

assert(text().includes("@deepseek-ai/dsh-experimental-agent-team-profile"), "a profile without the Agent Teams layer is told which package to install");
assert(text().includes("重启 DSH 宿主后再看") === false, "the missing upstream is not reported as a plain restart symptom");

await act(async () => {
	noUpstream.root.unmount();
});
noUpstream.container.remove();
hostView.hook = { installed: true, subagents: true, agentTeams: true, injections: 2, lastInjectionAt: Date.now() - 1000 };

// ── older host that reports neither membersError nor injection counters ────
// This is exactly the shape the currently mounted host half answers with, so the
// browser half must degrade quietly instead of warning about a seam it cannot see.
hostView.members = [LEAD, { id: "m1", name: "researcher", role: "teammate", status: "running", provider: "deepseek-official", model: "deepseek-v4-pro" }];
hostView.hook = { installed: true, subagents: true, agentTeams: true };
const fifth = await openSheet(SESSION);

assert(text().includes("researcher"), "a host without the new view fields still renders its roster");
assert(text().includes("注入接缝") === false, "a host that reports no injection counter raises no seam warning");
assert(text().includes("无法读取当前对话的团队") === false, "a host that reports no roster error keeps the normal empty/roster copy");

await act(async () => {
	fifth.root.unmount();
});
fifth.container.remove();
hostView.hook = { installed: true, subagents: true, agentTeams: true, injections: 2, lastInjectionAt: Date.now() - 1000 };

// ── no bound conversation: no roster claim or internal history controls ─────
hostView.members = [];
const unbound = await openSheet(undefined);
assertCleanEditor("unbound sheet");
assert(text().includes("尚未选择对话"), "with no conversation bound the section asks for a selection");
assert(text().includes("尚未创建队员") === false, "with no conversation bound it does not claim an empty roster");
await act(async () => {
	unbound.root.unmount();
});
unbound.container.remove();
hostView.members = [LEAD, { id: "m1", name: "researcher", role: "teammate", status: "running", provider: "deepseek-official", model: "deepseek-v4-pro" }];

// ── primitives build without Tag: the 队长 marker degrades to a marked span ─
const fallbackSeats = [];
const fallbackExports = registration.factory((specifier) => {
	if (specifier === "react") return React;
	if (specifier === "react-dom") return resolveTestModule("react-dom");
	if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
		return new Proxy(resolveTestModule(specifier), { get: (target, key) => (key === "Tag" ? undefined : target[key]) });
	}
	throw new Error(`unexpected require("${specifier}")`);
});
fallbackExports.apply({
	get(name) {
		if (name === "sessions") return { list: sessionList };
		if (name !== "slots") return undefined;
		return { inject: (_slot, callback) => callback(), register: (descriptor, render) => fallbackSeats.push({ descriptor, render }) };
	}
});
const fallbackSeat = fallbackSeats.find((entry) => entry.descriptor.name === "conversation.input.right");
if (fallbackSeat === undefined) throw new Error("the no-Tag build did not register the composer seat");
const fallbackContainer = document.createElement("div");
document.body.appendChild(fallbackContainer);
const fallbackRoot = createRoot(fallbackContainer);
await act(async () => {
	fallbackRoot.render(React.createElement(fallbackSeat.render, { sessionId: SESSION }));
	await Promise.resolve();
});
await act(async () => {
	fallbackContainer.querySelector(".atm_trigger").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await Promise.resolve();
});
const fallbackTag = document.querySelector('[role="dialog"] [data-atm-fallback="tag"]');
assert((fallbackTag?.textContent ?? "") === "队长", `a primitives build without Tag still labels the Lead (got "${fallbackTag?.textContent ?? ""}")`);
assert(fallbackTag?.getAttribute("data-tone") === "info", "the no-Tag fallback keeps the primitive's observable contract");
await act(async () => {
	fallbackRoot.unmount();
});
fallbackContainer.remove();

// ── settings page follows the shell's current Session ─────────────────────
const settingsSeat = registered.find((entry) => entry.descriptor.name === "settings.section");
if (settingsSeat === undefined) throw new Error("settings seat was not registered");

hostView.members = [LEAD];
sessionList.current = "session-settings";
const settingsContainer = document.createElement("div");
document.body.appendChild(settingsContainer);
const settingsRoot = createRoot(settingsContainer);
await act(async () => {
	settingsRoot.render(React.createElement(settingsSeat.render, { close: () => {} }));
	await Promise.resolve();
	await Promise.resolve();
});
assert(requests.at(-1)?.method === "get" && requests.at(-1)?.sessionId === "session-settings", `the settings page reads the shell's current Session (got ${JSON.stringify(requests.at(-1)?.sessionId)})`);
assertCleanEditor("settings with history");
hostView.recent = [];

await act(async () => {
	sessionList.switchTo("session-other");
	await Promise.resolve();
	await Promise.resolve();
});
assert(requests.at(-1)?.sessionId === "session-other", `the settings page follows a Session switch (got ${JSON.stringify(requests.at(-1)?.sessionId)})`);
assertCleanEditor("settings without history");

await act(async () => {
	settingsRoot.unmount();
});
settingsContainer.remove();

// ── teardown: the scaffold stylesheet does not outlive the plugin ──────────
assert(effectDisposers.length >= 1, "apply() registers a stylesheet teardown through ctx.effect");
assert(document.getElementById("agent-team-model-style") !== null, "the stylesheet is still present before teardown");
effectDisposers[0]();
assert(document.getElementById("agent-team-model-style") === null, "the teardown removes the plugin's stylesheet");

console.log(failures.length === 0 ? "ALL OK" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);

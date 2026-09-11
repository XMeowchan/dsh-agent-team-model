// Viewer isolation and stale-request regression coverage; host is entirely stubbed.
// Run: ATM_TEST_MODULES=<module base> node test/viewer-smoke.mjs lib/client.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
register("./css-stub-loader.mjs", import.meta.url);

function dependency(id) {
	for (const base of [process.env.ATM_TEST_MODULES, process.cwd()].filter(Boolean)) {
		try { return createRequire(pathToFileURL(join(base, "noop.js")))(id); } catch {}
	}
	return createRequire(import.meta.url)(id);
}
const { JSDOM } = dependency("jsdom");
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = dependency("react");
const { createRoot } = dependency("react-dom/client");
const act = React.act ?? dependency("react-dom/test-utils").act;

const LEAD_ID = "leader-session";
const CHILD_ID = "child-session";
const LEAD = { id: LEAD_ID, role: "lead", name: "private-leader", status: "running", provider: "p", model: "parent-only-model" };
const OWN = { id: CHILD_ID, role: "teammate", name: "my-researcher", status: "inactive", provider: "p", model: "child-model", reasoningEffort: "high", routeSource: "persisted-descriptor" };
const SIBLING = { id: "sibling", role: "teammate", name: "private-sibling", status: "running", provider: "p", model: "sibling-only-model" };
const REASON = "当前 DSH 禁止热修改 Provider 管理的可恢复队员模型和推理强度。";
const catalog = {
	providers: [{ id: "p", name: "Provider" }],
	models: { p: [{ id: "child-model", name: "Own Model Label" }, { id: "parent-only-model", name: "Parent Model Label" }] },
	efforts: { "p\u0000child-model": { efforts: [{ id: "high", name: "High" }], defaultEffort: "low" } },
	error: null
};
const leaderView = {
	sessionId: LEAD_ID, viewer: { role: "lead", memberId: LEAD_ID, rootId: LEAD_ID, canEditModel: false, modelEditReason: REASON },
	config: { enabled: true, default: { provider: "p", model: "parent-only-model" }, overrides: {} },
	effectiveDefault: { provider: "p", model: "parent-only-model" }, catalog,
	members: [LEAD, OWN, SIBLING, { id: "idle", role: "teammate", name: "idle-member", status: "idle", routeSource: "unknown" }],
	recent: [{ at: Date.now(), name: "private-history", source: "default", agentOptions: { provider: "p", model: "parent-only-model" } }],
	hook: { installed: true, injections: 0 }
};
const childView = {
	sessionId: CHILD_ID, viewer: { role: "teammate", memberId: CHILD_ID, rootId: LEAD_ID, canEditModel: false, modelEditReason: REASON },
	config: null, effectiveDefault: null, recent: [], catalog, members: [OWN], hook: { installed: true, injections: 0 }
};
const views = new Map([[LEAD_ID, leaderView], [CHILD_ID, childView]]);
const requests = [];
const pending = [];
let hold = () => false;
globalThis.fetch = async (_url, options) => {
	const request = JSON.parse(options.body);
	requests.push(request);
	assert.ok(["get", "set", "clear-recent"].includes(request.method), `unexpected host action ${request.method}`);
	const value = structuredClone(views.get(request.sessionId));
	assert.ok(value, `missing fixture for ${request.sessionId}`);
	const response = { ok: true, status: 200, json: async () => ({ ok: true, value }) };
	if (hold(request)) return new Promise((resolve, reject) => pending.push({ request, resolve: () => resolve(response), reject }));
	return response;
};

let module;
window.__ModuleLoader__ = { load(value) { module = value; } };
const bundle = process.argv[2] || "lib/client.js";
new Function(await readFile(bundle, "utf8"))();
const client = module.factory(dependency);
const seats = [];
const sessions = {
	current: LEAD_ID, listeners: new Set(),
	getSnapshot() { return { current: this.current }; },
	subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
	switchTo(id) { this.current = id; for (const listener of this.listeners) listener(); }
};
client.apply({ get(name) {
	if (name === "sessions") return { list: sessions };
	if (name === "slots") return { inject: (_slot, fn) => fn(), register: (descriptor, render) => seats.push({ descriptor, render }) };
} });
const composer = seats.find((seat) => seat.descriptor.name === "conversation.input.right").render;
const settings = seats.find((seat) => seat.descriptor.name === "settings.section").render;
const body = () => document.body.textContent || "";
const dialog = () => document.querySelector('[role="dialog"]');
const trigger = () => document.querySelector(".atm_trigger");
const button = (label) => [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
async function click(node) {
	assert.ok(node, "expected clickable control");
	await act(async () => { node.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
}
async function mount(Component, sessionId) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const mounted = {
		async switchTo(id) { await act(async () => { root.render(React.createElement(Component, { sessionId: id })); }); },
		async close() { await act(async () => root.unmount()); container.remove(); }
	};
	await mounted.switchTo(sessionId);
	return mounted;
}
async function settlePending(reject = false) {
	const jobs = pending.splice(0);
	await act(async () => { for (const job of jobs) reject ? job.reject(new Error("stale failure")) : job.resolve(); });
}
function assertOwnOnly(label) {
	assert.match(body(), /当前队员模型/, `${label}: distinct teammate title`);
	assert.match(body(), /my-researcher/, `${label}: own name`);
	assert.match(body(), /Own Model Label/, `${label}: catalog model label`);
	assert.match(body(), /high/, `${label}: actual effort, not catalog default`);
	assert.match(body(), /待机\/未委派任务/, `${label}: resumable status`);
	assert.doesNotMatch(body(), /默认队员路由|按队员名覆盖|当前对话的团队|最近注入的路由|配置存储|启用队员路由覆盖|清空记录|保存/,
		`${label}: no global editor, roster, history, or mutation action`);
	assert.doesNotMatch(body(), /private-leader|private-sibling|private-history|parent-only-model|Parent Model Label|sibling-only-model/,
		`${label}: no parent, sibling, or history data`);
	assert.equal(document.querySelectorAll('.atm_picker, input, select, [role="switch"]').length, 0, `${label}: no fake editable controls`);
}

// Leader: count durable completed work across teammates; retained routes aren't seam failures.
let mounted = await mount(composer, LEAD_ID);
assert.equal(trigger().textContent.trim(), "0/3 个队员已完成");
await click(trigger());
assert.doesNotMatch(body(), /注入接缝|没有记录到任何路由注入/);
const persistedRow = [...document.querySelectorAll(".atm_row")].find((row) => row.textContent.includes("my-researcher"));
assert.match(persistedRow.textContent, /待机\/未委派任务/);
assert.match(persistedRow.querySelector(".atm_rowValue").title, /保存|持久化/);
const unknownRow = [...document.querySelectorAll(".atm_row")].find((row) => row.textContent.includes("idle-member"));
assert.match(unknownRow.textContent, /尚未获取模型/);
assert.doesNotMatch(unknownRow.textContent, /parent-only-model/);
await mounted.close();
views.set(LEAD_ID, { ...leaderView, members: [LEAD] });
mounted = await mount(composer, LEAD_ID);
assert.equal(trigger().textContent.trim(), "", "no teammates: icon only, no 0/0 text");
assert.equal(trigger().getAttribute("aria-label"), "队员配置");
assert.equal(trigger().getAttribute("title"), "队员配置");
assert.ok(trigger().querySelector("svg"), "native small-person icon is visible");
assert.equal(trigger().querySelector("svg").getAttribute("width"), "16");
await click(trigger());
assert.match(body(), /默认队员路由/, "icon still opens the leader config panel");
await mounted.close();
views.set(LEAD_ID, { ...leaderView, members: [...leaderView.members, { id: "new", role: "teammate", status: "provisioning" }] });
mounted = await mount(composer, LEAD_ID);
assert.equal(trigger().textContent.trim(), "0/4 个队员已完成", "provisioning increases total, not completed numerator");
await mounted.close();
views.set(LEAD_ID, leaderView);
console.log("PASS leader count and persisted/unknown routes");

// New host's deliberately null config cannot become an editable default draft.
const childStart = requests.length;
mounted = await mount(composer, CHILD_ID);
assert.equal(trigger().textContent.trim(), "待机/未委派任务 · 当前队员：Own Model Label");
await click(trigger());
assertOwnOnly("teammate Modal");
assert.ok(body().includes(REASON));
assert.match(body(), /只读/);
await click(button("重新读取"));
assertOwnOnly("teammate reload");
assert.ok(requests.slice(childStart).every((request) => request.method === "get" && request.sessionId === CHILD_ID));
await mounted.close();
console.log("PASS isolated read-only teammate with config:null");

// Completion (idle or cold) changes only status, never the teammate identity/model panel.
for (const status of ["idle", "inactive"]) {
	views.set(CHILD_ID, { ...childView, members: [{ ...OWN, status, workState: "completed" }] });
	mounted = await mount(composer, CHILD_ID);
	assert.equal(trigger().textContent.trim(), "任务已完成 · 当前队员：Own Model Label");
	await click(trigger());
	assert.match(body(), /当前队员模型/);
	assert.match(dialog().textContent, /已完成/);
	assert.doesNotMatch(body(), /默认队员路由|按队员名覆盖|private-leader/);
	await mounted.close();
}
views.set(CHILD_ID, { ...childView, members: [{ ...OWN, status: "running", workState: "completed" }] });
mounted = await mount(composer, CHILD_ID);
assert.equal(trigger().textContent.trim(), "正在执行任务 · 当前队员：Own Model Label", "new running turn overrides prior completed metadata");
await mounted.close();
views.set(CHILD_ID, childView);
console.log("PASS completed teammate keeps own model identity and isolated panel");

// Legacy host may send full team/global data: exact self-row inference still hides all of it.
views.set(CHILD_ID, { ...leaderView, sessionId: CHILD_ID, viewer: undefined });
mounted = await mount(composer, CHILD_ID);
assert.equal(trigger().textContent.trim(), "待机/未委派任务 · 当前队员：Own Model Label");
await click(trigger());
assertOwnOnly("legacy teammate");
assert.match(body(), /不支持|禁止/);
await mounted.close();
// Explicit role wins over legacy inference; a nonmatching row never implies a child.
views.set(LEAD_ID, { ...leaderView, viewer: undefined });
mounted = await mount(composer, LEAD_ID);
assert.equal(trigger().textContent.trim(), "0/3 个队员已完成");
await mounted.close();
views.set(CHILD_ID, { ...leaderView, sessionId: CHILD_ID, viewer: { role: "lead" } });
mounted = await mount(composer, CHILD_ID);
assert.equal(trigger().textContent.trim(), "0/3 个队员已完成");
await mounted.close();
views.set(LEAD_ID, leaderView);
views.set(CHILD_ID, { ...childView, members: [{ ...OWN, model: LEAD.model, reasoningEffort: null, routeSource: "unavailable" }], effectiveDefault: leaderView.effectiveDefault });
mounted = await mount(composer, CHILD_ID);
assert.equal(trigger().textContent.trim(), "待机/未委派任务 · 当前队员：尚未获取模型");
await click(trigger());
assert.match(body(), /尚未获取模型/);
assert.doesNotMatch(body(), /parent-only-model|Parent Model Label|Own Model Label/);
await mounted.close();
views.set(CHILD_ID, childView);
console.log("PASS legacy role inference and unknown own route");

// Existing component instance switches sessions while each kind of old request is pending.
for (const method of ["get", "set"]) {
	mounted = await mount(composer, LEAD_ID);
	await click(trigger());
	hold = (request) => request.sessionId === LEAD_ID && request.method === method;
	if (method === "get") await click(button("重新读取"));
	if (method === "set") await click(document.querySelector('[role="switch"]'));
	assert.ok(pending.some((job) => job.request.method === method), `deferred ${method}`);
	const switchStart = requests.length;
	await mounted.switchTo(CHILD_ID);
	assert.equal(dialog(), null, "switch closes the old conversation's dialog");
	assert.equal(trigger().textContent.trim(), "待机/未委派任务 · 当前队员：Own Model Label");
	await click(trigger());
	assertOwnOnly(`switch during ${method}`);
	hold = () => false;
	await settlePending();
	assertOwnOnly(`late ${method} result`);
	assert.ok(requests.slice(switchStart).every((request) => request.method === "get" && request.sessionId === CHILD_ID), `old ${method} cannot write under child session`);
	await mounted.switchTo(LEAD_ID);
	assert.equal(dialog(), null);
	assert.equal(trigger().textContent.trim(), "0/3 个队员已完成");
	await mounted.close();
}
assert.ok(requests.every((request) => request.method !== "clear-recent"), "internal history has no clear action");
console.log("PASS dialog session switch fences reload/save responses");

// Initial old reads arrive after a new Session, including a rejected stale request.
hold = (request) => request.sessionId === LEAD_ID;
mounted = await mount(composer, LEAD_ID);
await mounted.switchTo(CHILD_ID);
await click(trigger());
hold = () => false;
await settlePending(true);
assertOwnOnly("late failed initial request");
await mounted.close();

// Root settings also discard the old editable view immediately, before child reads resolve.
sessions.current = LEAD_ID;
mounted = await mount(settings);
assert.match(body(), /默认队员路由/);
hold = (request) => request.method === "get";
await click(button("重新读取"));
await act(async () => sessions.switchTo(CHILD_ID));
assert.doesNotMatch(body(), /默认队员路由|按队员名覆盖|private-leader|private-sibling|parent-only-model/);
assert.equal(document.querySelector('[role="switch"]'), null);
hold = () => false;
await settlePending();
assertOwnOnly("selected-child settings");
await mounted.close();
assert.equal(pending.length, 0);
assert.ok(requests.filter((request) => request.sessionId === CHILD_ID).every((request) => request.method === "get"), "every teammate request is read-only");
console.log("PASS root settings session isolation and stale read rejection");

// Rapid full-document edits are serialized. A slow first host write must finish
// before the newer selection is sent, so it can never commit after that selection.
mounted = await mount(composer, LEAD_ID);
await click(trigger());
const saveStart = requests.length;
let heldFirstSave = false;
hold = (request) => {
	if (request.method !== "set" || heldFirstSave) return false;
	heldFirstSave = true;
	return true;
};
await click(document.querySelector('[role="switch"]'));
await click(document.querySelector('[role="switch"]'));
assert.equal(requests.slice(saveStart).filter((request) => request.method === "set").length, 1,
	"a newer autosave waits while the previous full-config write is pending");
hold = () => false;
await settlePending();
await act(async () => { await Promise.resolve(); await Promise.resolve(); });
const orderedSaves = requests.slice(saveStart).filter((request) => request.method === "set");
assert.equal(orderedSaves.length, 2, "the queued latest autosave is sent after the first settles");
assert.deepEqual(orderedSaves.map((request) => request.config.enabled), [false, true],
	"serialized autosaves preserve edit order through host commit order");
await mounted.close();
console.log("PASS autosaves commit in edit order");
console.log("ALL OK");
dom.window.close();

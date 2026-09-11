// Host-half test for the conversation-scoped Team roster and the injection ring.
//
// The browser half asks the host for "the Team of this conversation"; the host
// must answer with exactly that conversation's roster (Lead row first, its
// teammates after) and never leak another conversation's team. This test drives
// the real host module with a stub Agent/Agent Teams world — no DSH host needed —
// and covers the roster helper, the per-conversation "recent injections" ring,
// and the mounted HTTP handler (trust fence + payload shapes) end to end.
//
//   node host-members.mjs

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readMembers, readView, apply } from "../lib/index.js";

// Hermetic state: a temp DSH home whose stored config has a default route and
// one named override, so route injection can actually fire in this test.
const STATE_HOME = mkdtempSync(join(tmpdir(), "atm-host-test-"));
process.on("exit", () => rmSync(STATE_HOME, { recursive: true, force: true }));
writeFileSync(join(STATE_HOME, "agent-team-model.json"), JSON.stringify({
	enabled: true,
	// Match the Lead provider/model but deliberately choose the model's default effort.
	default: { provider: "deepseek-official", model: "deepseek-flash" },
	overrides: { editor: { provider: "openai-codex", model: "gpt-6-astra" } }
}), "utf8");
process.env.DSH_HOME = STATE_HOME;

const failures = [];
const assert = (condition, label) => {
	console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
	if (!condition) failures.push(label);
};

/** One live Agent stub with a last-request route. */
function agent(id, status, route) {
	return {
		id,
		status,
		options: { provider: route.provider, model: route.model },
		session: { requestHeader: () => ({ config: route }) }
	};
}

const ROUTE_A = { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" };
const ROUTE_B = { provider: "openai-codex", model: "gpt-6-astra" };

const agentsById = new Map([
	["session-a", agent("session-a", "running", ROUTE_A)],
	["session-b", agent("session-b", "idle", ROUTE_B)],
	["session-sub", agent("session-sub", "idle", ROUTE_A)],
	["tm-a1", agent("tm-a1", "running", { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" })],
	["tm-a2", agent("tm-a2", "idle", { provider: "deepseek-official", model: "deepseek-flash" })],
	["tm-b1", agent("tm-b1", "running", ROUTE_B)]
]);

/** Roster rows per Lead id: teammates carry their spawn kind in `provider`. */
const rosters = new Map([
	["session-a", [
		{ id: "tm-a1", name: "researcher", role: "teammate", status: "running", provider: "spawn", context: "fresh", model: "deepseek-v4-pro", diagnostics: [] },
		{ id: "tm-a2", name: "scout", role: "teammate", status: "idle", provider: "fork", model: "deepseek-flash", diagnostics: [] }
	]],
	["session-b", [
		{ id: "tm-b1", name: "editor", role: "teammate", status: "running", provider: "spawn", context: "fresh", model: "gpt-6-astra", diagnostics: [] }
	]]
]);

const agents = { get: (id) => agentsById.get(id), list: () => [...agentsById.values()] };

const teams = {
	// Every ordinary session Agent is a Lead; a provider-owned subagent is not.
	tryMembership: (value) => (value.id === "session-sub"
		? undefined
		: { root: value, id: `team-${value.id}`, role: "lead", name: "lead" }),
	listMembers: (root) => [
		{ id: root.id, name: "lead", role: "lead", status: root.status, model: root.options.model, diagnostics: [] },
		...(rosters.get(root.id) ?? [])
	]
};

const llm = {
	listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
	listModels: async () => [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash" }],
	resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "high", name: "High" }], defaultEffort: "high" } })
};

const services = { agents, agentTeams: teams, llm, subagents: { startContinuable: (spec) => spec } };
const ctx = { get: (service) => services[service] };

const idsOf = (rows) => rows.map((row) => row.id);

// ── roster helper ──────────────────────────────────────────────────────────
const aRoster = await readMembers(ctx, "session-a");
assert(aRoster.error === null && JSON.stringify(idsOf(aRoster.members)) === JSON.stringify(["session-a", "tm-a1", "tm-a2"]), `conversation A lists its Lead first, then its teammates (got ${JSON.stringify(idsOf(aRoster.members))}, error ${JSON.stringify(aRoster.error)})`);
assert(aRoster.members[0].role === "lead" && aRoster.members[0].name === "lead", "the first row is the Lead pseudo-row");
assert(aRoster.members.slice(1).every((row) => row.role === "teammate"), "every following row is a teammate");

const bRoster = await readMembers(ctx, "session-b");
assert(bRoster.error === null && JSON.stringify(idsOf(bRoster.members)) === JSON.stringify(["session-b", "tm-b1"]), `conversation B lists only its own team (got ${JSON.stringify(idsOf(bRoster.members))})`);
assert(aRoster.members.every((row) => !idsOf(bRoster.members).includes(row.id)) && bRoster.members.every((row) => !idsOf(aRoster.members).includes(row.id)), "no conversation sees another conversation's rows");

assert((await readMembers(ctx, undefined)).members.length === 0 && (await readMembers(ctx, undefined)).error === null, "no Session id means no roster and no error");
assert((await readMembers(ctx, "")).members.length === 0, "an empty Session id means no roster");
assert((await readMembers(ctx, "missing")).members.length === 0 && (await readMembers(ctx, "missing")).error === null, "a Session that is not live means no roster and no error");
assert((await readMembers(ctx, "session-sub")).members.length === 0 && (await readMembers(ctx, "session-sub")).error === null, "a provider-owned subagent Session legitimately has no Team roster");

const noTeams = { get: (service) => (service === "agents" ? agents : undefined) };
const movedTeams = await readMembers(noTeams, "session-a");
assert(movedTeams.members.length === 0 && typeof movedTeams.error === "string", `a host without the Agent Teams face reports an error, not a false empty roster (got ${JSON.stringify(movedTeams.error)})`);

// ── route enrichment ───────────────────────────────────────────────────────
const leadRow = aRoster.members[0];
assert(leadRow.provider === "deepseek-official" && leadRow.model === "deepseek-flash" && leadRow.reasoningEffort === "high", `the Lead row carries its live route (got ${JSON.stringify({ provider: leadRow.provider, model: leadRow.model, reasoningEffort: leadRow.reasoningEffort })})`);
assert(leadRow.routeSource === "last-request", "the Lead row records where its route came from");
const teammateRow = aRoster.members[1];
assert(teammateRow.provider === "deepseek-official" && teammateRow.model === "deepseek-v4-pro", `a teammate row carries its live route (got ${JSON.stringify({ provider: teammateRow.provider, model: teammateRow.model })})`);
assert(teammateRow.backend === "spawn" && teammateRow.context === "fresh", "a teammate row keeps the continuation backend and context apart from the LLM provider");
assert(teammateRow.routeSource === "last-request", "a teammate row records where its route came from");

// ── API payload ────────────────────────────────────────────────────────────
const view = await readView(ctx, "session-a");
assert(view.sessionId === "session-a", "the payload echoes the conversation it answered for");
assert(JSON.stringify(idsOf(view.members)) === JSON.stringify(["session-a", "tm-a1", "tm-a2"]), "the payload members are the conversation's own roster");
assert(view.membersError === null, "a readable roster reports no error");
assert(Array.isArray(view.members) && view.members !== aRoster.members, "the payload builds its own row array instead of reusing the probe's");
assert((view.catalog.providers ?? []).length === 1, "the payload still ships the model catalog");
assert(view.hook.agentTeams === true, "the payload still reports the hook state");
assert(view.hook.injections === 0 && view.hook.lastInjectionAt === null, `a host that never injected reports zero evidence (got ${JSON.stringify({ injections: view.hook.injections, lastInjectionAt: view.hook.lastInjectionAt })})`);

// ── mounted handler: injection ring, trust fence, payload shapes ───────────
let handler;
const hostCtx = {
	inject: (_names, callback) => callback({
		get: (service) => services[service],
		logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		effect: (run) => {
			run();
			return () => {};
		}
	}),
	effect: (run) => {
		run();
		return () => {};
	},
	get: (service) => services[service],
	webServer: { register: (route) => {
		handler = route.handler;
		return () => {};
	} },
	webRuntime: { trustedHosts: [] }
};
apply(hostCtx);
assert(typeof handler === "function", "apply() mounts the JSON API route");

/**
 * Call the mounted handler with one JSON body.
 * @param body - request payload.
 * @param host - Host header value.
 * @returns `{status, json}` captured from the response stub.
 */
async function post(body, host = "127.0.0.1:3080") {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = "POST";
	req.headers = { host, "content-type": "application/json" };
	let status = 0;
	let text = "";
	const res = {
		writeHead: (code) => {
			status = code;
		},
		end: (chunk) => {
			text = chunk ?? "";
		}
	};
	await handler(req, res);
	return { status, json: text === "" ? null : JSON.parse(text) };
}

// Drive one teammate spawn through the wrapped continuation seam: conversation A.
const original = services.subagents.startContinuable;
const started = original({ childId: "tm-a1", request: { parent: agentsById.get("session-a"), context: "fresh" } });
assert(started.request.agentOptions !== undefined, "the route hook injects agentOptions into a teammate spawn");
assert(started.request.agentOptions.provider === "deepseek-official" && started.request.agentOptions.model === "deepseek-flash", `the injected route is the configured default (got ${JSON.stringify(started.request.agentOptions)})`);
assert(Object.hasOwn(started.request.agentOptions, "reasoningEffort") && started.request.agentOptions.reasoningEffort === undefined,
	"model-default effort explicitly clears a matching Lead effort in the child resolver");

const aView = (await post({ method: "get", sessionId: "session-a" })).json.value;
assert(aView.recent.length === 1 && aView.recent[0].name === "researcher", `conversation A sees its own injection history (got ${JSON.stringify(aView.recent.map((entry) => entry.name))})`);
assert(aView.recent[0].source === "default", "a teammate with no override is recorded as default-routed");
const bView = (await post({ method: "get", sessionId: "session-b" })).json.value;
assert(bView.recent.length === 0, "conversation B does not see conversation A's injection history");

// A named override wins, and is recorded against its own conversation.
const overridden = original({ childId: "tm-b1", request: { parent: agentsById.get("session-b"), context: "fresh" } });
assert(overridden.request.agentOptions.provider === "openai-codex" && overridden.request.agentOptions.model === "gpt-6-astra", `a per-name override wins over the default (got ${JSON.stringify(overridden.request.agentOptions)})`);
const bAfter = (await post({ method: "get", sessionId: "session-b" })).json.value;
assert(bAfter.recent.length === 1 && bAfter.recent[0].source === "override", `conversation B records its override injection (got ${JSON.stringify(bAfter.recent)})`);
assert((await post({ method: "get", sessionId: "session-a" })).json.value.recent.length === 1, "conversation A still holds exactly its own one record");

const cleared = (await post({ method: "clear-recent", sessionId: "session-b" })).json.value;
assert(cleared.sessionId === "session-b" && cleared.recent.length === 0, "clearing one conversation's history answers for that conversation");
const aAfterClear = (await post({ method: "get", sessionId: "session-a" })).json.value;
assert(aAfterClear.recent.length === 1, "clearing another conversation leaves this conversation's history intact");

const forbidden = await post({ method: "get" }, "evil.example.com");
assert(forbidden.status === 403, `a non-loopback Host is refused (got ${forbidden.status})`);
const unknown = await post({ method: "nope" });
assert(unknown.status === 404, `an unknown method is a 404 (got ${unknown.status})`);
const noSession = (await post({ method: "get" })).json.value;
assert(noSession.sessionId === null && noSession.members.length === 0 && noSession.recent.length === 0, "a request without a Session id answers with an empty, unscoped view");
const hookAfter = (await post({ method: "get", sessionId: "session-a" })).json.value.hook;
assert(hookAfter.injections === 2 && typeof hookAfter.lastInjectionAt === "number", `the payload counts real injections as seam evidence (got ${JSON.stringify({ injections: hookAfter.injections, lastInjectionAt: hookAfter.lastInjectionAt })})`);

// The unscoped clear-recent keeps its documented "wipe everything" meaning; the
// browser half refuses to call it without a conversation, but the API contract
// stays stable for any other caller.
await post({ method: "clear-recent" });
const wiped = (await post({ method: "get", sessionId: "session-a" })).json.value;
assert(wiped.recent.length === 0, "an unscoped clear-recent keeps its documented global meaning");

console.log(failures.length === 0 ? "ALL OK" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);

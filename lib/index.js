/**
 * dsh-agent-team-model — host half.
 *
 * Owns the LLM route (provider / model / reasoning effort) that Agent Teams
 * teammates are created with, and serves the browser half's JSON API.
 *
 * The Team service defaults a child's AgentOptions to the Lead's route.
 * The continuation seam (`ctx.subagents.startContinuable`) already
 * accepts `request.agentOptions`, so this plugin wraps that seam, identifies
 * the one child id that is a Team teammate, and injects the configured route.
 * An explicit `agentOptions` already on the request — i.e. a `spawn_teammate`
 * call that named provider/model itself — always wins.
 *
 * State lives in `$DSH_HOME/agent-team-model.json` (atomic tmp+rename). The
 * route is re-read on every spawn, so a UI edit applies to the very next
 * teammate with no restart.
 *
 * Route security mirrors dsh-dream-skin's fence: loopback (or a configured
 * trusted authority) Host header plus same-origin browser markers. That is a
 * DNS-rebinding / cross-site defense for a loopback config endpoint, not
 * authentication.
 */

import { homedir } from "node:os";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readMembers } from "./team-view.js";
export { readMembers } from "./team-view.js";

/** Plugin identity for cordis loader rows. */
export const name = "dsh-agent-team-model";
/** Services required before mounting: route registry and the trust-fence host list. */
export const inject = ["webServer", "webRuntime"];

/** State file name inside the DSH home directory. */
const STATE_FILENAME = "agent-team-model.json";
/** Route prefix owned by this plugin. */
const API_PREFIX = "/agent-team-model/api";
/** Max accepted request body. */
const MAX_BODY_BYTES = 256 * 1024;
/** Ring size of applied-route records kept per conversation. */
const RECENT_LIMIT = 20;
/** Upper bound on conversations whose injection history is retained. */
const RECENT_CONVERSATIONS = 50;
/** Model catalog cache lifetime. */
const CATALOG_TTL_MS = 10_000;
/** Upper bound on models whose reasoning metadata is resolved per provider. */
const EFFORT_PROBE_LIMIT = 40;

/** Sentinel: the request body exceeded MAX_BODY_BYTES (respond 413, not 400). */
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");

/**
 * Routes actually injected into a teammate spawn, newest first and keyed by the
 * conversation (Lead session) that spawned them — the UI is conversation-scoped,
 * so its history must be too, and clearing it must not wipe another
 * conversation's record.
 */
const recentByConversation = new Map();
/** Total routes injected since this host mounted — evidence the seam still fires. */
let injectionCount = 0;
/** Timestamp of the most recent injection, or null before the first one. */
let lastInjectionAt = null;
/** Cached model catalog for the pickers. */
let catalogCache = { at: 0, value: undefined };

/**
 * Append one applied-route record to its conversation's ring.
 * @param conversationId - Lead session that spawned the teammate.
 * @param entry - record to store (newest first).
 */
function rememberInjection(conversationId, entry) {
	injectionCount += 1;
	lastInjectionAt = entry.at;
	const key = typeof conversationId === "string" && conversationId !== "" ? conversationId : "unknown";
	const ring = recentByConversation.get(key) ?? [];
	ring.unshift(entry);
	ring.length = Math.min(ring.length, RECENT_LIMIT);
	// Re-insert so Map order tracks recency and the oldest conversation can be evicted.
	recentByConversation.delete(key);
	recentByConversation.set(key, ring);
	while (recentByConversation.size > RECENT_CONVERSATIONS) {
		const oldest = recentByConversation.keys().next().value;
		if (oldest === undefined) break;
		recentByConversation.delete(oldest);
	}
}

/**
 * Applied-route records of one conversation.
 * @param conversationId - Lead session whose history is requested.
 * @returns detached newest-first records, or [] without a conversation.
 */
function readRecent(conversationId) {
	if (typeof conversationId !== "string" || conversationId === "") return [];
	return (recentByConversation.get(conversationId) ?? []).slice();
}

// ── state file ─────────────────────────────────────────────────────────────

/** Absolute path of the DSH home directory. */
function dshHomePath() {
	return process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
}

/** Absolute path of the state file. */
function statePath() {
	return join(dshHomePath(), STATE_FILENAME);
}

/** The configuration used when nothing is stored. */
function emptyConfig() {
	return { enabled: true, default: {}, overrides: {} };
}

/** Keep only the recognized route keys with non-empty string values. */
function normalizeRoute(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const route = {};
	for (const key of ["provider", "model", "reasoningEffort"]) {
		const raw = value[key];
		if (typeof raw === "string" && raw.length > 0) route[key] = raw;
	}
	return route;
}

/** Normalize one stored/requested configuration document. */
function normalizeConfig(value) {
	const config = emptyConfig();
	if (value === null || typeof value !== "object" || Array.isArray(value)) return config;
	config.enabled = value.enabled !== false;
	const fallback = normalizeRoute(value.default);
	if (fallback !== undefined) config.default = fallback;
	const overrides = value.overrides;
	if (overrides !== null && typeof overrides === "object" && !Array.isArray(overrides)) {
		for (const [key, route] of Object.entries(overrides)) {
			if (typeof key !== "string" || key.length === 0 || key.length > 200) continue;
			const normalized = normalizeRoute(route);
			if (normalized !== undefined && Object.keys(normalized).length > 0) config.overrides[key] = normalized;
		}
	}
	return config;
}

/** Read the stored configuration; defaults when absent or corrupt. */
function readConfig() {
	try {
		return normalizeConfig(JSON.parse(readFileSync(statePath(), "utf8")));
	} catch {
		return emptyConfig();
	}
}

/** Persist the configuration atomically (tmp + rename, direct-write fallback). */
function writeConfig(config) {
	const file = statePath();
	mkdirSync(dirname(file), { recursive: true });
	const body = JSON.stringify(config, null, "\t");
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
	try {
		renameSync(tmp, file);
	} catch {
		// rename can transiently fail on Windows while the target is locked.
		writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
	}
}

// ── route resolution ───────────────────────────────────────────────────────

/**
 * Resolve the route a teammate with this name should be created with.
 * @param config - normalized configuration.
 * @param teammateName - the `spawn_teammate` name, when known.
 * @returns provider/model(/effort) or undefined to inherit the Lead's route.
 */
function routeFor(config, teammateName) {
	if (!config.enabled) return undefined;
	const override = typeof teammateName === "string" ? config.overrides[teammateName] : undefined;
	const route = override ?? config.default;
	if (route === undefined || route.provider === undefined || route.model === undefined) return undefined;
	return route;
}

/**
 * Inject the configured route into one continuable-child start when — and only
 * when — that child is a Team teammate.
 *
 * The Team service appends the roster row before it calls
 * `startContinuable`, so the new `childId` is already addressable by name
 * through the public `listMembers` face. That is what keeps this hook off the
 * plain `subagent` delegation path.
 *
 * @param spec - the continuation start spec.
 * @param teams - live Agent Teams service.
 * @returns the spec, with `request.agentOptions` added when a route applies.
 */
function withConfiguredRoute(spec, teams) {
	if (spec === null || typeof spec !== "object") return spec;
	const request = spec.request;
	if (request === null || typeof request !== "object") return spec;
	// An explicit model choice on the delegation request always wins.
	if (request.agentOptions !== undefined) return spec;
	const parent = request.parent;
	if (parent === undefined) return spec;
	let member;
	try {
		member = teams.listMembers(parent).find((row) => row.id === spec.childId);
	} catch {
		member = undefined;
	}
	if (member === undefined) return spec;
	const config = readConfig();
	const route = routeFor(config, member.name);
	if (route === undefined) return spec;
	// Own the full selected route. An explicit undefined effort is significant:
	// the child resolver's spread then clears a same-provider/model Lead effort,
	// allowing the selected model to use its own default.
	const agentOptions = { ...route, reasoningEffort: route.reasoningEffort };
	rememberInjection(parent.id, {
		at: Date.now(),
		name: typeof member.name === "string" ? member.name : "",
		context: request.context,
		agentOptions,
		source: config.overrides[member.name] !== undefined ? "override" : "default"
	});
	return { ...spec, request: { ...request, agentOptions } };
}

/**
 * Wrap the continuation seam so a configured route reaches the child Agent.
 *
 * This sits above `ctx.subagents.startContinuable`, which already accepts
 * `request.agentOptions`; nothing in the vendor team packages has to be
 * patched for the configured route to take effect.
 *
 * @param ctx - host context.
 */
function installRouteHook(ctx) {
	ctx.inject(["subagents", "agentTeams"], (scoped) => {
		const subagents = scoped.get("subagents");
		const teams = scoped.get("agentTeams");
		if (subagents === undefined || typeof subagents.startContinuable !== "function") {
			scoped.logger.warn("[dsh-agent-team-model] ctx.subagents.startContinuable not found; teammate route injection is inactive");
			return;
		}
		if (subagents.__agentTeamModelHook === true) return;
		const original = subagents.startContinuable.bind(subagents);
		subagents.startContinuable = (spec) => original(withConfiguredRoute(spec, teams));
		subagents.__agentTeamModelHook = true;
		scoped.logger.info("[dsh-agent-team-model] teammate route hook installed");
		scoped.effect(() => () => {
			subagents.startContinuable = original;
			delete subagents.__agentTeamModelHook;
		}, "dsh-agent-team-model: teammate route hook");
	});
}

// ── read models for the API ────────────────────────────────────────────────

/** Route key of one provider/model pair. */
function routeKey(provider, model) {
	return `${provider}\u0000${model}`;
}

/**
 * Read the provider/model/effort catalog the pickers need.
 * @param ctx - host context.
 * @returns catalog value, cached briefly.
 */
async function readCatalog(ctx) {
	const now = Date.now();
	if (catalogCache.value !== undefined && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
	const value = { providers: [], models: {}, efforts: {}, error: null };
	const llm = ctx.get("llm");
	if (llm === undefined) {
		value.error = "llm service unavailable";
		catalogCache = { at: now, value };
		return value;
	}
	try {
		value.providers = llm.listProviders().map((provider) => ({ id: provider.id, name: provider.name ?? provider.id }));
	} catch (error) {
		value.error = `listProviders failed: ${String(error?.message ?? error)}`;
		catalogCache = { at: now, value };
		return value;
	}
	for (const provider of value.providers) {
		let models = [];
		try {
			models = await llm.listModels(provider.id);
		} catch {
			models = [];
		}
		value.models[provider.id] = models.map((model) => ({ id: model.id, name: model.name ?? model.id }));
		for (const model of models.slice(0, EFFORT_PROBE_LIMIT)) {
			try {
				const info = await llm.resolveModelInfo(provider.id, model.id);
				const reasoning = info?.reasoning;
				if (reasoning === undefined) continue;
				value.efforts[routeKey(provider.id, model.id)] = {
					efforts: (reasoning.efforts ?? []).map((effort) => ({ id: effort.id, name: effort.name ?? effort.id })),
					defaultEffort: reasoning.defaultEffort ?? null
				};
			} catch {
				/* a model without reasoning metadata simply has no effort list */
			}
		}
	}
	catalogCache = { at: now, value };
	return value;
}

// ── trust fence (mirrors dsh-dream-skin / dsh-better-sidebar) ──────────────

/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return undefined;
	}
}

/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

/** Assert one configured `trustedHosts` entry is a bare authority in canonical form. */
function assertTrustedAuthority(entry) {
	const entryUrl = parseAuthority(entry);
	if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return;
	throw new Error(`dsh-agent-team-model: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}

/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		assertTrustedAuthority(entry);
		const entryUrl = parseAuthority(entry);
		if (entryUrl === undefined) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
			? entryUrl.hostname === hostUrl.hostname
			: entryUrl.host === hostUrl.host;
	});
}

/** Whether one request may reach the plugin routes. */
function isTrustedApiRequest(req, trustedHosts) {
	const host = typeof req.headers.host === "string" ? req.headers.host : undefined;
	if (host === undefined) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === undefined) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (req.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

// ── JSON body / response helpers ───────────────────────────────────────────

/** Read a JSON request body, capped at MAX_BODY_BYTES. */
function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let aborted = false;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES && !aborted) {
				aborted = true;
				req.destroy();
				resolve(PAYLOAD_TOO_LARGE);
				return;
			}
			if (!aborted) chunks.push(chunk);
		});
		req.on("end", () => {
			if (aborted) return;
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (!aborted) resolve(null);
		});
	});
}

/** Write a JSON response with the given status code. */
function writeJson(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(value));
}

/** Build the full UI payload. */
export async function readView(ctx, sessionId) {
	const config = readConfig();
	const subagents = ctx.get("subagents");
	const roster = await readMembers(ctx, sessionId);
	const teammate = roster.viewer.role === "teammate";
	return {
		config: teammate ? null : config,
		viewer: roster.viewer,
		catalog: await readCatalog(ctx),
		members: roster.members,
		membersError: roster.error,
		sessionId: typeof sessionId === "string" ? sessionId : null,
		recent: teammate ? [] : readRecent(sessionId),
		statePath: teammate ? null : statePath(),
		effectiveDefault: teammate ? null : routeFor(config, undefined) ?? null,
		hook: {
			installed: subagents !== undefined && subagents.__agentTeamModelHook === true,
			subagents: subagents !== undefined,
			agentTeams: ctx.get("agentTeams") !== undefined,
			// Behavioural evidence that the wrapped seam is still on the vendor
			// call path: an installed wrapper that never fires is the silent
			// degradation an upgrade would cause.
			injections: injectionCount,
			lastInjectionAt
		}
	};
}

/** Handle one fenced API request. */
async function handleApi(ctx, req, res) {
	if (req.method !== "POST") {
		writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
		return;
	}
	const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"].toLowerCase() : "";
	if (!contentType.startsWith("application/json")) {
		writeJson(res, 415, { ok: false, error: { code: "unsupported-media-type", message: "content-type must be application/json" } });
		return;
	}
	const payload = await readJsonBody(req);
	if (payload === PAYLOAD_TOO_LARGE) {
		writeJson(res, 413, { ok: false, error: { code: "payload-too-large", message: "request body too large" } });
		return;
	}
	if (payload === null || typeof payload !== "object" || typeof payload.method !== "string") {
		writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "bad request" } });
		return;
	}
	if (payload.method === "get") {
		writeJson(res, 200, { ok: true, value: await readView(ctx, payload.sessionId) });
		return;
	}
	if ((payload.method === "set" || payload.method === "clear-recent") && typeof payload.sessionId === "string" && payload.sessionId !== "") {
		const roster = await readMembers(ctx, payload.sessionId);
		if (roster.error || roster.viewer.role !== "lead") {
			writeJson(res, 403, { ok: false, error: { code: "teammate-read-only", message: "Only a verified Lead conversation may change team settings; teammate model views are read-only." } });
			return;
		}
	}
	if (payload.method === "set") {
		const config = normalizeConfig(payload.config);
		writeConfig(config);
		catalogCache = { at: 0, value: undefined };
		writeJson(res, 200, { ok: true, value: await readView(ctx, payload.sessionId) });
		return;
	}
	if (payload.method === "clear-recent") {
		// Clearing without a conversation keeps the old "wipe everything" meaning.
		if (typeof payload.sessionId === "string" && payload.sessionId !== "") recentByConversation.delete(payload.sessionId);
		else recentByConversation.clear();
		writeJson(res, 200, { ok: true, value: await readView(ctx, payload.sessionId) });
		return;
	}
	writeJson(res, 404, { ok: false, error: { code: "not-found", message: `unknown method "${payload.method}"` } });
}

/**
 * Host loader entry: mount the config API and the teammate route hook.
 * @param ctx - host cordis context (webServer, webRuntime).
 */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)) {
				writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
				return;
			}
			try {
				await handleApi(ctx, req, res);
			} catch (error) {
				console.error("[dsh-agent-team-model] API error:", error);
				writeJson(res, 500, { ok: false, error: { code: "internal", message: "internal error" } });
			}
		}
	}), "dsh-agent-team-model: config API routes");
	installRouteHook(ctx);
}

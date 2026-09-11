/** Read-only Team views. Durable observations never start or resume an Agent. */
const MODEL_EDIT_REASON = "当前 DSH 不支持队员会话热修改模型或 effort；此处仅查看自己的路由。";
const viewer = (role = "none", memberId = null, rootId = null) => ({
	role, memberId, rootId, canEditModel: false, modelEditReason: MODEL_EDIT_REASON
});
const empty = () => ({ members: [], error: null, viewer: viewer() });

function fullRoute(value) {
	if (typeof value?.provider !== "string" || !value.provider || typeof value?.model !== "string" || !value.model) return undefined;
	return { provider: value.provider, model: value.model,
		...(typeof value.reasoningEffort === "string" && value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) };
}

/** Retain one cut only while projecting it; do not hold leases across requests. */
async function observe(ctx, id, project) {
	const query = ctx.get("sessionQuery");
	if (typeof query?.observeSession !== "function") throw new Error("session query unavailable");
	const source = await query.observeSession(id, { projectionMode: "none" });
	try {
		if (source.header?.id !== id) throw new Error("session identity mismatch");
		return project(source);
	} finally {
		source[Symbol.dispose]();
	}
}

function ownEvents(source) {
	const count = source.inheritedEventCount ?? 0;
	if (!Number.isSafeInteger(count) || count < 0 || count > source.events.length) throw new Error("invalid inherited event boundary");
	return source.events.slice(count);
}

/** Preserve last turn completion separately from process-local residency. */
function workStateOf(events) {
	let state;
	for (const event of events) {
		if (event.type === "turn/start") state = "interrupted";
		else if (event.type === "turn/end") {
			const kind = event.data?.reason?.kind;
			state = kind === "completed" ? "completed" : kind === "canceled" ? "canceled" : "interrupted";
		} else if (event.type === "agent/inbox/spliced" && event.data?.inserted?.length > 0) state = "pending";
	}
	return state;
}

/** Descriptor v3 rejects unknown composition fields rather than pretending resumability. */
function supportedDescriptor(data) {
	if (data?.version !== 3 || data.mode !== "continuable" || typeof data.provider !== "string" || typeof data.label !== "string") return false;
	const keys = ["version", "mode", "provider", "label", "agentProvider", "agentModel", "agentReasoningEffort", "persona", "toolFilter"];
	if (Object.keys(data).some(key => !keys.includes(key))) return false;
	if (["agentProvider", "agentModel", "agentReasoningEffort", "persona"].some(key => Object.hasOwn(data, key) && typeof data[key] !== "string")) return false;
	if (Object.hasOwn(data, "toolFilter")) {
		const filter = data.toolFilter;
		if (!filter || typeof filter !== "object" || Array.isArray(filter) || Object.keys(filter).length === 0) return false;
		if (Object.entries(filter).some(([key, value]) => !["allow", "deny"].includes(key) || !Array.isArray(value) || value.some(item => typeof item !== "string"))) return false;
	}
	return true;
}

/** Same first-own-descriptor semantics used by DSH's coldResume (descriptor v3). */
function persistedRoute(source, rootId, backend) {
	if (source.header.parentSession !== rootId) throw new Error("teammate lineage mismatch");
	const data = ownEvents(source).find(event => event.type === "subagent/descriptor")?.data;
	if (!supportedDescriptor(data) || data.provider !== backend) {
		throw new Error("supported teammate continuation descriptor unavailable");
	}
	const route = fullRoute({ provider: data.agentProvider, model: data.agentModel, reasoningEffort: data.agentReasoningEffort });
	if (!route) throw new Error("persisted teammate route unavailable");
	return route;
}

/** UI forks also have parentSession; only origin or an own descriptor proves provider ownership. */
function isSubagent(source) {
	return source.header.origin === "subagent" || ownEvents(source).some(event => event.type === "subagent/descriptor");
}

/** A cold Lead has no live Team façade: read only its versioned member journal. */
function persistedRoster(source) {
	if (isSubagent(source)) return [];
	const rows = new Map();
	for (const event of ownEvents(source)) {
		if (event.type !== "team/member") continue;
		const data = event.data;
		if (data?.teamId !== source.header.id) continue;
		const member = data.member;
		if (data.version !== 2 || typeof member?.id !== "string" || !member.id || typeof member.name !== "string" || !member.name
			|| typeof member.provider !== "string" || !member.provider || !["active", "provisioning", "failed"].includes(member.phase)) {
			throw new Error("unsupported persisted Team member record");
		}
		rows.set(member.id, { id: member.id, name: member.name, role: "teammate", description: member.description,
			provider: member.provider, context: member.context,
			status: member.phase === "active" ? "inactive" : member.phase,
			diagnostics: member.error ? [member.error] : [] });
	}
	return [{ id: source.header.id, name: "lead", role: "lead", status: "inactive", diagnostics: [] }, ...rows.values()];
}

async function rootRows(ctx, rootId) {
	const live = ctx.get("agents").get(rootId);
	if (live) return ctx.get("agentTeams").listMembers(live);
	return observe(ctx, rootId, persistedRoster);
}

/** Resolve role by exact membership, including a cold child whose Lead is cold. */
async function resolveRoster(ctx, sessionId) {
	const current = ctx.get("agents").get(sessionId);
	if (current) {
		const membership = ctx.get("agentTeams").tryMembership(current);
		if (!membership) return { rows: [], viewer: viewer() };
		const root = membership.root ?? current;
		const rows = ctx.get("agentTeams").listMembers(root);
		const self = rows.find(row => row.id === sessionId);
		return { rows, viewer: self ? viewer(self.role, self.id, root.id) : viewer() };
	}
	if (typeof ctx.get("sessionQuery")?.observeSession !== "function") return { rows: [], viewer: viewer() };
	const { header, subagent } = await observe(ctx, sessionId, source => ({ header: { ...source.header }, subagent: isSubagent(source) }));
	if (typeof header.parentSession === "string") {
		let rows;
		try {
			rows = await rootRows(ctx, header.parentSession);
		} catch (error) {
			// A descriptor-free UI fork can own a Team even after its original source is gone.
			if (subagent) throw error;
		}
		const self = rows?.find(row => row.id === sessionId && row.role === "teammate");
		if (self) return { rows, viewer: viewer("teammate", sessionId, header.parentSession) };
	}
	if (subagent) return { rows: [], viewer: viewer() };
	const rows = await rootRows(ctx, sessionId);
	return { rows, viewer: viewer("lead", sessionId, sessionId) };
}

async function enrichRow(ctx, row, rootId) {
	const live = ctx.get("agents").get(row.id);
	const request = fullRoute(live?.session?.requestHeader?.()?.config);
	let route = request ?? fullRoute(live?.options);
	let routeSource = request ? "last-request" : route ? "creation" : "unavailable";
	let routeError;
	let workState;
	if (row.role === "teammate" && typeof live?.session?.snapshotEvents === "function") {
		workState = workStateOf(live.session.snapshotEvents(live.session.inheritedEventCount ?? 0));
	}
	if (!route && row.role === "teammate") {
		try {
			const saved = await observe(ctx, row.id, source => ({
				route: persistedRoute(source, rootId, row.provider), workState: workStateOf(ownEvents(source))
			}));
			route = saved.route;
			workState = saved.workState;
			routeSource = "persisted-descriptor";
		} catch (error) {
			routeError = `无法读取队员保存的路由：${String(error?.message ?? error)}`;
		}
	}
	return { ...row, backend: row.role === "teammate" ? row.provider : undefined,
		// TeamRoster.list's row.model is a Lead fallback, NEVER a child's route.
		provider: route?.provider, model: route?.model, reasoningEffort: route?.reasoningEffort,
		routeSource, ...(workState ? { workState } : {}), ...(routeError ? { routeError } : {}) };
}

/** Return a Lead's own roster, or ONLY self for a teammate conversation. */
export async function readMembers(ctx, sessionId) {
	if (typeof sessionId !== "string" || !sessionId) return empty();
	if (!ctx.get("agentTeams") || !ctx.get("agents")) return { ...empty(), error: "this host does not compose the Agent Teams service; add @deepseek-ai/dsh-experimental-agent-team-profile to this profile" };
	try {
		const resolved = await resolveRoster(ctx, sessionId);
		const rows = resolved.viewer.role === "teammate" ? resolved.rows.filter(row => row.id === sessionId) : resolved.rows;
		return { members: await Promise.all(rows.map(row => enrichRow(ctx, row, resolved.viewer.rootId))), error: null, viewer: resolved.viewer };
	} catch (reason) {
		return { ...empty(), error: `the team read failed: ${String(reason?.message ?? reason)}` };
	}
}

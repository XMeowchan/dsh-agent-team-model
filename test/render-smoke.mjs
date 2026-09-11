// Headless render smoke test for the dsh-agent-team-model browser half.
//
// The plugin bundle is a lazy-CJS browser module: it calls
// window.__ModuleLoader__.load({ id, factory }) and its factory requires only
// platform seed modules. This test stubs that loader plus the `slots` service,
// runs `apply(ctx)`, and server-renders every registered seat so a reference
// error or a broken hook in the UI code fails here instead of in the browser.

import { readFile } from "node:fs/promises";
import { createRequire, register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// DSH's compiled primitives import `.module.css`; stub those for Node.
register("./css-stub-loader.mjs", import.meta.url);

/**
 * Resolve a test-only module (react / react-dom) from any plausible base: an
 * explicit ATM_TEST_MODULES directory, the current directory, or this file's
 * own directory. The plugin package itself stays dependency-free, so the test
 * runs from whatever scratch directory has react installed.
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

const React = resolveTestModule("react");
const { renderToStaticMarkup } = resolveTestModule("react-dom/server");

const BUNDLE = process.argv[2];
if (BUNDLE === undefined) throw new Error("usage: node render-smoke.mjs <client.js>");
const source = await readFile(BUNDLE, "utf8");

let registration;
globalThis.window = {
	__ModuleLoader__: {
		load(value) {
			registration = value;
		}
	}
};
globalThis.document = {
	getElementById: () => null,
	createElement: () => ({
		id: "",
		textContent: "",
		attributes: {},
		setAttribute(name, value) {
			this.attributes[name] = value;
		},
		getAttribute(name) {
			return this.attributes[name] ?? null;
		},
		appendChild: () => {}
	}),
	head: { appendChild: () => {} },
	body: { appendChild: () => {} },
	addEventListener: () => {},
	removeEventListener: () => {}
};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

// Execute the bundle without importing it as a module (it has no ESM syntax).
new Function(`${source}\n//# sourceURL=${BUNDLE}`)();

if (registration === undefined) throw new Error("bundle did not call window.__ModuleLoader__.load");
console.log(`bundle id: ${registration.id}`);

const clientExports = registration.factory((specifier) => {
	if (specifier === "react") return React;
	if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return resolveTestModule(specifier);
	if (specifier === "react-dom") return resolveTestModule("react-dom");
	throw new Error(`unexpected require("${specifier}")`);
});

const registered = [];
const ctx = {
	get(name) {
		if (name !== "slots") return undefined;
		return {
			inject: (_slot, callback) => callback(),
			register: (descriptor, render) => registered.push({ descriptor, render })
		};
	}
};

clientExports.apply(ctx);
console.log(`inject: ${JSON.stringify(clientExports.inject)}`);
console.log(`seats: ${registered.map((entry) => `${entry.descriptor.name}#${entry.descriptor.id}`).join(", ")}`);

let failed = 0;
for (const entry of registered) {
	let html;
	try {
		// Seat components are rendered the way the shell renders them: as an
		// element, so their hooks run under React (never as a plain call).
		html = renderToStaticMarkup(React.createElement(entry.render, { close: () => {} }));
	} catch (error) {
		failed += 1;
		console.log(`RENDER FAIL ${entry.descriptor.name}: ${error && error.message}`);
		continue;
	}
	const marks = {
		title: html.includes("智能体团队模型"),
		loading: html.includes("加载中") || html.includes("加载失败"),
		empty: html.length > 0
	};
	console.log(`RENDER OK  ${entry.descriptor.name}#${entry.descriptor.id} html=${html.length} ${JSON.stringify(marks)}`);
}

// SSR has no host viewer payload yet: show a neutral loading chip, never an old role.
const composer = registered.find((entry) => entry.descriptor.name === "conversation.input.right");
if (composer !== undefined) {
	const html = renderToStaticMarkup(React.createElement(composer.render, {}));
	if (!html.includes("队员 · 加载中") || !html.includes("disabled") || html.includes("继承队长")) {
		failed += 1;
		console.log("RENDER FAIL composer trigger text missing");
	} else {
		console.log("RENDER OK  composer trigger chip present");
	}
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

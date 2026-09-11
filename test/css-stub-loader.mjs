// Node loader hook for the test harness: DSH's UI primitives ship compiled
// `.js` that imports per-component `.module.css` files. A browser bundler
// handles those; Node refuses the extension, so the harness stubs every CSS
// module with an empty class-name map. The visual preview separately inlines
// the package's real CSS files, so the screenshot still shows the shipped look.

/**
 * @param url - resolved module URL.
 * @param context - loader context.
 * @param nextLoad - the default load step.
 * @returns the stubbed CSS module, or the default load result.
 */
export async function load(url, context, nextLoad) {
	if (url.endsWith(".css")) {
		return {
			format: "module",
			shortCircuit: true,
			source: "export default new Proxy({}, { get: (_target, key) => (typeof key === \"string\" ? key : \"\") });"
		};
	}
	return nextLoad(url, context);
}

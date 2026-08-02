// Stub for the `server-only` marker package.
//
// Next resolves `server-only` itself at build time — it is not installed, so
// Vitest cannot import anything that declares it (which is every server lib).
// Under Node there is no client bundle to guard against, so an empty module is
// the correct stand-in. Wired up in vitest.config.ts.
export {};

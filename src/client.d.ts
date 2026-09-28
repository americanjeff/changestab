// Ambient declarations for the client bundle build (tsconfig.client.json).
//
// Most of the client's surface resolves without declarations:
//
// - The loader-injected CJS `require` loads
//   `@deepseek-ai/dsh-client-ui-primitives` at RUNTIME (see the try/catch in
//   src/dsh/client.tsx). The package can be absent from the web shell's module
//   table. As a result, the code must NOT list it as a build-time dependency.
//   It needs no ambient module declaration. @types/node's CJS global types
//   the `require` call.
// - Installed @types packages and the local structural interfaces in
//   client.tsx type the rest of the client's surface (react, the cordis ctx).
//

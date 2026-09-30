// Run: node test/client.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const src = readFileSync(fileURLToPath(new URL("../dist/dsh/client.js", import.meta.url)), "utf8");

// A fake localStorage is present for the whole run: Node 26 ships an experimental
// `localStorage` global that warns on first access, so override it up front (before
// any render touches it). In a real browser it's the native localStorage.
Object.defineProperty(globalThis, "localStorage", {
  value: (function () {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
      clear: () => m.clear(),
    };
  })(),
  writable: true,
  configurable: true,
});

// 1) The factory's `require` is a param; the bundle is a classic script.
//    Compile it with fake window/require, throws SyntaxError if the body is bad.
const loaded = {};
// Effects are COLLECTED, not run: a render that needs its effects flushed
// (the right-column redirect test) drains pendingEffects by hand.
let pendingEffects = [];
const fakeReact = {
  createElement: (t, p, ...c) => ({ t, p, c }),
  useState: (i) => [typeof i === "function" ? i() : i, () => {}],
  useEffect: (fn) => { pendingEffects.push(fn); },
  useRef: (i) => ({ current: i }),
  useMemo: (fn) => fn(),
  Fragment: "Fragment",
};
// The TSX build uses the automatic JSX runtime (react/jsx-runtime): the
// bundle calls jsx()/jsxs() with the children inside the props object.
// Emit the SAME {t, p, c} element shape the createElement fake produced, so
// every structural assertion below works unchanged.
const fakeJsxRuntime = {
  jsx: (t, p) => ({ t, p, c: p && p.children !== undefined ? (Array.isArray(p.children) ? p.children : [p.children]) : undefined }),
  jsxs: (t, p) => ({ t, p, c: p && p.children !== undefined ? (Array.isArray(p.children) ? p.children : [p.children]) : undefined }),
  Fragment: "Fragment",
};
const fakeRequire = (name) => {
  if (name === "react") return fakeReact;
  if (name === "react/jsx-runtime") return fakeJsxRuntime;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") return {}; // no icons → text fallback
  throw new Error("unexpected require: " + name);
};
new Function("window", "require", src)({ __ModuleLoader__: { load: (reg) => { loaded.reg = reg; } } }, fakeRequire);
assert.ok(loaded.reg && loaded.reg.id === "changestab", "bundle registered with id changestab");
assert.strictEqual(typeof loaded.reg.factory, "function", "factory is a function");

const mod = loaded.reg.factory(fakeRequire);
assert.strictEqual(mod.name, "changestab", "plugin name");
assert.deepStrictEqual(mod.inject, ["slots", "locale", "connection", "sidebarRightTabs"], "service inject list");
assert.strictEqual(typeof mod.apply, "function", "apply present");

// 3) apply with a fake ctx: registers the tab, inject face wires rpc.call → unwrap.
let registered = null;      // the conversation.view entry (the last of that slot)
let registeredRight = null; // the sidebar.right.pane.tab keyed body
let tabDef = null;          // the sidebarRightTabs type definition
const ctx = {
  effect: (fn) => { try { fn(); } catch (e) { } },
  locale: { register: () => () => {}, bind: () => (k) => k },
  connection: {
    rpc: {
      call: (channel, endpoint, payload) => {
        assert.strictEqual(channel, "/filez-browse", "channel");
        if (endpoint === "diff") {
          assert.strictEqual(payload.sessionId, "sess-x", "diff: sessionId");
          assert.ok(typeof payload.relPath === "string", "diff: relPath");
          assert.ok(payload.base === "worktree" || payload.base === "commit", "diff: base whitelisted by the face caller");
          return Promise.resolve({ ok: true, value: { patch: "+x\n", truncated: false, base: payload.base } });
        }
        assert.strictEqual(endpoint, "list", "endpoint");
        return Promise.resolve({
          ok: true,
          value: { root: "/ws", relPath: payload.relPath, entries: [], truncated: false },
        });
      },
    },
  },
  slots: {
    inject: (slot, cb) => {
      assert.ok(slot === "conversation.view" || slot === "sidebar.right.pane.tab", "slot: " + slot);
      const r = cb();
      return typeof r === "function" ? r : () => {};
    },
    register: (opts, comp) => {
      if (opts.name === "conversation.view") registered = { opts, comp };
      else if (opts.name === "sidebar.right.pane.tab") registeredRight = { opts, comp };
      return () => {};
    },
  },
  // No sidebarRightTabs: this first apply plays the LEGACY host (pre-0.1.5,
  // no right column) — the conversation Files tab is the surface. The
  // right-column section below re-applies with a 0.1.5+ ctx.
};
mod.apply(ctx);
assert.ok(registered, "tab registered (legacy host: the conversation tab is the surface)");
assert.strictEqual(registered.opts.id, "files", "tab id");
assert.strictEqual(registered.opts.order, 20, "tab order");
assert.strictEqual(typeof registered.opts.label, "function", "label is a function");
assert.strictEqual(typeof registered.comp, "function", "component is a function");

const face = registered.opts.inject("sess-x");
assert.ok(face.sessionId === "sess-x", "sessionId passed");
const listing = await face.listDirectory("sub");
assert.strictEqual(listing.relPath, "sub", "list relPath passed through");
assert.ok(Array.isArray(listing.entries), "list returns entries");
assert.strictEqual(typeof face.readFile, "undefined", "no readFile face method (file bytes come via the diff endpoint's binary payload)");
const dres = await face.fetchDiff("sub/a.txt", "commit");
assert.ok(typeof dres.patch === "string" && dres.base === "commit", "fetchDiff unwraps the host diff value");

assert.strictEqual(typeof face.readAt, "undefined", "no readAt face method (content viewing is the official Files tab's job)");
assert.strictEqual(typeof face.readAtAbs, "undefined", "no readAtAbs face method (same)");
assert.strictEqual(typeof face.readMermaid, "undefined", "no readMermaid face method (same)");

// 5) Render the component body with the fake React, catches reference/syntax
//    errors in the FilesView render path (change tree, grouped file list,
//    the diff-only preview pane).
const view = registered.comp({
  t: (k) => k,
  sessionId: "sess-min",
  listDirectory: () => Promise.resolve({ root: "/ws", relPath: "", entries: [] }),
  fetchDiff: () => Promise.resolve({ patch: "" }),
  tick: () => Promise.resolve({ listings: [] }),
});
assert.ok(view && typeof view === "object", "FilesView renders an element (no throw)");
const H = mod.__test;

// groupChangedFiles: the selected change's changed files as a
// directory-grouped tree. Directories precede files; each level is
// natural-name sorted; files sit at their exact depth (file node = the
// change itself, dir node = name + path + children).
{
  const ch = (path, status) => ({ path, status });
  assert.deepStrictEqual(H.groupChangedFiles([]), [], "no changes → empty tree");
  const flat = H.groupChangedFiles([ch("b.md", "A"), ch("a.txt", "M")]);
  assert.deepStrictEqual(flat.map((n) => [n.kind, n.change && n.change.path]), [["file", "a.txt"], ["file", "b.md"]], "root files stay at the root, sorted");
  const nested = H.groupChangedFiles([
    ch("src/dsh/client.tsx", "M"), ch("src/dsh/Files.css", "M"), ch("src/index.ts", "M"),
  ]);
  assert.strictEqual(nested.length, 1, "one root dir");
  const src = nested[0];
  assert.deepStrictEqual([src.kind, src.name, src.path], ["dir", "src", "src"], "the root dir row");
  assert.strictEqual(src.children.length, 2, "src has a dir and a file");
  assert.deepStrictEqual([src.children[0].kind, src.children[0].name], ["dir", "dsh"], "dirs precede files (dsh before index.ts)");
  assert.deepStrictEqual(src.children[0].children.map((n) => [n.kind, n.change && n.change.path]), [["file", "src/dsh/client.tsx"], ["file", "src/dsh/Files.css"]], "the nested dir's files, sorted (case-insensitive natural)");
  assert.strictEqual(src.children[1].kind, "file", "index.ts at depth 1");
  // Natural (numeric-aware) order at a level: the dir first, f2 before f10.
  const nat = H.groupChangedFiles([ch("z/f10.txt", "M"), ch("z/f2.txt", "M"), ch("z/a-dir/x", "M")]);
  assert.deepStrictEqual(nat[0].children.map((n) => (n.kind === "dir" ? n.path : n.change.path)), ["z/a-dir", "z/f2.txt", "z/f10.txt"], "numeric sort: f2 < f10; the dir first");
  // Deep paths: every intermediate dir is materialized.
  const deep = H.groupChangedFiles([ch("a/b/c/d.txt", "A")]);
  assert.strictEqual(deep[0].children[0].children[0].children[0].kind, "file", "a/b/c/d.txt materializes a → b → c → d.txt");
}

// 7) Per-session view-state persistence (localStorage, installed at the top):
//    the selected changed file, the divider width, the reviewed change, and
//    the nav's collapsed preference. The tree itself is never persisted — it
//    is derived from the selected change's status block on every load.
H.saveState("sess-p", "docs/sub/note.md", 432, "abcd1234", false, 264.4);
const round = H.loadState("sess-p");
assert.strictEqual(round.selected, "docs/sub/note.md", "loadState: restored selection");
assert.strictEqual(round.navW, 432, "loadState: restored divider width");
assert.strictEqual(round.rev, "abcd1234", "loadState: restored reviewed change");
assert.strictEqual(round.collapsed, false, "loadState: restored collapsed pref");
assert.strictEqual(round.treeH, 264, "loadState: restored log-pane height (rounded)");
assert.strictEqual(H.loadState("sess-other"), null, "loadState: other session → null");
assert.strictEqual(H.loadState(null), null, "loadState: no session → null");
// A corrupt saved blob must not throw (loadState swallows the parse error).
globalThis.localStorage.setItem("changestab/files/sess-bad", "{not json");
assert.strictEqual(H.loadState("sess-bad"), null, "loadState: a corrupt blob → null");
H.saveState("sess-p", null, null, null, false, null);
assert.deepStrictEqual(H.loadState("sess-p"), { selected: null, navW: null, rev: null, collapsed: false, treeH: null }, "saveState: cleared → all null/false");
// The 4-field shape predates treeH: a blob without it loads as null (the
// CSS default height), not an error.
globalThis.localStorage.setItem("changestab/files/sess-old", JSON.stringify({ selected: "a.txt", navW: 300, rev: "r1", collapsed: false }));
assert.deepStrictEqual(H.loadState("sess-old"), { selected: "a.txt", navW: 300, rev: "r1", collapsed: false, treeH: null }, "loadState: a pre-treeH blob keeps its fields, treeH defaults");
globalThis.localStorage.removeItem("changestab/files/sess-old");

assert.strictEqual(H.formatBytes(512), "512 B", "bytes: B");
assert.strictEqual(H.formatBytes(2048), "2 KB", "bytes: KB");
assert.strictEqual(H.formatBytes(5 * 1024 * 1024), "5 MB", "bytes: MB");
assert.strictEqual(H.formatBytes(1536), "1.5 KB", "bytes: fractional KB");

// Render with a real sessionId + storage present, loadState runs in the state
// initializer, so this catches a throw in the restore path.
const view2 = registered.comp({ t: (k) => k, sessionId: "sess-p", listDirectory: (p) => Promise.resolve({ root: "/ws", relPath: p, entries: [] }) });
assert.ok(view2 && typeof view2 === "object", "FilesView renders with a sessionId (restore path, no throw)");
// A corrupt saved blob must not throw, loadState swallows the parse error.
globalThis.localStorage.setItem("changestab/files/sess-bad", "{not json");
const view3 = registered.comp({ t: (k) => k, sessionId: "sess-bad", listDirectory: (p) => Promise.resolve({ root: "/ws", relPath: p, entries: [] }) });
assert.ok(view3 && typeof view3 === "object", "FilesView renders over a corrupt saved state (no throw)");
// The divider's width lives in the --filez-nav CSS var on the body element,
// not React state, no state churn during the drag.
const findDivider = (function find(node, out) {
  if (out === undefined) out = [];
  if (Array.isArray(node)) { for (const ch of node) find(ch, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.p && node.p.className === "dswFiles_divider") out.push(node);
  if (node.c) find(node.c, out);
  return out;
})(view2);
assert.strictEqual(findDivider.length, 1, "FilesView renders one divider");
assert.strictEqual(findDivider[0].p.role, "separator", "divider: role=separator");
assert.strictEqual(typeof findDivider[0].p.onPointerDown, "function", "divider: draggable (onPointerDown)");
assert.strictEqual(typeof findDivider[0].p.onDoubleClick, "function", "divider: double-click reset");
// The nav column's toggle is a state pair: a HIDE control in the nav's own
// header (rendered here, always, while the nav shows) and a RESTORE control
// in the view bar's right end (the view bar renders only while a file is
// viewed). With nothing viewed the stored collapsed preference cannot apply —
// the nav stays expanded (the only way to pick a file). Both renders below
// have no selection: the nav (with its hide control) and divider show, there
// is no view bar (hence no restore control), and the old rail affordances
// are gone. (The hidden branch — a file viewed while collapsed — needs live
// state, so e2e covers it.)
const findCls = (node, cls) => (function find(node, out) {
  if (out === undefined) out = [];
  if (Array.isArray(node)) { for (const ch of node) find(ch, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (typeof node.p?.className === "string" && node.p.className.split(" ").includes(cls)) out.push(node);
  if (node.c) find(node.c, out);
  return out;
})(node);
globalThis.localStorage.setItem("changestab/files/sess-collapsed", JSON.stringify({ selected: null, navW: null, rev: null, collapsed: true }));
const viewCollapsed = registered.comp({ t: (k) => k, sessionId: "sess-collapsed", listDirectory: (p) => Promise.resolve({ root: "/ws", relPath: p, entries: [] }) });
assert.strictEqual(findCls(viewCollapsed, "dswFiles_browsePane").length, 1, "collapsed pref + nothing viewed: the nav stays expanded");
assert.strictEqual(findCls(viewCollapsed, "dswFiles_divider").length, 1, "invariant: the divider renders with the nav");
assert.strictEqual(findCls(viewCollapsed, "dswFiles_bodyNavHidden").length, 0, "invariant: no flush class while the nav is shown");
assert.strictEqual(findCls(viewCollapsed, "dswFiles_paneToggle").length, 0, "no selection: the view bar renders only while a file is viewed");
assert.strictEqual(findCls(viewCollapsed, "dswFiles_collapsedRail").length, 0, "the old pane-edge rail is gone");
assert.strictEqual(findCls(view2, "dswFiles_bodyNavHidden").length, 0, "expanded: no flush class");
assert.strictEqual(findCls(view2, "dswFiles_paneToggle").length, 0, "expanded + no selection: no view bar");
assert.strictEqual(findCls(view2, "dswFiles_navToggle").length, 1, "nav visible → the state pair's hide control rides in the nav's header");

// A generic predicate finder (the className helper above is too narrow for
// data-attributes and component props).
const findEl = (node, pred) => (function find(node, out) {
  if (out === undefined) out = [];
  if (Array.isArray(node)) { for (const ch of node) find(ch, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  if (node.c) find(node.c, out);
  return out;
})(node);
const childText = (n) => Array.isArray(n.c) ? n.c.filter((x) => typeof x === "string").join("") : (typeof n.c === "string" ? n.c : "");



// 5b) The change tree nav: render with a vcs block and pin
//     the structure — the "Editing" worktree row on top (selected by
//     default), commit rows with glyph/pills/date, the selected change's
//     file list nested under its row (the worktree's set from the status
//     block in live mode).
{
  const vcs = {
    ok: true, backend: "jj",
    head: { id: "abcd1234ef56", changeId: "qpslqqptwxyz", bookmarks: ["dev", "feature/x"], tags: ["v0.1.7", "v0.1.6", "v0.1.5", "v0.1.4"], description: "wip", marker: "@" },
    changes: [ { path: "a.txt", status: "M" }, { path: "docs/n.md", status: "A" } ],
    conflicts: [],
    commits: [
      { id: "aaaa11111111", commitId: "f11e978bb855", glyph: "○", conflict: false, empty: false, author: "jeff@x", date: "2026-07-10T10:00:00", bookmarks: ["main"], tags: ["v0.2.0"], description: "phase 0" },
      { id: "bbbb22222222", commitId: "2c3d4e5f6a7b", glyph: "×", conflict: true, empty: false, author: "jeff@x", date: "2026-07-09T09:30:00", bookmarks: [], tags: [], description: "broken merge" },
      { id: "cccc33333333", commitId: "9a8b7c6d5e4f", glyph: "○", conflict: false, empty: true, author: "jeff@x", date: "2026-07-08T08:00:00", bookmarks: [], tags: [], description: "" },
    ],
  };
  // The harness collects effects without running them, so the root listing
  // must arrive via the nav cache (the component's initial state reads it).
  const rootListing = { root: "/ws", relPath: "", entries: [
    { name: "docs", path: "docs", isDirectory: true, hidden: false },
    { name: "a.txt", path: "a.txt", isDirectory: false, hidden: false, size: 11, mtime: Date.now() },
  ], vcs };
  mod.__test.navCacheSet("sess-vcs", { rootListing, commitList: vcs.commits });
  // The composer write path (useInput/inputActions) arms the section-ref
  // "add to chat"; the host tab actions (openResource/openTab) arm the Files
  // handoffs.
  const drafts = [];
  let curDraft = "";
  const viewVcs = registered.comp({
    t: (k) => k,
    sessionId: "sess-vcs",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, rootListing)),
    // The fake tracks the draft so the add-to-chat dedupe sees its own write.
    useInput: () => curDraft,
    inputActions: { setDraft: (text) => { curDraft = text; drafts.push(text); } },
    tabActions: { openTab: () => {}, openResource: () => {} },
  });
  assert.strictEqual(findCls(viewVcs, "dswFiles_changeTree").length, 1, "vcs block → the change tree renders");
  const rows = findEl(viewVcs, (n) => typeof n.p?.["data-files-change"] === "string" && n.t === "button");
  assert.strictEqual(rows.length, 4, "rows: worktree + 3 commits");
  assert.strictEqual(rows[0].p["data-files-change"], "worktree", "row 1 = the working copy");
  assert.strictEqual(rows[0].p["aria-selected"], true, "worktree selected by default (no rev)");
  assert.deepStrictEqual(rows.slice(1).map((r) => r.p["data-files-change"]), ["f11e978bb855", "2c3d4e5f6a7b", "9a8b7c6d5e4f"], "commit rows select by the COMMIT id (newest first)");
  assert.strictEqual(rows[1].p["aria-selected"], false, "a commit is not selected by default");
  // Node characters (jj's own log glyphs, host-supplied): the jj worktree
  // row is @, the plain commit ○, the conflict commit ×, and the EMPTY
  // commit ○ too — jj's node template has no empty case (empty is a
  // description marker, not a node state).
  const glyphs = (row) => findEl(row, (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className.startsWith("dswFiles_changeGlyph"));
  assert.strictEqual(glyphs(rows[0]).length, 1, "one node character per row");
  assert.ok(glyphs(rows[0])[0].p.className.includes("dswFiles_changeGlyph_wc") && String(glyphs(rows[0])[0].c) === "@", "worktree node: @ (accent)");
  assert.ok(glyphs(rows[1])[0].p.className.includes("dswFiles_changeGlyph_normal") && String(glyphs(rows[1])[0].c) === "○", "plain commit node: ○");
  assert.ok(glyphs(rows[2])[0].p.className.includes("dswFiles_changeGlyph_conflict") && String(glyphs(rows[2])[0].c) === "×", "conflict commit node: × (red)");
  assert.ok(glyphs(rows[3])[0].p.className.includes("dswFiles_changeGlyph_normal") && String(glyphs(rows[3])[0].c) === "○", "empty commit node: ○ (jj has no empty glyph)");
  // Pills: bookmarks first then tags, capped at 3 with a +N fold (4 head refs).
  const pills = findEl(rows[0], (n) => typeof n.p?.className === "string" && n.p.className.includes("dswFiles_changePill") && !n.p.className.includes("changePillTag"));
  assert.deepStrictEqual(pills.map((p) => p.c).slice(0, 2).map((c) => (Array.isArray(c) ? c.join("") : c)), ["dev", "feature/x"], "worktree pills: bookmarks");
  assert.ok(findEl(rows[0], (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className.includes("dswFiles_changePillMore") && String(n.c).startsWith("+")), "4 head refs → +N fold");
  // The worktree row renders through the same map as the commit rows: the
  // change id (the fixture has no shortest(8) split → the plain id),
  // "Editing" in the when slot (no @ marker), and the description sub —
  // the commit rows' conventions, no aggregate decoration.
  const wtId = findEl(rows[0], (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className === "dswFiles_changeId");
  // The id span now carries array children (the id + the offset conditional),
  // so flatten to its text leaves.
  const idText = (n) => (Array.isArray(n.c) ? n.c : [n.c]).filter((x) => typeof x === "string").join("");
  assert.deepStrictEqual(wtId.map(idText), ["qpslqqptwxyz"], "worktree id = the head's change id");
  assert.strictEqual(findEl(rows[0], (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className === "dswFiles_changeWhen").map((n) => String(n.c))[0], "files.editing", "'Editing' rides in the when slot (the @ marker is gone)");
  assert.strictEqual(findEl(rows[0], (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className === "dswFiles_changeDesc").map((n) => String(n.c))[0], "wip", "worktree sub = the description (commit-row conventions, no aggregate)");
  const commitPills = findEl(rows[1], (n) => typeof n.p?.className === "string" && n.p.className.includes("dswFiles_changePill"));
  assert.deepStrictEqual(commitPills.map((p) => String(Array.isArray(p.c) ? p.c.join("") : p.c)).sort(), ["main", "v0.2.0"], "commit pills: bookmark + tag");
  assert.ok(commitPills.some((p) => p.p.className.includes("dswFiles_changePillTag")), "tag pills get the outlined variant");
  // The selected (worktree) change's file list nests under its row.
  const changeFiles = findEl(viewVcs, (n) => typeof n.p?.["data-files-change-file"] === "string");
  assert.deepStrictEqual(changeFiles.map((n) => n.p["data-files-change-file"]).sort(), ["a.txt", "docs/n.md"], "worktree file list = the status block's changes");
  // The file list is directory-grouped, expanded by default: `docs` is a
  // dir row (chevron + folder glyph, aria-expanded=true) with `n.md` nested
  // at depth 1; `a.txt` sits at the root level. Directories precede files.
  const topUl = findCls(viewVcs, "dswFiles_changeFiles")[0];
  const topChildren = (Array.isArray(topUl.c) ? topUl.c : []).filter((n) => n && typeof n === "object");
  assert.deepStrictEqual(topChildren.map((n) => (n.p && n.p["data-files-change-dir"]) || (n.p && n.p["data-files-change-file"])), ["docs", "a.txt"], "root level: the dir first, then the root file");
  const docsLi = topChildren.find((n) => n.p && n.p["data-files-change-dir"] === "docs");
  const dirRowBtn = findEl(docsLi, (n) => typeof n.p?.className === "string" && n.p.className.includes("dswFiles_changeDirRow"));
  assert.ok(dirRowBtn.length === 1, "the dir row renders its row button");
  assert.strictEqual(dirRowBtn[0].p["aria-expanded"], true, "directories start expanded (not in the folded set)");
  const nestedUl = findEl(docsLi, (n) => n.p && n.p.className === "dswFiles_changeFilesLevel");
  assert.strictEqual(nestedUl.length, 1, "the nested level renders under the dir row");
  assert.strictEqual(findEl(nestedUl[0], (n) => n.p && n.p["data-files-change-file"] === "docs/n.md").length, 1, "the nested file sits at depth 1");
  const rootFileLi = topChildren.find((n) => n.p && n.p["data-files-change-file"] === "a.txt");
  assert.ok(findEl(rootFileLi, (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className.includes("dswFiles_badgeM")).length === 1, "the modified root file shows its status badge");
  // A read-only profile (no composer write path) keeps the tree fully
  // readable.
  mod.__test.navCacheSet("sess-vcs-ro", { rootListing, commitList: vcs.commits });
  const viewVcsRO = registered.comp({
    t: (k) => k,
    sessionId: "sess-vcs-ro",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, rootListing)),
    tabActions: { openTab: () => {}, openResource: () => {} },
  });
  assert.strictEqual(findCls(viewVcsRO, "dswFiles_changeTree").length, 1, "no composer write path → the tree is still readable");
  assert.strictEqual(findCls(view, "dswFiles_changeTree").length, 0, "no vcs block → no change tree");
  // Non-VCS empty state: the listing is ready and the vcs block is absent →
  // the note + the handoff to the official file viewer (only with tab actions).
  const plainListing = { root: "/ws", relPath: "", entries: [
    { name: "a.txt", path: "a.txt", isDirectory: false, hidden: false, size: 11, mtime: Date.now() },
  ] };
  mod.__test.navCacheSet("sess-plain", { rootListing: plainListing });
  const viewPlain = registered.comp({
    t: (k) => k,
    sessionId: "sess-plain",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, plainListing)),
    tabActions: { openTab: (kind) => drafts.push("openTab:" + kind), openResource: () => {} },
  });
  const noVcs = findCls(viewPlain, "dswFiles_noVcs");
  assert.strictEqual(noVcs.length, 1, "ready listing + no vcs block → the non-VCS note renders");
  assert.strictEqual(findCls(viewPlain, "dswFiles_changeTree").length, 0, "…but no change tree");
  const noVcsBtn = findEl(viewPlain, (n) => typeof n.p?.["data-files-open-files-tab"] !== "undefined");
  assert.strictEqual(noVcsBtn.length, 1, "the note offers the Files handoff (tab actions present)");
  assert.strictEqual(noVcsBtn[0].p.title, undefined, "the handoff button is labeled (no tooltip needed)");
  // No tab actions (pre-0.1.5 surface): the note stays, the handoff degrades.
  mod.__test.navCacheSet("sess-plain-ro", { rootListing: plainListing });
  const viewPlainRO = registered.comp({
    t: (k) => k,
    sessionId: "sess-plain-ro",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, plainListing)),
  });
  assert.strictEqual(findCls(viewPlainRO, "dswFiles_noVcs").length, 1, "read-only surface: the note still renders");
  assert.strictEqual(findEl(viewPlainRO, (n) => typeof n.p?.["data-files-open-files-tab"] !== "undefined").length, 0, "…and the handoff degrades away");
  // Still loading (no cached listing): no note (it must not flash pre-load).
  const viewLoading = registered.comp({
    t: (k) => k,
    sessionId: "sess-loading",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, plainListing)),
    tabActions: { openTab: () => {}, openResource: () => {} },
  });
  assert.strictEqual(findCls(viewLoading, "dswFiles_noVcs").length, 0, "listing not yet ready → no note");
}

// 5c) Long history: the elision fold is gone — every fetched commit gets a
//     row (the host caps the list at 50; the log pane scrolls).
{
  const many = [];
  for (let i = 0; i < 25; i++) {
    many.push({
      id: "c" + String(i).padStart(2, "0") + "aaaaaaaa",
      commitId: "e" + i + "23456789abcd",
      conflict: false, empty: i % 4 === 0, author: "jeff@x",
      date: "2026-07-10T09:00:00", bookmarks: [], tags: [], description: "commit " + i,
    });
  }
  const vcsMany = {
    ok: true, backend: "jj",
    head: { id: "abcd1234ef56", changeId: "qpslqqptwxyz", bookmarks: [], tags: [], description: "wip", marker: "@" },
    changes: [], conflicts: [], commits: many,
  };
  const listingMany = { root: "/ws", relPath: "", entries: [], vcs: vcsMany };
  mod.__test.navCacheSet("sess-vcs-many", { rootListing: listingMany, commitList: many });
  const viewMany = registered.comp({
    t: (k) => k,
    sessionId: "sess-vcs-many",
    listDirectory: (p) => Promise.resolve(listingMany),
    tabActions: { openTab: () => {}, openResource: () => {} },
  });
  const manyRows = findEl(viewMany, (n) => typeof n.p?.["data-files-change"] === "string" && n.t === "button");
  assert.strictEqual(manyRows.length, 26, "25 commits → all 25 rows + the worktree row render (no fold)");
  assert.strictEqual(manyRows[25].p["data-files-change"], "e2423456789abcd", "the 25th (oldest) commit row is present (selected by its commit id)");
  assert.strictEqual(findEl(viewMany, (n) => typeof n.p?.className === "string" && n.p.className.includes("dswFiles_changeMore")).length, 0, "no elision row");
}

// 5d) A divergent change + a fork (the boxcar3d screenshot shape): one
//     change id, two commits — rows key AND select on the COMMIT id
//     (data-files-change, the snapshot fetch, the agent ref token): each of
//     the divergent pair reviews its own commit, so a saved rev selects
//     exactly one of the two rows. The /N offset renders after the id
//     (hidden takes label precedence over divergent), the sync sigils +
//     @remote + workspace names render as their pill variants, and the
//     fork's two children sit on separate lanes.
{
  const vcsD = {
    ok: true, backend: "jj",
    head: { id: "aa0000000000", changeId: "zzzzqqqqwxyz", bookmarks: [], tags: [], workspaces: ["main"], parents: ["ac06e11a9999"], description: "wip" },
    changes: [], conflicts: [],
    commits: [
      // Fork: ws1xskmq/0 and ws1xskmq/1 are SIBLINGS (both children of the
      // base's commit), the side child hangs off ws1xskmq/1, the base's own
      // parent is below the fold (elided edge).
      { id: "ws1xskmq0000", commitId: "db4302681234", glyph: "○", conflict: false, empty: false, author: "jeff@x", date: "2026-07-10T10:00:00", bookmarks: ["dev@origin*"], tags: [], workspaces: [], hidden: false, divergent: true, offset: 0, tracking: [{ name: "dev", remote: "origin", ahead: 1, behind: 0 }], parents: ["bbbb22222222c"], description: "fork child 1" },
      { id: "ws1xskmq0000", commitId: "3efe5a9e1234", glyph: "○", conflict: false, empty: false, author: "jeff@x", date: "2026-07-10T11:00:00", bookmarks: [], tags: [], workspaces: ["ws1"], hidden: true, divergent: true, offset: 1, parents: ["bbbb22222222c"], description: "fork child 2" },
      { id: "qsvyormx9999", commitId: "ac06e11a9999", glyph: "○", conflict: false, empty: false, author: "jeff@x", date: "2026-07-09T09:00:00", bookmarks: ["main*"], tags: [], parents: ["3efe5a9e1234"], description: "side child" },
      { id: "bbbb22222222", commitId: "bbbb22222222c", glyph: "○", conflict: false, empty: false, author: "jeff@x", date: "2026-07-08T08:00:00", bookmarks: [], tags: [], parents: ["cccc33333333"], description: "base of the fork" },
    ],
  };
  const listingD = { root: "/ws", relPath: "", entries: [], vcs: vcsD };
  mod.__test.navCacheSet("sess-vcs-d", { rootListing: listingD, commitList: vcsD.commits });
  const viewD = registered.comp({
    t: (k) => k,
    sessionId: "sess-vcs-d",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, listingD)),
    tabActions: { openTab: () => {}, openResource: () => {} },
  });
  const dRows = findEl(viewD, (n) => typeof n.p?.["data-files-change"] === "string" && n.t === "button");
  assert.strictEqual(dRows.length, 5, "divergent+fork: worktree + 4 rows");
  assert.deepStrictEqual(dRows.map((r) => r.p["data-files-change"]),
    ["worktree", "db4302681234", "3efe5a9e1234", "ac06e11a9999", "bbbb22222222c"],
    "divergent change: each row selects by its OWN commit id (data-files-change)");
  // Per-commit selection: a saved rev is a COMMIT id; of the divergent
  // change's two rows, only the matching row is selected (the old behavior
  // keyed on the shared change id lit both rows up).
  globalThis.localStorage.setItem("changestab/files/sess-vcs-d",
    JSON.stringify({ selected: null, navW: null, rev: "3efe5a9e1234", collapsed: false }));
  const viewDSel = registered.comp({
    t: (k) => k,
    sessionId: "sess-vcs-d",
    listDirectory: (p) => Promise.resolve(Object.assign({ root: "/ws", relPath: p }, listingD)),
    tabActions: { openTab: () => {}, openResource: () => {} },
  });
  const selRows = findEl(viewDSel, (n) => typeof n.p?.["data-files-change"] === "string" && n.t === "button");
  assert.strictEqual(selRows[0].p["aria-selected"], false, "saved commit rev: the worktree row is not selected");
  assert.strictEqual(selRows[1].p["aria-selected"], false, "ws1xskmq/0 (the sibling commit) is NOT selected");
  assert.strictEqual(selRows[2].p["aria-selected"], true, "ws1xskmq/1 (the saved commit's own row) IS selected");
  globalThis.localStorage.removeItem("changestab/files/sess-vcs-d");
  // The /N change offset: bold span after the id, on the divergent/hidden rows only.
  const offsets = (row) => findEl(row, (n) => n.t === "span" && n.p?.className === "dswFiles_changeIdOff").map((n) => String(n.c));
  assert.deepStrictEqual(offsets(dRows[1]), ["/0"], "ws1xskmq/0: the offset renders as /0");
  assert.deepStrictEqual(offsets(dRows[2]), ["/1"], "ws1xskmq/1: the offset renders as /1");
  assert.deepStrictEqual(offsets(dRows[3]), [], "non-divergent row: no offset");
  // The labels: (divergent) on the plain divergent row; (hidden) takes
  // precedence over (divergent) on the hidden row.
  const labels = (row) => findEl(row, (n) => n.t === "span" && typeof n.p?.className === "string" && n.p.className.startsWith("dswFiles_changeLabel")).map((n) => String(n.c));
  assert.deepStrictEqual(labels(dRows[1]), ["files.divergent"], "ws1xskmq/0: (divergent) label");
  assert.deepStrictEqual(labels(dRows[2]), ["files.hidden"], "ws1xskmq/1: (hidden) takes precedence over (divergent)");
  // The sigils: `dev@origin*` = name + dim @remote + warn `*`, with the
  // tracked ahead/behind in the tooltip.
  const devPill = findEl(dRows[1], (n) => n.t === "span" && n.p?.title === "dev@origin — files.ahead 1, files.behind 0");
  assert.strictEqual(devPill.length, 1, "dev@origin* pill: the tracked counts join the tooltip");
  assert.strictEqual(devPill[0].p.className, "dswFiles_changePill", "dev@origin*: a plain bookmark pill (remote/sigil are inner spans)");
  assert.deepStrictEqual(findEl(dRows[1], (n) => n.t === "span" && n.p?.className === "dswFiles_changePillRemote").map((n) => String(n.c)), ["@origin"], "dev@origin*: the @remote part is dim");
  assert.deepStrictEqual(findEl(dRows[1], (n) => n.t === "span" && n.p?.className === "dswFiles_changePillSigil").map((n) => String(n.c)), ["*"], "dev@origin*: the sync sigil renders");
  // `main*` on the side child; the workspace pill on ws1xskmq/1 + the worktree.
  assert.deepStrictEqual(findEl(dRows[3], (n) => n.t === "span" && n.p?.className === "dswFiles_changePillSigil").map((n) => String(n.c)), ["*"], "main*: the local-unsynced sigil");
  assert.strictEqual(findEl(dRows[2], (n) => n.t === "span" && n.p?.className === "dswFiles_changePill dswFiles_changePillWs").length, 1, "ws1xskmq/1: the workspace pill renders");
  assert.strictEqual(findEl(dRows[0], (n) => n.t === "span" && n.p?.className === "dswFiles_changePill dswFiles_changePillWs").length, 1, "worktree row: the head's workspace pill renders");
}

// The saved blob is exactly the five-field shape (the tree is NOT persisted
// — it is derived from the selected change's status block on every load).
{
  const S = "sess-shape";
  const key = "changestab/files/" + S;
  globalThis.localStorage.removeItem(key);
  H.saveState(S, "src/dsh/client.tsx", 633.4, "aaaa11111111", true, 180);
  const saved = JSON.parse(globalThis.localStorage.getItem(key));
  assert.deepStrictEqual(Object.keys(saved).sort(), ["collapsed", "navW", "rev", "selected", "treeH"], "saveState: the five fields, nothing else");
  assert.strictEqual(saved.navW, 633, "saveState: the width is rounded");
  assert.strictEqual(saved.treeH, 180, "saveState: the log-pane height is stored");
  globalThis.localStorage.setItem(key, JSON.stringify({ selected: "a.txt", navW: "wide", rev: 7, collapsed: "yes", treeH: "tall", junk: true }));
  assert.deepStrictEqual(H.loadState(S), { selected: "a.txt", navW: null, rev: null, collapsed: false, treeH: null }, "loadState: wrong field types degrade to the defaults (junk ignored)");
  globalThis.localStorage.removeItem(key);
}
delete globalThis.localStorage;

// 7b) The change graph's lane layout (the jj-log-style tree lines). Pure
//     function over (key, parents) rows in display order (newest first);
//     per lane per row: vT (line above the node level), vB (line below it),
//     h (horizontal arm at the node level: L/R/B), node (the bullet). The
//     goldens are the hand-derived shapes, checked against the algorithm
//     spec in layoutChangeGraph's header.
{
  const cell = (vT, vB, h, node) => [vT, vB, h, node];
  const rows = (g) => g.rows.map((r) => r.cells.map((c) => cell(c.vT, c.vB, c.h, c.node)));

  // A linear chain: one lane, the node level is the only horizontal, the
  // line runs from the first node to the last (the root has no line below).
  let g = H.layoutChangeGraph([
    { key: "w", parents: ["c1"] },
    { key: "c1", parents: ["c2"] },
    { key: "c2", parents: ["c3"] },
    { key: "c3", parents: [] },
  ]);
  assert.strictEqual(g.lanes, 1, "linear: one lane");
  assert.deepStrictEqual(rows(g), [
    [cell(false, true, "", true)],
    [cell(true, true, "", true)],
    [cell(true, true, "", true)],
    [cell(true, false, "", true)],
  ], "linear chain: bullets + one continuous line, no line below the root");

  // A merge: m (parents b1, b2), then b2, b1 (both parents a), then root a.
  // m opens a second lane for b2; the two lines converge on a.
  g = H.layoutChangeGraph([
    { key: "m", parents: ["b1", "b2"] },
    { key: "b2", parents: ["a"] },
    { key: "b1", parents: ["a"] },
    { key: "a", parents: [] },
  ]);
  assert.strictEqual(g.lanes, 2, "merge: two lanes");
  assert.deepStrictEqual(rows(g), [
    [cell(false, true, "R", true), cell(false, true, "L", false)], // m: the arm to the new lane
    [cell(true, true, "", false), cell(true, true, "", true)],    // b2: lane 0 passes, b2 on lane 1
    [cell(true, true, "", true), cell(true, true, "", false)],    // b1: the mirror
    [cell(true, false, "R", true), cell(true, false, "L", false)],// a: both lines converge
  ], "merge: the arm opens at m, the two lines run parallel, they converge on a");

  // Siblings: c3 branches off beside c2 (both children of c1). The new
  // sibling takes the NEXT lane; its line ends at the shared parent c1.
  g = H.layoutChangeGraph([
    { key: "c2", parents: ["c1"] },
    { key: "c3", parents: ["c1"] },
    { key: "c1", parents: ["c0"] },
    { key: "c0", parents: [] },
  ]);
  assert.strictEqual(g.lanes, 2, "siblings: two lanes");
  assert.deepStrictEqual(rows(g), [
    [cell(false, true, "", true)],
    [cell(true, true, "", false), cell(false, true, "", true)], // c3: new lane, no arm (nothing to connect to)
    [cell(true, true, "R", true), cell(true, false, "L", false)], // c1: the side line ends here
    [cell(true, false, "", true), cell(false, false, "", false)], // c0: lane 1 is empty
  ], "siblings: the side line opens with no arm and ends with an arm at the shared parent");

  // Elided parent: the window shows only the tip; its parent is below the
  // fold. The line must run OUT of the bottom edge (vB stays true).
  g = H.layoutChangeGraph([
    { key: "tip", parents: ["below"] },
  ]);
  assert.deepStrictEqual(rows(g), [[cell(false, true, "", true)]], "elided parent: the line runs out of the window");

  // Floor (a parentless node — jj's root): the contrast to the elided case. A
  // dangling edge still in flight AT the floor (a parent outside the loaded
  // window) is clipped there, so no line runs off the bottom past the root.
  // (The real changestab history: the main bookmark's parent is an orphan that
  // builtin_log() drops, leaving its line to dangle down to the floor.)
  g = H.layoutChangeGraph([
    { key: "wt", parents: ["A"] },
    { key: "A", parents: ["B"] },
    { key: "C", parents: ["orphan"] }, // a bookmark branch whose parent is outside the window
    { key: "B", parents: ["root"] },
    { key: "root", parents: [] },
  ]);
  assert.strictEqual(g.lanes, 2, "floor: two lanes (main line + the bookmark's dangling edge)");
  assert.deepStrictEqual(rows(g)[4], [
    cell(true, false, "", true),  // the root's node: the main line lands and stops
    cell(true, false, "", false), // the dangling edge: clipped at the floor, not run off
  ], "floor: a parent-outside-the-window edge is clipped at the root, not run off the bottom");

  // A second parent that opens a lane to the LEFT of the node (lane 0 was
  // freed when the first line ended): the arm runs left, the node carries
  // the left arm.
  g = H.layoutChangeGraph([
    { key: "a", parents: ["b", "c"] },
    { key: "b", parents: [] },
    { key: "c", parents: ["d", "e"] },
    { key: "d", parents: [] },
    { key: "e", parents: [] },
  ]);
  assert.strictEqual(g.lanes, 2, "left-outgoing: two lanes (lane 0 was freed when b's line ended)");
  assert.deepStrictEqual(rows(g)[2], [
    cell(false, true, "R", false), // e opens in freed lane 0 (LEFT of c)
    cell(true, true, "L", true),   // c on lane 1, the arm runs left
  ], "left-outgoing: a parent line may open to the LEFT of the node");
  assert.deepStrictEqual(rows(g)[3], [
    cell(true, true, "", false),  // e's line passes on lane 0
    cell(true, false, "", true),  // d on lane 1
  ], "left-outgoing: the opened line passes through the other parent's row");

  // A fork (the screenshot shape): one parent, two children on separate
  // lanes, a side child hanging off one of them. Structural invariants
  // (the exact lanes depend on the algorithm's lane bookkeeping).
  g = H.layoutChangeGraph([
    { key: "ws0", parents: ["base"] },
    { key: "ws1", parents: ["base"] },
    { key: "qsv", parents: ["ws1"] },
    { key: "base", parents: [] },
  ]);
  assert.ok(g.lanes >= 2, "fork: the siblings take separate lanes");
  g.rows.forEach((r, i) => assert.strictEqual(r.cells.filter((c) => c.node).length, 1, "fork row " + i + ": exactly one node"));
  const forkLane = (r) => r.cells.findIndex((c) => c.node);
  assert.notStrictEqual(forkLane(g.rows[0]), forkLane(g.rows[1]), "fork: the two children's nodes sit on different lanes");
  assert.ok(g.rows[3].cells.every((c) => c.vT), "fork: both lines pass through the shared parent's row");

  // Empty input: no rows, no lanes.
  g = H.layoutChangeGraph([]);
  assert.deepStrictEqual(g, { rows: [], lanes: 0 }, "empty: no rows, no lanes");
}

// 8) Unified-diff parser (M2), table tests against the golden fixtures, which
//    are captured VERBATIM from jj 0.44's `jj diff --git` output.
const D = mod.__test;
const fx = (name) => readFileSync(fileURLToPath(new URL("./fixtures/diffs/" + name, import.meta.url)), "utf8");

{ const f = D.parseDiff(fx("modify.txt")).files[0];
  assert.strictEqual(f.oldPath, "mod.txt", "modify: old path from diff --git");
  assert.strictEqual(f.newPath, "mod.txt", "modify: new path from diff --git");
  assert.strictEqual(f.hunks.length, 1, "modify: one hunk");
  assert.deepStrictEqual(f.hunks[0].rows.map((r) => [r.k, r.oldNo, r.newNo]),
    [["ctx", 1, 1], ["del", 2, null], ["add", null, 2], ["ctx", 3, 3], ["ctx", 4, 4]],
    "modify: row kinds + numbers follow the real lines"); }

{ const f = D.parseDiff(fx("modify-multi.txt")).files[0];
  assert.strictEqual(f.hunks.length, 2, "modify-multi: two hunks");
  assert.strictEqual(f.hunks[0].rows.length, 8, "modify-multi: hunk 1 has all 8 rows (3ctx + del + add + 3ctx; the @@ ,7 is per-side)");
  assert.deepStrictEqual(D.gapAfter(f.hunks[0], f.hunks[1]), { old: [9, 31], new: [9, 31] },
    "modify-multi: gap between hunks computed from @@ headers alone"); }

{ const f = D.parseDiff(fx("add.txt")).files[0];
  assert.ok(f.isNew, "add: new-file flag");
  assert.strictEqual(f.oldPath, "/dev/null", "add: /dev/null old side");
  assert.strictEqual(f.hunks[0].oldStart, 0, "add: old side anchored at 0");
  assert.ok(f.hunks[0].rows.every((r) => r.k === "add") && f.hunks[0].rows.length === 2, "add: all rows are adds"); }

{ const f = D.parseDiff(fx("delete.txt")).files[0];
  assert.ok(f.isDeleted, "delete: deleted flag");
  assert.strictEqual(f.newPath, "/dev/null", "delete: /dev/null new side");
  assert.strictEqual(f.hunks[0].rows[0].k, "del", "delete: single del row"); }

{ const f = D.parseDiff(fx("rename.txt")).files[0];
  assert.strictEqual(f.renameFrom, "ren.txt", "rename: rename from");
  assert.strictEqual(f.renameTo, "renamed.txt", "rename: rename to");
  assert.strictEqual(f.hunks.length, 0, "rename: pure rename has no hunks"); }

{ const f = D.parseDiff(fx("rename-modified.txt")).files[0];
  assert.strictEqual(f.renameFrom, "big.txt", "rename+mod: rename headers");
  assert.strictEqual(f.renameTo, "big-renamed.txt", "rename+mod: rename to");
  assert.strictEqual(f.hunks.length, 1, "rename+mod: rename headers AND hunks");
  assert.deepStrictEqual(D.displayRows(f.hunks[0]).map((d) => d.type),
    ["ctx", "ctx", "ctx", "mod", "ctx", "ctx", "ctx"], "rename+mod: the changed line pairs into one mod row"); }

// C3: real-path identity. Deleted files carry the /dev/null placeholder in
// newPath (new files in oldPath), identity/display must resolve to the REAL
// path, or every deleted file collides (scroll-reset key) and the header
// prints "/dev/null" as the name.
{
  const base = { isNew: false, isDeleted: false, isBinary: false, modeFrom: null, modeTo: null, renameFrom: null, renameTo: null, hunks: [] };
  assert.strictEqual(D.realPathOf({ ...base, oldPath: "/dev/null", newPath: "brand.txt" }), "brand.txt", "new file → the real newPath");
  assert.strictEqual(D.realPathOf({ ...base, oldPath: "gone.txt", newPath: "/dev/null" }), "gone.txt", "deleted file → the real oldPath");
  assert.strictEqual(D.realPathOf({ ...base, oldPath: "same.txt", newPath: "same.txt" }), "same.txt", "modified → either side");
  const del = D.parseDiff(fx("delete.txt")).files[0];
  assert.strictEqual(D.realPathOf(del), del.oldPath, "a parsed deleted file resolves to its real path");
  assert.notStrictEqual(D.realPathOf(del), "/dev/null", "never the placeholder");
}

{ const f = D.parseDiff(fx("binary.txt")).files[0];
  assert.ok(f.isBinary, "binary: notice detected");
  assert.strictEqual(f.hunks.length, 0, "binary: no hunks"); }

{ const f = D.parseDiff(fx("chmod.txt")).files[0];
  assert.strictEqual(f.modeFrom, "100644", "chmod: old mode");
  assert.strictEqual(f.modeTo, "100755", "chmod: new mode");
  assert.strictEqual(f.hunks.length, 0, "chmod: mode-only, no hunks"); }

{ const rows = D.parseDiff(fx("no-newline.txt")).files[0].hunks[0].rows;
  assert.strictEqual(rows.length, 2, "no-newline: two rows (the \\ lines are markers, not rows)");
  assert.ok(rows[0].noNewline && rows[1].noNewline, "no-newline: marker attributed to each side"); }

{ const rows = D.parseDiff(fx("crlf.txt")).files[0].hunks[0].rows;
  assert.ok(rows[2].text.endsWith("\r"), "crlf: \\r kept on the add line (white-space:pre renders it)"); }

{ const f = D.parseDiff(fx("spaces.txt")).files[0];
  assert.strictEqual(f.newPath, "di r/sp aced.txt", "spaces: path with spaces survives the header regex"); }

{ assert.deepStrictEqual(D.parseDiff(fx("empty.txt")).files, [], "empty patch → no files"); }

// Truncation: cut the real multi-hunk patch mid-hunk (host 1 MB cap
// simulation). The parser must stay in sync, numbers follow the lines that
// are actually present, never the (now lying) hunk counts.
{ const full = fx("modify-multi.txt").split("\n");
  const idx = full.findIndex((l) => l.indexOf("@@ -32") === 0);
  const cut = full.slice(0, idx + 4).join("\n"); // hunk 2 header + only 3 of its 7 lines
  const f = D.parseDiff(cut).files[0];
  assert.strictEqual(f.hunks.length, 2, "truncated: the second @@ header still parses");
  assert.deepStrictEqual(f.hunks[1].rows.map((r) => [r.k, r.oldNo]),
    [["ctx", 32], ["ctx", 33], ["ctx", 34]], "truncated: numbers follow present lines, not hunk counts"); }

// A deleted line whose TEXT starts with `-- ` must stay a del row, the
// `--- `/`+++ ` header check is only valid before the first hunk of a section.
{ const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n---- a/fake\n+keep\n";
  const rows = D.parseDiff(patch).files[0].hunks[0].rows;
  assert.strictEqual(rows.length, 2, "content guard: two rows");
  assert.strictEqual(rows[0].k, "del", "content guard: `---- …` is a del row");
  assert.strictEqual(rows[0].text, "--- a/fake", "content guard: text kept verbatim"); }

// Hunk counts are never trusted, even when they disagree with the rows.
{ const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,9 @@\n ctx\n-x\n+y\n+z\n";
  const rows = D.parseDiff(patch).files[0].hunks[0].rows;
  assert.deepStrictEqual(rows.map((r) => [r.k, r.oldNo, r.newNo]),
    [["ctx", 1, 1], ["del", 2, null], ["add", null, 2], ["add", null, 3]],
    "hunk counts ignored; numbers follow the real lines"); }

// Gap math at the edges: zero-count hunks anchor at a phantom line 0 → the
// clamp keeps the range on real lines.
{ const h1 = { oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 };
  const h2 = { oldStart: 5, oldCount: 1, newStart: 10, newCount: 1 };
  assert.deepStrictEqual(D.gapAfter(h1, h2), { old: [1, 4], new: [3, 9] }, "gap: zero-count hunk anchors");
  assert.strictEqual(D.gapAfter(h1, h1), null, "gap: null when nothing is between"); }

// Mod pairing: order-pair the contiguous del run with the following add run;
// the surplus keeps its row with a blank opposite cell.
{ const mk = (k, n, t2) => ({ k, text: t2, oldNo: k === "add" ? null : n, newNo: k === "del" ? null : n, noNewline: false });
  assert.deepStrictEqual(D.displayRows({ rows: [mk("del", 1, "a"), mk("del", 2, "b"), mk("add", 1, "x")] }).map((d) => d.type),
    ["mod", "del"], "pairing: -a -b +c → one mod, surplus del kept");
  assert.deepStrictEqual(D.displayRows({ rows: [mk("del", 1, "a"), mk("add", 1, "x"), mk("add", 2, "y")] }).map((d) => d.type),
    ["mod", "add"], "pairing: surplus add kept");
  assert.deepStrictEqual(D.displayRows({ rows: [mk("del", 1, "a"), mk("ctx", 2, "b"), mk("add", 2, "c")] }).map((d) => d.type),
    ["del", "ctx", "add"], "pairing: a ctx line breaks the block (no cross-ctx pairing)");
  assert.deepStrictEqual(D.displayRows({ rows: [mk("add", 1, "x"), mk("add", 2, "y")] }).map((d) => d.type),
    ["add", "add"], "pairing: an add run alone stays adds"); }
// Same-line pairing: a line that moved inside a block pairs with its own
// copy instead of smearing into its neighbors (the re-alignment case — an
// Odin struct whose `=` column moved with a new field). The leftover
// positional rule still applies to the non-identical rows.
{ const mk = (k, n, t2) => ({ k, text: t2, oldNo: k === "add" ? null : n, newNo: k === "del" ? null : n, noNewline: false });
  const rows = D.displayRows({ rows: [
    mk("del", 1, "sim = sim,"), mk("del", 2, "mesh = mesh,"), mk("del", 3, "fit = fit,"),
    mk("add", 1, "sim = sim,"), mk("add", 2, "mesh = mesh,"), mk("add", 3, "debris = debris,"), mk("add", 4, "fit = fit,")] });
  assert.deepStrictEqual(rows.map((d) => d.type), ["mod", "mod", "add", "mod"], "pairing: identical lines pair, the real insertion stays a solo add");
  assert.deepStrictEqual(rows.filter((d) => d.type === "mod").map((d) => [d.old.text, d.nw.text]),
    [["sim = sim,", "sim = sim,"], ["mesh = mesh,", "mesh = mesh,"], ["fit = fit,", "fit = fit,"]], "pairing: each line pairs with its identical copy");
  assert.strictEqual(rows[2].nw.text, "debris = debris,", "pairing: the solo add is the real insertion");
  // A swap (a line moves down within the block): the identical copies pair
  // even though their positions cross; the display keeps the new file's order.
  const swapped = D.displayRows({ rows: [mk("del", 1, "x"), mk("del", 2, "a"), mk("add", 1, "a"), mk("add", 2, "x")] });
  assert.deepStrictEqual(swapped.map((d) => d.type), ["add", "mod", "del"], "pairing: a move within a block reads as add / mod / del in new-file order");
  assert.strictEqual(swapped[1].old.text, "x", "pairing: the mod row pairs the identical 'x' copies");
  assert.strictEqual(swapped[1].nw.text, "x", "pairing: the mod row pairs the identical 'x' copies");
  // The load-bearing re-alignment: the `=` column moved, so NO pair is
  // byte-identical — matching must be whitespace-normalized, or every line
  // smears into its shifted neighbor (the false-change the toggle alone
  // does not fix, because the default view is fetched WITHOUT -w).
  const re = D.displayRows({ rows: [
    mk("del", 1, "sim     = sim,"), mk("del", 2, "mesh    = mesh,"), mk("del", 3, "fitness = fitness,"),
    mk("add", 1, "sim         = sim,"), mk("add", 2, "mesh        = mesh,"), mk("add", 3, "debris_mesh = debris,"), mk("add", 4, "fitness     = fitness,")] });
  assert.deepStrictEqual(re.map((d) => d.type), ["mod", "mod", "add", "mod"], "pairing: re-aligned lines pair by normalized identity, the insertion stays a solo add");
  assert.strictEqual(re[0].nw.text, "sim         = sim,", "pairing: the pair crosses the whitespace difference");
  assert.ok(re.every((d) => d.type !== "mod" || D.modDimKind(d.old.text, d.nw.text) !== null), "pairing: every re-aligned mod row is dim-eligible (ws)");
  // Above the O(n·m) cap the identical-text scan is skipped (pathological
  // block) — positional pairing alone must still produce the right row count.
  const big = [];
  for (let i = 0; i < 401; i++) big.push(mk("del", i + 1, "same-line"));
  for (let i = 0; i < 250; i++) big.push(mk("add", i + 1, "same-line"));
  const bigRows = D.displayRows({ rows: big });
  assert.strictEqual(bigRows.length, 401, "pairing: above the O(n·m) cap → the positional fallback keeps one row per del");
  assert.strictEqual(bigRows.filter((d) => d.type === "mod").length, 250, "pairing: cap fallback pairs positionally"); }
// The dimmed "false change": identical or whitespace-only mod pairs get the
// neutral tint (modDimKind), a real change keeps the full red/green.
{ assert.strictEqual(D.modDimKind("a   b", "a b"), "ws", "dim: a whitespace-only difference → ws");
  assert.strictEqual(D.modDimKind("same", "same"), "moved", "dim: identical lines → moved");
  assert.strictEqual(D.modDimKind("abc", "abd"), null, "dim: a real change → null"); }
// unifiedPairs (the narrow view) uses the same run matching: the intra-line
// spans pair identical copies, not positional neighbors.
{ const mk = (k, n, t2) => ({ k, text: t2, oldNo: k === "add" ? null : n, newNo: k === "del" ? null : n, noNewline: false });
  const dA = mk("del", 1, "a"), dB = mk("del", 2, "b"), aA = mk("add", 1, "b"), aB = mk("add", 2, "a");
  const up = D.unifiedPairs({ rows: [dA, dB, aA, aB] });
  assert.strictEqual(up.get(dA)?.other, aB, "unifiedPairs: del 'a' pairs with its identical add copy");
  assert.strictEqual(up.get(dA)?.side, "old", "unifiedPairs: the del row carries side old");
  assert.strictEqual(up.get(aA)?.other, dB, "unifiedPairs: add 'b' pairs with its identical del copy");
  assert.strictEqual(up.get(aA)?.side, "new", "unifiedPairs: the add row carries side new"); }

// Intra-line diff (BUG-003, reworked per BUG-010 after checking the
// established renderers — git xdiff word-diff, diff-highlight, jsdiff
// diffWords): the alignment runs over NON-WHITESPACE tokens only, a maximal
// run of consecutive changed tokens is ONE contiguous span whose text is
// the original line verbatim (internal whitespace highlighted with it,
// boundary whitespace stays context), and a whitespace-only change gets no
// span at all. Identical lines, oversized pairs and dissimilar pairs skip.
{ const d = D.intraLineDiff("const x = 1;", "const x = 2;");
  assert.deepStrictEqual(d.old.map((s) => [s.cls, s.text]),
    [["same", "const x = "], ["del", "1"], ["same", ";"]], "intra: old side flags only the changed word");
  assert.deepStrictEqual(d.nw.map((s) => [s.cls, s.text]),
    [["same", "const x = "], ["add", "2"], ["same", ";"]], "intra: new side flags only the changed word"); }
{ assert.strictEqual(D.intraLineDiff("same line", "same line"), null, "intra: identical lines → null (row stays untouched)"); }
{ assert.strictEqual(D.intraLineDiff("a b".repeat(250), "c d".repeat(250)), null, "intra: token table above the cap → null (row tint only)"); }
// Similarity gate (BUG-004): word spans only help when the two line
// versions are genuinely similar. A rewrite (few shared tokens) falls back
// to the plain row tint instead of churning del/add fragments.
{ assert.strictEqual(D.intraLineDiff("beta", "BETA changed"), null, "intra: no shared tokens → null (row tint only, BUG-004)"); }
{ assert.strictEqual(D.intraLineDiff("alpha beta gamma delta", "omega gamma theta zeta"), null, "intra: < 50% of the shorter line shared → null (BUG-004)"); }
// An indent change on an otherwise-similar line rides the first same
// segment (boundary whitespace is context, as in git's rendering).
{ const d = D.intraLineDiff("if (a) doX();", "  if (a) doY();");
  assert.deepStrictEqual(d.old.map((s) => [s.cls, s.text]),
    [["same", "if (a) "], ["del", "doX"], ["same", "();"]], "intra: old side flags only the changed word");
  assert.deepStrictEqual(d.nw.map((s) => [s.cls, s.text]),
    [["same", "  if (a) "], ["add", "doY"], ["same", "();"]], "intra: the indent change stays in the context segment"); }
// Whitespace-ONLY change (no word token differs): no span at all — git's
// xdiff word-diff shows no marker for it either (BUG-010 research).
{ assert.strictEqual(D.intraLineDiff("a b", "a  b"), null, "intra: a pure spacing change → no spans (row tint only)"); }
// The changed PHRASE is one contiguous span: the whitespace between changed
// tokens is part of the span, the boundary whitespace is not.
{ const d = D.intraLineDiff("one two", "one two three four");
  assert.deepStrictEqual(d.old.map((s) => [s.cls, s.text]),
    [["same", "one two"]], "intra: old side untouched");
  assert.deepStrictEqual(d.nw.map((s) => [s.cls, s.text]),
    [["same", "one two "], ["add", "three four"]], "intra: the inserted phrase is one span, inner space included, no trailing space"); }
// The owner's real pair from BUG-010 (print-md): the inserted `-rotate 90`
// phrase must not fragment into word islands with plain spaces between.
{ const d = D.intraLineDiff(
    "        -gravity center -background white -extent 3300x2550 \\",
    "        -rotate 90 -gravity center -background white -extent 2550x3300 \\");
  assert.deepStrictEqual(d.old.map((s) => [s.cls, s.text]),
    [["same", "        -gravity center -background white -extent "], ["del", "3300x2550"], ["same", " \\"]], "intra(010): old side flags only the dimension");
  const adds = d.nw.filter((s) => s.cls === "add").map((s) => s.text);
  assert.ok(adds.some((t) => /-?rotate 90/.test(t) && t.length > "rotate 90".length),
    "intra(010): the new side's insertion is ONE span that keeps its inner space: " + JSON.stringify(adds));
  assert.ok(adds.some((t) => t === "2550x3300"), "intra(010): the dimension swap is its own span");
  assert.strictEqual(d.nw.filter((s) => s.cls === "add").length, 2, "intra(010): exactly two spans on the new side (no word islands)"); }
{ const addRow = { k: "add", text: "const x = 2;", oldNo: null, newNo: 2, noNewline: false };
  const delRow = { k: "del", text: "const x = 1;", oldNo: 2, newNo: null, noNewline: false };
  const cells = D.unifiedCells(delRow, 0, { other: addRow, side: "old" });
  const inner = cells[1].c[0];
  const spans = (function w(n, out) {
    if (Array.isArray(n)) { for (const x of n) w(x, out); return out; }
    if (!n || typeof n !== "object") return out;
    if (n.t === "span" && n.p.className === "dswFiles_spanDel") out.push(n);
    else if (n.c) w(n.c, out);
    return out;
  })(inner, []);
  assert.strictEqual(spans.length, 1, "unified: a paired del row carries one spanDel");
  assert.strictEqual(spans[0].c[0], "1", "unified: spanDel carries the old text");
  const plain = D.unifiedCells(addRow, 0);
  const plainContent = plain[1].c[0].c[0]; // the content array [markerEl, ...intra segs...]
  assert.strictEqual(plainContent[0].p.className, "dswFiles_diffMark", "unified: the marker is its own span (the context menu excludes it from the snippet)");
  assert.strictEqual(String(plainContent[0].c[0]), "+", "unified: the marker span carries the + glyph");
  assert.strictEqual(plainContent[1], "const x = 2;", "unpaired add row stays plain text (no intra spans)"); }


// 9a2) Change-tree building blocks: the node-character tone (jj's own log
//      glyphs, host-supplied: @ wc / ◆ immutable / × conflict / ○ normal —
//      anything else is a stale-listing gap → normal), the pill cap math,
//      and the relative-date formatter (jj offset-less local ISO + git
//      offset-carrying %aI, >1 week → calendar date).
{ const t = (k) => k;
  assert.strictEqual(D.glyphTone("@"), "wc", "tone: @ → working copy");
  assert.strictEqual(D.glyphTone("◆"), "immutable", "tone: ◆ → immutable");
  assert.strictEqual(D.glyphTone("×"), "conflict", "tone: × → conflict");
  assert.strictEqual(D.glyphTone("○"), "normal", "tone: ○ → normal");
  assert.strictEqual(D.glyphTone(""), "normal", "tone: empty/stale gap → normal");
  const g = (s) => D.changeGlyph(s);
  assert.ok(g("@").p.className.includes("dswFiles_changeGlyph_wc") && String(g("@").c) === "@", "glyph el: @ text, wc class");
  assert.ok(g("◆").p.className.includes("dswFiles_changeGlyph_immutable"), "glyph el: ◆ immutable class");
  assert.ok(g("×").p.className.includes("dswFiles_changeGlyph_conflict"), "glyph el: × conflict class");
  assert.ok(g("○").p.className.includes("dswFiles_changeGlyph_normal") && String(g("○").c) === "○", "glyph el: ○ text, normal class");
  assert.deepStrictEqual(D.refPillList({ bookmarks: ["dev", "main"], tags: ["v1", "v2", "v3"] }, 3),
    [{ name: "dev", kind: "bookmark" }, { name: "main", kind: "bookmark" }, { name: "v1", kind: "tag" }], "pills: bookmarks first, then tags, capped");
  assert.strictEqual(D.refPillCount({ bookmarks: ["dev", "main"], tags: ["v1", "v2", "v3"] }), 5, "pills: total feeds the +N fold");
  assert.deepStrictEqual(D.refPillList({}, 3), [], "pills: empty refs → nothing");
  assert.deepStrictEqual(D.refPillList({ bookmarks: ["a"] }, 0), [], "pills: cap 0 → nothing");
  // jj's CLI ref strings: `name` + `@remote` + a trailing sigil — `??`
  // (conflicted ref), `*` (unsynced local ref). The remote splits at the
  // LAST @ (git ref names may contain @ themselves).
  assert.deepStrictEqual(D.refPillList({ bookmarks: ["main*", "dev@origin", "feat??"], workspaces: ["main"] }, 8),
    [{ name: "main", sigil: "*", kind: "bookmark" },
     { name: "dev", remote: "origin", kind: "bookmark" },
     { name: "feat", sigil: "??", kind: "bookmark" },
     { name: "main", kind: "workspace" }],
    "pills: sigils + @remote parsed off the jj ref strings; workspaces last");
  assert.deepStrictEqual(D.refPillList({ bookmarks: ["main@stable@origin??"] }, 8),
    [{ name: "main@stable", remote: "origin", sigil: "??", kind: "bookmark" }],
    "pills: the remote splits at the LAST @ (names may contain @)");
  // A local ref whose NAME ends like `x@2` is ambiguous with a remote ref
  // (jj's own CLI rendering is ambiguous the same way) — the last @ wins,
  // so it reads as remote "2".
  assert.deepStrictEqual(D.refPillList({ bookmarks: ["feature@2*"] }, 8),
    [{ name: "feature", remote: "2", sigil: "*", kind: "bookmark" }],
    "pills: name-looking `@2` tail reads as a remote (documented ambiguity)");
  assert.strictEqual(D.refPillCount({ bookmarks: ["a*"], tags: [], workspaces: ["main"] }), 2, "pills: workspaces count toward the +N fold");
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
  assert.strictEqual(D.whenOf(isoAgo(30_000), t), "files.ageNow", "when: <1m → now");
  assert.strictEqual(D.whenOf(isoAgo(5 * 60_000), t), "files.ageMin", "when: minutes");
  assert.strictEqual(D.whenOf(isoAgo(3 * 3_600_000), t), "files.ageHour", "when: hours");
  assert.strictEqual(D.whenOf(isoAgo(2 * 86_400_000), t), "files.ageDay", "when: days");
  assert.ok(D.whenOf(isoAgo(10 * 86_400_000), t) !== "files.ageDay" && D.whenOf(isoAgo(10 * 86_400_000), t).length > 0, "when: >1 week → calendar date");
  assert.strictEqual(D.whenOf("", t), "", "when: empty → empty");
  assert.strictEqual(D.whenOf("garbage", t), "garbage", "when: unparseable → raw");
  // jj's offset-less LOCAL form (its templates have no UTC mode): it must
  // parse (as the host's local time) instead of falling through to raw.
  const local = new Date(Date.now() - 2 * 3_600_000);
  const localIso = local.getFullYear() + "-" + String(local.getMonth() + 1).padStart(2, "0") + "-" + String(local.getDate()).padStart(2, "0")
    + "T" + String(local.getHours()).padStart(2, "0") + ":" + String(local.getMinutes()).padStart(2, "0") + ":" + String(local.getSeconds()).padStart(2, "0");
  assert.strictEqual(D.whenOf(localIso, t), "files.ageHour", "when: jj offset-less local ISO parses as local"); }

// 9a3) The official file viewer's resource ADDRESS (dsh-resource://file/...).
{
  assert.strictEqual(D.sessionFileAddress("sess-1", "a.txt"),
    "dsh-resource://file/session/sess-1/a.txt", "address: plain file");
  assert.strictEqual(D.sessionFileAddress("sess-1", "sub dir/c file.txt"),
    "dsh-resource://file/session/sess-1/sub%20dir/c%20file.txt", "address: per-segment encoding, spaces → %20");
  assert.strictEqual(D.sessionFileAddress("sess/2", "a.txt"),
    "dsh-resource://file/session/sess%2F2/a.txt", "address: the session id is a segment too");
  assert.strictEqual(D.sessionFileAddress("sess-1", "C:/Users/jlb/notes.txt"),
    "dsh-resource://file/session/sess-1/C:/Users/jlb/notes.txt", "address: drive-letter colon kept literal");
  assert.strictEqual(D.sessionFileAddress("sess-1", "./a.txt"),
    "dsh-resource://file/session/sess-1/a.txt", "address: leading ./ dropped");
  assert.strictEqual(D.sessionFileAddress("sess-1", "C:\\Users\\jlb\\notes.txt"),
    "dsh-resource://file/session/sess-1/C:/Users/jlb/notes.txt", "address: backslashes normalized"); }
// 10) DiffView render smoke (fake React: effects are no-ops → the side-by-side
//    path with narrow=false, and the binary-card path).
{ const t = (k) => k;
  const el = D.DiffView({ model: D.parseDiff(fx("modify-multi.txt")).files[0], truncated: false, t });
  assert.ok(el && typeof el === "object", "DiffView renders a multi-hunk file (no throw)");
  const el2 = D.DiffView({ model: D.parseDiff(fx("binary.txt")).files[0], truncated: false, t });
  assert.ok(el2 && typeof el2 === "object", "DiffView renders the binary card (no throw)");
  const el3 = D.DiffView({ model: D.parseDiff(fx("chmod.txt")).files[0], truncated: true, t });
  assert.ok(el3 && typeof el3 === "object", "DiffView renders a mode-only diff (no throw)");
  // The binary IMAGE path: the host's `binary` field (fileShow bytes at the
  // rev / parent) renders old|new; an absent side gets a "(none)" slot; no
  // bytes at all → the plain card (no hint, there is no open-in-window
  // affordance; the only preview surface is the in-pane data URL).
  const findClass = (function find(node, cls, out) {
    if (out === undefined) out = [];
    if (Array.isArray(node)) { for (const ch of node) find(ch, cls, out); return out; }
    if (!node || typeof node !== "object") return out;
    if (typeof node.p?.className === "string" && node.p.className.split(" ").includes(cls)) out.push(node);
    if (node.c) find(node.c, cls, out);
    return out;
  });
  const binModel = D.parseDiff(fx("binary.txt")).files[0];
  assert.ok(binModel.isBinary, "binary fixture parses isBinary");
  { const el4 = D.DiffView({ model: binModel, truncated: false, t,
      binary: { new: { kind: "binary", size: 42, type: "image/png", label: "PNG image", data: "AAAA" }, old: null } });
    assert.strictEqual(findClass(el4, "dswFiles_diffBinaryRow").length, 1, "binary image: one old|new row");
    assert.strictEqual(findClass(el4, "dswFiles_diffBinaryPane").length, 2, "binary image: two panes (old, new)");
    assert.strictEqual(findClass(el4, "dswFiles_diffBinaryNone").length, 1, "binary image: absent (old) side → (none) slot");
    const imgs = findClass(el4, "img").length;
    const all = []; (function w(n) { if (Array.isArray(n)) n.forEach(w); else if (n && n.t === "img") all.push(n); else if (n && n.c) w(n.c); })(el4);
    assert.strictEqual(all.length, 1, "binary image: exactly one img (the side with bytes)");
    assert.strictEqual(all[0].p.src, "data:image/png;base64,AAAA", "binary image: img src = the bytes as a data URL"); }
  { const el5 = D.DiffView({ model: binModel, truncated: false, t,
      binary: { new: { kind: "binary", size: 999999, type: "image/png", label: "PNG image" }, old: null } });
    assert.strictEqual(findClass(el5, "dswFiles_diffBinaryRow").length, 0, "no displayable bytes → no image row");
    assert.strictEqual(findClass(el5, "dswFiles_previewCard").length, 1, "no displayable bytes → the plain card");
    assert.strictEqual(findClass(el5, "dswFiles_previewCardHint").length, 0, "no open-in-window hint on the binary card"); }
  { const el6 = D.DiffView({ model: binModel, truncated: false, t,
      binary: { new: { kind: "binary", size: 42, type: "image/png", label: "PNG image" }, old: null } });
    assert.strictEqual(findClass(el6, "dswFiles_previewCardHint").length, 0, "no open-in-window hint (any mode)"); }
  // A binary rename: jj emits the rename lines with NO "Binary files" marker
  // (isBinary stays false), but the host still attaches the bytes, so the
  // old|new row must render. A rename patch WITHOUT bytes keeps the text path.
  { const rnModel = D.parseDiff(fx("rename.txt")).files[0];
    assert.strictEqual(rnModel.isBinary, false, "rename fixture has no binary marker");
    const el8 = D.DiffView({ model: rnModel, truncated: false, t,
      binary: { new: { kind: "binary", size: 42, type: "image/png", label: "PNG image", data: "BB" },
                old: { kind: "binary", size: 42, type: "image/png", label: "PNG image", data: "AA" } } });
    assert.strictEqual(findClass(el8, "dswFiles_diffBinaryRow").length, 1, "renamed binary: old|new row renders despite isBinary=false");
    assert.strictEqual(findClass(el8, "dswFiles_diffBinaryPane").length, 2, "renamed binary: two panes");
    const imgs8 = []; (function w(n) { if (Array.isArray(n)) n.forEach(w); else if (n && n.t === "img") imgs8.push(n); else if (n && n.c) w(n.c); })(el8);
    assert.deepStrictEqual(imgs8.map((i) => i.p.src), ["data:image/png;base64,AA", "data:image/png;base64,BB"], "renamed binary: old then new data URLs");
    const el9 = D.DiffView({ model: rnModel, truncated: false, t });
    assert.strictEqual(findClass(el9, "dswFiles_diffBinaryRow").length, 0, "rename without bytes: no image row (text path)"); }
  // C3: the file's name is the PANE's general header (fed by the listing's
  // entry name), so a deleted file's /dev/null newPath can never be printed
  // as a name. The diff view's sticky head keeps only the diff meta.
  { const delModel = D.parseDiff(fx("delete.txt")).files[0];
    const el7 = D.DiffView({ model: delModel, truncated: false, t });
    assert.strictEqual(findClass(el7, "dswFiles_paneHead").length, 0, "the diff view no longer carries the file's name (the pane header does)");
    const metaEl = findClass(el7, "dswFiles_diffMeta")[0];
    assert.strictEqual(metaEl && Array.isArray(metaEl.c) ? metaEl.c[0] : null, "files.diffDeleted", "the deleted file's diff head keeps its meta row (fake t = identity)"); }
  // Unified (narrow) mode: the no-newline marker must not corrupt the line
  // text, regression for `[object Object]` leaking into the cell (a React
  // element string-concatenated onto the text).
  { const cells = D.unifiedCells({ k: "add", text: "noeol", oldNo: null, newNo: 7, noNewline: true }, 0);
    assert.strictEqual(cells.length, 2, "unified: line number + cell");
    const inner = cells[1].c[0]; // the .dswFiles_diffCellIn span
    assert.ok(inner.t === "span", "cell wraps an inner cellIn span");
    const content = inner.c[0]; // [markerEl, "noeol"]
    assert.strictEqual(String(content[1]), "noeol", "unified cell text is plain (marker + text)");
    assert.ok(!String(content[1]).includes("[object Object]"), "no [object Object] in the unified cell");
    assert.ok(inner.c[1] !== null, "no-newline marker is its own child (not string-concatenated)"); }
  // Intra-line spans (BUG-003): a mod row gets strong span highlights on both
  // sides; a pure-add file renders row tints only, no spans.
  { const modEl = D.DiffView({ model: D.parseDiff(fx("modify.txt")).files[0], truncated: false, t });
    assert.strictEqual(findClass(modEl, "dswFiles_spanDel").length, 1, "diff view: the mod row flags the old line's changed span");
    assert.strictEqual(findClass(modEl, "dswFiles_spanAdd").length, 1, "diff view: the mod row flags the new line's changed span"); }
  // Similarity gate at the render level (BUG-004): a rewritten line (no
  // shared tokens) gets the plain row tint, no word spans.
  { const rwEl = D.DiffView({ model: D.parseDiff(fx("rewrite.txt")).files[0], truncated: false, t });
    assert.strictEqual(findClass(rwEl, "dswFiles_spanDel").length + findClass(rwEl, "dswFiles_spanAdd").length, 0, "rewritten row: no intra-line spans (the gate)"); }
  { const addEl = D.DiffView({ model: D.parseDiff(fx("add.txt")).files[0], truncated: false, t });
    assert.strictEqual(findClass(addEl, "dswFiles_spanDel").length + findClass(addEl, "dswFiles_spanAdd").length, 0, "pure adds: no intra-line spans"); }
}

// 11) PreviewPane (the diff-only pane): the empty note, the head row (the
//     ref-copy and the ↗ Open-in-Files handoff), the worktree-conflict note,
//     and the nav-restore control (the state pair's half that lives in the
//     pane's top row while the nav is hidden).
{
  const t = (k) => k;
  const baseProps = {
    t, base: "worktree", navCollapsed: false, onToggleNav: () => {}, navId: "test-nav",
    fetchDiff: () => Promise.resolve({ patch: "+x\n" }),
  };
  const empty = D.PreviewPane({ name: null, relPath: null, status: null, ...baseProps });
  assert.strictEqual(findCls(empty, "dswFiles_previewEmpty").length, 1, "no selection → the empty note");
  assert.strictEqual(findCls(empty, "dswFiles_paneHead").length, 0, "no selection → no head row");
  assert.strictEqual(findCls(empty, "dswFiles_paneToggle").length, 0, "nav shown → no restore control");
  // Head row: the path split (directory dimmed + basename full ink) and the
  // ↗ Open-in-Files handoff. No ref is selected, so no copy button yet.
  const head = D.PreviewPane({ name: "a.txt", relPath: "docs/sub/a.txt", status: { path: "docs/sub/a.txt", status: "M" }, ...baseProps, openInFiles: (p) => {} });
  assert.strictEqual(findCls(head, "dswFiles_paneHead").length, 1, "a selection → the head row");
  const dirPart = findEl(head, (n) => typeof n.p?.className === "string" && n.p.className === "dswFiles_pathDirectory")[0];
  assert.strictEqual(childText(dirPart), "docs/sub/", "the head path shows the directory part");
  const namePart = findEl(head, (n) => typeof n.p?.className === "string" && n.p.className === "dswFiles_pathName")[0];
  assert.strictEqual(childText(namePart), "a.txt", "the head path shows the basename");
  const openBtn = findEl(head, (n) => n.t === "button" && n.p && n.p["aria-label"] === "files.openInFiles");
  assert.strictEqual(openBtn.length, 1, "the ↗ Open-in-Files handoff renders (relPath + host actions)");
  assert.strictEqual(findEl(head, (n) => n.t === "button" && n.p && n.p["aria-label"] === "files.refCopy").length, 0, "no ref selected → no copy button");
  // The handoff degrades away without openInFiles (pre-0.1.5 surface).
  const noOpen = D.PreviewPane({ name: "a.txt", relPath: "docs/sub/a.txt", status: { path: "docs/sub/a.txt", status: "M" }, ...baseProps, openInFiles: null });
  assert.strictEqual(findEl(noOpen, (n) => n.t === "button" && n.p && n.p["aria-label"] === "files.openInFiles").length, 0, "no host tab actions → no handoff");
  // A worktree conflict: the note (a conflict-only file has no worktree diff).
  const conflict = D.PreviewPane({ name: "a.txt", relPath: "a.txt", status: { path: "a.txt", status: "C", base: "conflict" }, ...baseProps });
  assert.strictEqual(findEl(conflict, (n) => typeof n.p?.className === "string" && n.p.className === "dswFiles_previewNote" && childText(n) === "files.conflictNote").length, 1, "worktree conflict → the note");
  // The nav's restore control lives in the pane's top row while collapsed.
  const paneNavHidden = D.PreviewPane({ name: "a.txt", relPath: "a.txt", status: { path: "a.txt", status: "M" }, ...baseProps, navCollapsed: true });
  const restoreEls = findEl(paneNavHidden, (n) => n.t === "button" && typeof n.p?.className === "string" && n.p.className === "dswFiles_navToggle");
  assert.strictEqual(restoreEls.length, 1, "nav hidden → the restore control renders in the pane");
  assert.strictEqual(restoreEls[0].p["aria-expanded"], "false", "the restore control reports the nav collapsed");
  assert.strictEqual(restoreEls[0].p["aria-controls"], "test-nav", "the restore control names the nav region");
}
// The unified/split decision (the DiffView's layout gate): a split side
// shows (paneW - 2×44px gutters) / 2 of the file's reference width, and the
// view is unified when that is LESS than 66% of it. The reference is FIXED
// at 100 columns (at the pane's font), so a file with long lines can't keep
// a wide pane unified.
{
  assert.strictEqual(D.diffLayoutNarrow(1022, 459), false, "wide pane: split (467/side ≥ 66% of 459 = 303)");
  assert.strictEqual(D.diffLayoutNarrow(694, 459), false, "just at the 66% boundary per side → split (NOT less than)");
  assert.strictEqual(D.diffLayoutNarrow(693, 459), true, "just under the 66% boundary per side → unified");
  assert.strictEqual(D.diffLayoutNarrow(200, 100), true, "narrow pane: unified (56/side < 66)");
  assert.strictEqual(D.diffLayoutNarrow(0, 100), true, "unmeasurable pane → unified");
  // Realistic 100-column reference at the 7.5px/col pane font (750px):
  assert.strictEqual(D.diffLayoutNarrow(1078, 750), false, "exactly 66 columns per side → split");
  assert.strictEqual(D.diffLayoutNarrow(1077, 750), true, "a column short of 66 per side → unified");
  assert.strictEqual(D.diffLayoutNarrow(1422, 750), false, "1800-viewport fullscreen pane (≈1422): split");
  assert.strictEqual(D.diffLayoutNarrow(1022, 750), true, "1400-viewport fullscreen pane (≈1022): unified");
  assert.strictEqual(D.diffLayoutNarrow(630, 750), true, "the fixed 630px right column: unified");
}

// typeLabel: the binary-file note's MIME → dictionary-key map (the
// DiffView's binary pane uses it for the image types it renders inline).
{
  const identity = (k) => k;
  assert.strictEqual(H.typeLabel("image/png", identity), "files.type.png", "typeLabel: known type maps to its dictionary key");
  assert.strictEqual(H.typeLabel("application/x-unknown", identity), "application/x-unknown", "typeLabel: unknown type falls back to the raw MIME string");
  assert.strictEqual(H.typeLabel("", identity), "files.type.binary", "typeLabel: empty type falls back to the binary-file key");
  assert.strictEqual(H.typeLabel(undefined, identity), "files.type.binary", "typeLabel: missing type falls back to the binary-file key");
}


// 19) RPC error handling: unwrap carries the host error code, and the
// session-not-found code maps to the localized notice instead of the raw
// "session-not-found: no live session for <uuid>" string.
{
  const ok = H.unwrap({ ok: true, value: 42 });
  assert.strictEqual(ok, 42, "unwrap: ok envelope passes the value through");

  let threw = null;
  try { H.unwrap({ ok: false, error: { code: "session-not-found", message: "no live session for session-b23c9ff7" } }); }
  catch (e) { threw = e; }
  assert.ok(threw, "unwrap: an error envelope throws");
  assert.strictEqual(threw.code, "session-not-found", "unwrap: the error carries the host code");
  assert.strictEqual(threw.message, "session-not-found: no live session for session-b23c9ff7", "unwrap: message keeps the code + message shape");

  let missing = null;
  try { H.unwrap({ ok: false, error: { message: "boom" } }); } catch (e) { missing = e; }
  assert.strictEqual(missing.code, "rpc-failed", "unwrap: a codeless error gets the fallback code");
  assert.strictEqual(missing.message, "boom", "unwrap: codeless error keeps the bare message");

  assert.strictEqual(H.isSessionGone(threw), true, "isSessionGone: matches the session-not-found code");
  assert.strictEqual(H.isSessionGone(new Error("session-not-found: something else")), false, "isSessionGone: plain errors are not session-gone");
  assert.strictEqual(H.isSessionGone(null), false, "isSessionGone: null is not session-gone");
  assert.strictEqual(H.isSessionGone("a string"), false, "isSessionGone: non-objects are not session-gone");

  const t = (k) => (k === "files.sessionGone" ? "SESSION_GONE" : k);
  assert.strictEqual(H.rpcErrorText(threw, t), "SESSION_GONE", "rpcErrorText: session-gone → localized notice");
  assert.strictEqual(H.rpcErrorText(missing, t), "boom", "rpcErrorText: other errors pass the message through");
  assert.strictEqual(H.rpcErrorText("plain", t), "plain", "rpcErrorText: non-Error values fall back to String");

  // A restarted server cold-resolves the session by id within seconds, so
  // the view retries automatically before the latch turns terminal.
  assert.strictEqual(H.GONE_RETRY_MAX, 3, "gone-retry: three attempts, then terminal");
  assert.deepStrictEqual([0, 1, 2].map(H.goneRetryDelay), [1500, 3000, 6000], "gone-retry: 1.5s / 3s / 6s backoff");

  // BUG-009: details ride the error (the recovery reads details.path), and
  // directory-unreadable localizes instead of showing "internal: not-found".
  let dir = null;
  try { H.unwrap({ ok: false, error: { code: "directory-unreadable", message: "not-found: sub/gone", details: { path: "sub/gone" } } }); }
  catch (e) { dir = e; }
  assert.ok(dir, "unwrap: directory-unreadable envelope throws");
  assert.strictEqual(dir.code, "directory-unreadable", "unwrap: the closed code survives");
  assert.strictEqual(dir.details.path, "sub/gone", "unwrap: details.path rides along");
  const t2 = (k) => (k === "files.pathGone" ? "PATH_GONE" : k);
  assert.strictEqual(H.rpcErrorText(dir, t2), "PATH_GONE (sub/gone)", "rpcErrorText: directory-unreadable → localized note + the dead path");
  const dirNoPath = Object.assign(new Error("x"), { code: "directory-unreadable" });
  assert.strictEqual(H.rpcErrorText(dirNoPath, t2), "PATH_GONE", "rpcErrorText: directory-unreadable without a path stays bare");
}

// ---- Section refs (selection → @path reference text) ----
{
  // mentionOf: the dsh mention grammar — plain @path, quoted @"path" when a
  // whitespace / quote / control char is present (those are dropped).
  assert.strictEqual(H.mentionOf("src/foo.ts"), "@src/foo.ts", "mention: plain path");
  assert.strictEqual(H.mentionOf("my dir/foo.ts"), '@"my dir/foo.ts"', "mention: space forces the quoted form");
  assert.strictEqual(H.mentionOf('a"b.ts'), '@"ab.ts"', "mention: an inner double quote is dropped, quoted form");
  assert.strictEqual(H.mentionOf(""), "@", "mention: empty path degrades to a bare @");

  // buildFileRef: the final shapes (pure-ASCII, never localized).
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts" }), "@src/foo.ts", "ref: whole file, no fragment");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12 }), "@src/foo.ts:12", "ref: single line");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12, end: 40 }), "@src/foo.ts:12-40", "ref: line range");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12, col: 34 }), "@src/foo.ts:12:34", "ref: single line + column (the file:line:col convention)");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 40, end: 12, col: 34 }), "@src/foo.ts:12-40", "ref: a range has no column");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12, end: 12, col: 34, text: "const x" }), "@src/foo.ts:12 \"const x\"", "ref: a quoted selection is anchored by its text, not a column");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12, col: 0 }), "@src/foo.ts:12", "ref: a non-positive column is dropped");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12, col: 34, rev: "abc123" }), "@src/foo.ts@abc123:12:34", "ref: rev + line:col");
  assert.strictEqual(H.buildFileRef({ path: "/abs/foo.ts", start: 12, col: 34, bare: true }), "/abs/foo.ts:12:34", "ref: bare external with line:col");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 12, end: 12 }), "@src/foo.ts:12", "ref: degenerate range collapses");
  assert.strictEqual(H.buildFileRef({ path: "src/foo.ts", start: 40, end: 12 }), "@src/foo.ts:12-40", "ref: end < start is re-ordered");
  assert.strictEqual(
    H.buildFileRef({ path: "src/foo.ts", start: 12, end: 40, rev: "abc123" }),
    "@src/foo.ts@abc123:12-40", "ref: snapshot mode carries the rev");
  assert.strictEqual(
    H.buildFileRef({ path: "my dir/foo.ts", start: 12, end: 40 }),
    '@"my dir/foo.ts":12-40', "ref: spaced path uses the quoted mention");
  assert.strictEqual(
    H.buildFileRef({ path: "src/foo.ts", start: 12, end: 40, text: "const x = 1;" }),
    '@src/foo.ts:12-40 "const x = 1;"', "ref: snippet follows the fragment");
  assert.strictEqual(
    H.buildFileRef({ path: "docs/notes.md", text: "Deploying to prod" }),
    '@docs/notes.md "Deploying to prod"', "ref: snippet-only shape (no line numbers)");
  assert.strictEqual(
    H.buildFileRef({ path: "src/foo.ts", start: 12, text: "  const x = 1;  " }),
    '@src/foo.ts:12 "const x = 1;"', "ref: the snippet is trimmed");
  assert.strictEqual(
    H.buildFileRef({ path: "src/foo.ts", start: 12, text: 'say "hi"' }),
    '@src/foo.ts:12 "say \'hi\'"', "ref: inner double quotes become single");

  // The snippet cap: ≤ REF_TEXT_MAX verbatim, beyond it head + ellipsis.
  const short200 = "a".repeat(200);
  assert.strictEqual(
    H.buildFileRef({ path: "p.ts", start: 1, text: short200 }),
    '@p.ts:1 "' + short200 + '"', "ref: a 200-char snippet fits verbatim");
  const long = "b".repeat(250);
  const longRef = H.buildFileRef({ path: "p.ts", start: 1, text: long });
  const longBody = longRef.slice(9, -1); // strip `@p.ts:1 "` and the closing quote
  assert.strictEqual(longBody, "b".repeat(200) + "…", "ref: long snippet caps at 200 chars + ellipsis, head kept");

  // Blank/whitespace text produces no quote at all (the plain ref stands alone).
  assert.strictEqual(H.buildFileRef({ path: "p.ts", start: 3, text: "   \n " }), "@p.ts:3", "ref: blank text → no quote");
  assert.strictEqual(H.buildFileRef({ path: "p.ts", text: "" }), "@p.ts", "ref: empty text, no range → bare mention");
  // External (out-of-workspace) files: bare — NO `@` (that grammar is
  // workspace-relative by dsh's convention), the absolute path verbatim.
  // Whitespace inside a bare path stays as-is (no mention grammar to break).
  assert.strictEqual(H.buildFileRef({ path: "/home/u/notes.md", bare: true }), "/home/u/notes.md", "bare ref: whole file, no @");
  assert.strictEqual(H.buildFileRef({ path: "/home/u/notes.md", start: 12, end: 40, bare: true }), "/home/u/notes.md:12-40", "bare ref: line range");
  assert.strictEqual(H.buildFileRef({ path: "/home/u/my notes.md", start: 12, bare: true }), "/home/u/my notes.md:12", "bare ref: a space is fine unquoted");
  assert.strictEqual(
    H.buildFileRef({ path: "/home/u/notes.md", text: "Deploying to prod", bare: true }),
    '/home/u/notes.md "Deploying to prod"', "bare ref: snippet-only shape");
  assert.strictEqual(
    H.buildFileRef({ path: "/home/u/notes.md", start: 12, text: "const x = 1;", bare: true }),
    '/home/u/notes.md:12 "const x = 1;"', "bare ref: snippet follows the fragment");
}

// commitRefToChat: the dedupe + separator + trailing-space contract of the
// insert action (the DOM half — fullscreen exit, composer focus — is e2e's).
{
  const drafts = [];
  const commit = (draft, ref) => H.commitRefToChat(draft, ref, (t) => drafts.push(t));
  commit("", "@a.txt:1");
  assert.strictEqual(drafts[0], "@a.txt:1 ", "commit: empty draft → the ref + its trailing space");
  commit("@a.txt:1 ", "@a.txt:1");
  assert.strictEqual(drafts.length, 1, "commit: repeating the ref the draft already ends with is a no-op");
  commit("hello", "@a.txt:1");
  assert.strictEqual(drafts[1], "hello @a.txt:1 ", "commit: non-blank draft without trailing space → a separating space");
  commit("hello ", "@a.txt:2");
  assert.strictEqual(drafts[2], "hello @a.txt:2 ", "commit: a draft ending in whitespace → no double space");
}

// ---- Right-column sibling (changestab's own kind, next to the stock files page) ----
{
  // A 0.1.5+ host: re-apply against a ctx WITH the column's tab registry.
  // The right-column face registers, and the conversation Files tab stays
  // unregistered — one Files surface per host.
  let registeredInColumnCtx = null;
  const ctxColumn = {
    ...ctx,
    slots: {
      inject: (slot, cb) => {
        assert.ok(slot === "conversation.view" || slot === "sidebar.right.pane.tab", "slot: " + slot);
        const r = cb();
        return typeof r === "function" ? r : () => {};
      },
      register: (opts, comp) => {
        if (opts.name === "conversation.view") registeredInColumnCtx = { opts, comp };
        else if (opts.name === "sidebar.right.pane.tab") registeredRight = { opts, comp };
        return () => {};
      },
    },
    sidebarRightTabs: {
      register: (def) => { tabDef = def; return () => {}; },
    },
  };
  mod.apply(ctxColumn);
  assert.strictEqual(registeredInColumnCtx, null, "0.1.5+ host: the conversation Files tab is NOT registered (the column is the surface)");

  // The type registration: changestab owns its OWN kind — a sibling of the
  // stock builtin `files` page, not a shadow. A PAGE type: no patterns and
  // no canOpen (the stock file viewer keeps every dsh-resource://file/…
  // open), one guide entry alongside the stock's (the column seeds on the
  // guide page when there are several entries).
  assert.ok(tabDef, "right-column type registered");
  assert.strictEqual(tabDef.id, "changestab", "the id the body registers under");
  assert.strictEqual(tabDef.kind, "changestab", "its own kind — a sibling of the stock 'files', no shadowing");
  assert.strictEqual(tabDef.priority, undefined, "no builtin on this kind: the default (extension) band is implicit");
  assert.strictEqual(tabDef.patterns, undefined, "no patterns: a page type — the stock viewer keeps file opens");
  assert.strictEqual(tabDef.canOpen, undefined, "no veto: a page type recognizes no address");
  assert.strictEqual(tabDef.title("dsh-resource://file/session/s1/sub/a.txt"), "a.txt", "the resource chip shows the basename (the capture option's path)");
  assert.strictEqual(tabDef.title("sidebar://changestab"), "view.changestab", "the page chip shows the Changes label (fake t = identity)");
  assert.strictEqual(tabDef.guide.length, 1, "one guide entry for changestab's own kind (alongside the stock 'files' entry)");
  assert.strictEqual(typeof tabDef.guide[0].title, "function", "the guide title is thunked (locale-flip safe)");
  assert.strictEqual(typeof tabDef.guide[0].icon, "function", "the guide glyph is a component");

  // The keyed body: registered under the definition's id, bound to the slot's
  // session.
  assert.ok(registeredRight, "right-column body registered");
  assert.strictEqual(registeredRight.opts.key, "changestab", "the body sits under the definition's id");
  const rface = registeredRight.opts.inject("sess-x");
  assert.strictEqual(rface.sessionId, "sess-x", "the right face is bound to the slot's session");
  assert.strictEqual(typeof rface.listDirectory, "function", "the right face carries the browse methods");

  // parseFileAddress: the session-scoped shape, decoded segments, query
  // suffix ignored, everything else is not this type's.
  assert.deepStrictEqual(
    H.parseFileAddress("dsh-resource://file/session/s1/sub%2Fx/a.txt"),
    { scope: "session", sessionId: "s1", path: "sub/x/a.txt" }, "address: segments decode");
  assert.deepStrictEqual(
    H.parseFileAddress("dsh-resource://file/session/s1/a.txt?line=7"),
    { scope: "session", sessionId: "s1", path: "a.txt" }, "address: the query suffix is ignored");
  assert.strictEqual(H.parseFileAddress("dsh-resource://file/session/s1"), null, "address: a pathless tail is not a file");
  assert.strictEqual(H.parseFileAddress("dsh-resource://file/absolute/%2Ftmp/x"), null, "address: absolute scope is not browsable here");
  assert.strictEqual(H.parseFileAddress("sidebar://changestab"), null, "address: the page address is not a resource");
  assert.strictEqual(H.fileAddressBasename("dsh-resource://file/session/s1/sub/a b.txt"), "a b.txt", "basename decodes its segment");

  // The body's two lives: a resource open of THIS session's file renders the
  // files view (restored from the nav cache, so the pane doesn't flash blank)
  // and redirects (openTab changestab {path, line}, then close); the page address
  // renders the files view and navigates in place.
  const R = H.RightPaneBody;
  assert.strictEqual(typeof R, "function", "the body is exposed for test");
  const actions = [];
  const mkTab = (address, params, revision) => ({
    tab: {
      contentId: address,
      navigation: { address, params, revision },
      signal: new AbortController().signal,
      actions: {
        openTab: (kind, opts) => { actions.push(["openTab", kind, opts]); },
        openResource: (a, o) => { actions.push(["openResource", a, o]); },
        close: () => { actions.push(["close"]); },
      },
    },
  });
  pendingEffects = [];
  const frame = R({
    useTabInfo: () => mkTab("dsh-resource://file/session/sess-x/sub/a.txt", { line: 7 }, 1),
    sessionId: "sess-x", ...rface, t: (k) => k,
  });
  assert.ok(frame && typeof frame.t === "function", "the resource frame renders the files view (from the nav cache) while it redirects");
  assert.deepStrictEqual(frame.p.openRequest, { path: "sub/a.txt", line: 7, revision: 1 }, "the frame derives its open request from the resource address");
  for (const fn of pendingEffects) fn();
  assert.deepStrictEqual(actions, [
    ["openTab", "changestab", { params: { path: "sub/a.txt", line: 7 } }],
    ["close"],
  ], "the redirect: the page takes the open, the frame closes");

  pendingEffects = [];
  actions.length = 0;
  const page = R({
    useTabInfo: () => mkTab("sidebar://changestab", { path: "sub/a.txt", line: 7 }, 2),
    sessionId: "sess-x", ...rface, t: (k) => k,
  });
  assert.ok(page && typeof page.t === "function", "the page renders the files view (a FilesView element)");
  assert.deepStrictEqual(page.p.openRequest, { path: "sub/a.txt", line: 7, revision: 2 }, "the page receives the open request");
  assert.deepStrictEqual(actions, [], "the page navigates in place (no redirect)");

  // A resource open of ANOTHER session's file does not redirect (the face is
  // bound to this slot's session) and does not leak a foreign request into
  // the view (its params carry no path).
  pendingEffects = [];
  actions.length = 0;
  const foreign = R({
    useTabInfo: () => mkTab("dsh-resource://file/session/other/a.txt", { line: 3 }, 1),
    sessionId: "sess-x", ...rface, t: (k) => k,
  });
  assert.ok(foreign && typeof foreign === "object", "a cross-session resource frame does not redirect");
  for (const fn of pendingEffects) fn();
  assert.deepStrictEqual(actions, [], "no redirect actions for another session's file");
}



console.log("client: bundle + apply + inject-face + render + diff parser/view + right-column OK");

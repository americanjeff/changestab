// Run: node test/jj.test.mjs
//
// Pure parser tests always run. The I/O sections need a real jj on PATH
// (skipped gracefully, like a network test would be). Every commit-creating
// command passes -m, a bare `jj commit`/`jj new` pops the user's ui.editor.
import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import assert from "node:assert";
import { jj, parseSummary, parseHead, parseCommitLog, parseConflicts, insideWorkspace, jjWorkspaceStatus, jjLogPage } from "../dist/jj.js";
import { snapshotDirListing } from "../dist/snapshot.js";
import { __test } from "../dist/index.js";

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// parseSummary, golden shapes pinned to real jj 0.44.0 output.
assert.deepStrictEqual(
  parseSummary("M a.txt\nA b/c.txt\nD d.txt\nC c.txt"),
  [
    { path: "a.txt", status: "M" },
    { path: "b/c.txt", status: "A" },
    { path: "d.txt", status: "D" },
    { path: "c.txt", status: "C" },
  ], "plain letters");
// renames: git BRACE form (embedded and bare), never `old -> new`
assert.deepStrictEqual(parseSummary("R {s1.txt => s1b.txt}"),
  [{ path: "s1b.txt", status: "R", oldPath: "s1.txt" }], "bare brace rename");
assert.deepStrictEqual(parseSummary("R sub/{s.txt => s2.txt}"),
  [{ path: "sub/s2.txt", status: "R", oldPath: "sub/s.txt" }], "embedded brace rename");
assert.deepStrictEqual(parseSummary("R {far.txt => moved/far.txt}"),
  [{ path: "moved/far.txt", status: "R", oldPath: "far.txt" }], "cross-dir brace rename");
assert.deepStrictEqual(parseSummary("M my file.txt"),
  [{ path: "my file.txt", status: "M" }], "path with spaces");
assert.deepStrictEqual(parseSummary(""), [], "empty input");
assert.deepStrictEqual(parseSummary("junk line\n\n  \n"), [], "unknown lines skipped");

// TSV shape (HEAD_TSV, 13 cols): commit-id \t change-id \t prefix \t rest
// \t bookmarks \t tags \t workspaces \t hidden(0|1) \t divergent(0|1)
// \t change-offset \t tracking \t parents (commit ids) \t first-line
// (description LAST). id = commit id, changeId = the worktree's change id,
// parents = the head's parent COMMIT ids.
assert.deepStrictEqual(parseHead("f11e978bb855\tqpslqqptwxyz\t\t\t\t\t\t0\t0\t0\t\t\tstep2\n"),
  { id: "f11e978bb855", changeId: "qpslqqptwxyz", idPrefix: "", idRest: "", parents: [], bookmarks: [], tags: [], workspaces: [], hidden: false, divergent: false, offset: 0, tracking: [], description: "step2" }, "head with desc");
assert.deepStrictEqual(parseHead("f11e978bb855\tqpslqqptwxyz\tqpslqq\tptwxyz\tdev,main\tv1\tws1,ws2\t0\t0\t0\tdev@origin:2/1\t111111111111 222222222222\tnote\n"),
  { id: "f11e978bb855", changeId: "qpslqqptwxyz", idPrefix: "qpslqq", idRest: "ptwxyz", parents: ["111111111111", "222222222222"], bookmarks: ["dev", "main"], tags: ["v1"], workspaces: ["ws1", "ws2"], hidden: false, divergent: false, offset: 0, tracking: [{ name: "dev", remote: "origin", ahead: 2, behind: 1 }], description: "note" }, "head refs + workspaces + tracking + commit-id parents + shortest(8) split parsed");
assert.deepStrictEqual(parseHead("f11e978bb855\tqpslqqptwxyz\tqpslqq\tptwxyz\tdev*?\t\t\t1\t1\t2\tdev@origin:-1/3\t111111111111\tnote\n"),
  { id: "f11e978bb855", changeId: "qpslqqptwxyz", idPrefix: "qpslqq", idRest: "ptwxyz", parents: ["111111111111"], bookmarks: ["dev*?"], tags: [], workspaces: [], hidden: true, divergent: true, offset: 2, tracking: [{ name: "dev", remote: "origin", ahead: -1, behind: 3 }], description: "note" }, "head sigil bookmark + hidden + divergent + offset + negative ahead parsed");
assert.strictEqual(parseHead(""), null, "head, no input");
assert.strictEqual(parseHead("no tab here\n"), null, "head, no TSV line");

// TSV shape (LOG_TSV, 18 cols): change-id \t commit-id \t id-prefix \t
// id-rest \t glyph (@/◆/×/○, jj's node character) \t conflict(0|1) \t
// empty(0|1) \t author \t date \t bookmarks \t tags \t workspaces \t
// hidden(0|1) \t divergent(0|1) \t change-offset \t tracking \t parents
// (commit ids) \t first-line (the fixed columns are anchored, so a tab
// inside the description stays put).
const row = (o) => ({ id: "abc123def456", commitId: "f11e978bb855", idPrefix: "", idRest: "", glyph: "○", conflict: false, empty: false, root: false, author: "", date: "", bookmarks: [], tags: [], workspaces: [], hidden: false, divergent: false, offset: 0, tracking: [], parents: [], description: "", ...o });
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\tabc\t123def456\t○\t0\t0\ta@b.com\t2026-01-02T03:04:05\t\t\t\t0\t0\t0\t\tzzzzzzzzzzzz\tfix the parser\n"),
  [row({ idPrefix: "abc", idRest: "123def456", author: "a@b.com", date: "2026-01-02T03:04:05", parents: ["zzzzzzzzzzzz"], description: "fix the parser" })], "commit log, one entry");
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\tab\tcdef456\t×\t1\t1\t\t\t\t\t\t0\t0\t0\t\t\t\n"),
  [row({ idPrefix: "ab", idRest: "cdef456", glyph: "×", conflict: true, empty: true })], "commit log, conflict node × + (empty) + no desc");
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\tab\tcdef456\t◆\t0\t0\t\t\t\t\t\t0\t0\t0\t\t\t\n"),
  [row({ idPrefix: "ab", idRest: "cdef456", glyph: "◆" })], "commit log, immutable node ◆");
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\t\t\t\t0\t0\t\t\t\t\t\t0\t0\t0\t\t\t\n"),
  [row({})], "commit log, no desc only (empty glyph column → ○ fallback)");
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\tabc\t123def456\t@\t0\t0\ta@b.com\t2026-01-02T03:04:05\tdev,main\tv1\twsA\t0\t0\t0\t\tmmmmmmmmmmmm nnnnnnnnnnnn\tfix\twith tabs\n"),
  [row({ idPrefix: "abc", idRest: "123def456", glyph: "@", author: "a@b.com", date: "2026-01-02T03:04:05", bookmarks: ["dev", "main"], tags: ["v1"], workspaces: ["wsA"], parents: ["mmmmmmmmmmmm", "nnnnnnnnnnnn"], description: "fix\twith tabs" })],
  "working-copy node @ + refs + workspace + two parents + tab in description survive");
// The CLI's ref sigils ride in the bookmark strings (unsynced local `*`,
// conflicted `??`, remote `name@remote`) — parsed verbatim, tracking is
// separate data keyed by name@remote.
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\tabc\t123def456\t○\t0\t0\t\t\tmain*,feat??,dev@origin\t\t\t0\t0\t0\tdev@origin:3/0,main@origin:0/4\tzzzzzzzzzzzz\trefs\n"),
  [row({ idPrefix: "abc", idRest: "123def456", bookmarks: ["main*", "feat??", "dev@origin"], tracking: [{ name: "dev", remote: "origin", ahead: 3, behind: 0 }, { name: "main", remote: "origin", ahead: 0, behind: 4 }], parents: ["zzzzzzzzzzzz"], description: "refs" })],
  "sigils verbatim + two tracking pairs parsed");
// A divergent change: the /N offset + flag (hidden takes precedence in the
// RENDER, but both flags are parsed).
assert.deepStrictEqual(parseCommitLog("ws1xskmq0000\tf11e978bb855\tws1xsk\tmq0000\t○\t0\t0\t\t\t\t\t\t0\t1\t1\t\t3efe5a9e1234\tchild of the fork\n"),
  [row({ id: "ws1xskmq0000", idPrefix: "ws1xsk", idRest: "mq0000", divergent: true, offset: 1, parents: ["3efe5a9e1234"], description: "child of the fork" })],
  "divergent flag + change offset parsed");
assert.deepStrictEqual(parseCommitLog("ws1xskmq0000\tf11e978bb855\tws1xsk\tmq0000\t○\t0\t0\t\t\t\t\t\t1\t1\t0\t\tdb4302681234\t\n"),
  [row({ id: "ws1xskmq0000", idPrefix: "ws1xsk", idRest: "mq0000", hidden: true, divergent: true, offset: 0, parents: ["db4302681234"] })],
  "hidden + divergent + offset 0 parsed (empty desc)");
// Malformed tracking pairs are skipped, never fatal.
assert.deepStrictEqual(parseCommitLog("abc123def456\tf11e978bb855\t\t\t\t0\t0\t\t\t\t\t\t0\t0\t0\tgarbage,dev@origin:1/0\t\t\n"),
  [row({ tracking: [{ name: "dev", remote: "origin", ahead: 1, behind: 0 }] })], "malformed tracking pair skipped");
assert.deepStrictEqual(parseCommitLog("zzzzzzzzzzzz\tf11e978bb855\tz\tzzzzzzzzz\t◆\t0\t1\t\t\t\t\t\t0\t0\t0\t\t\t\n"),
  [row({ id: "zzzzzzzzzzzz", idPrefix: "z", idRest: "zzzzzzzzz", glyph: "◆", empty: true, root: true })],
  "the root revision is INCLUDED as the log's floor (root flag, empty, ◆)");
assert.deepStrictEqual(parseCommitLog("Warning: something\nabc123def456\tf11e978bb855\t\t\t\t0\t0\t\t\t\t\t\t0\t0\t0\t\t\tfirst\n\n"),
  [row({ description: "first" })], "non-TSV lines skipped");
assert.deepStrictEqual(
  parseCommitLog(Array.from({ length: 60 }, (_, i) => "a" + String(i).padStart(11, "0") + "\tf11e978bb855\t\t\t\t0\t0\t\t\t\t\t\t0\t0\t0\t\t\td" + i).join("\n")),
  Array.from({ length: 50 }, (_, i) => row({ id: "a" + String(i).padStart(11, "0"), description: "d" + i })),
  "capped at 50 entries");
// An explicit cap (the page functions pass `need`, so a page deeper than the
// legacy 50-row default is not truncated): a 60-line feed with cap 55 yields 55.
assert.deepStrictEqual(
  parseCommitLog(Array.from({ length: 60 }, (_, i) => "a" + String(i).padStart(11, "0") + "\tf11e978bb855\t\t\t\t0\t0\t\t\t\t\t\t0\t0\t0\t\t\td" + i).join("\n"), 55),
  Array.from({ length: 55 }, (_, i) => row({ id: "a" + String(i).padStart(11, "0"), description: "d" + i })),
  "explicit cap 55 (a page deeper than the legacy 50)");

assert.deepStrictEqual(
  snapshotDirListing("a.txt\nsub/b.txt\nsub/deep/c.txt\n.hidden\n", "").entries,
  [
    { name: "sub", path: "sub", isDirectory: true, hidden: false },
    { name: "a.txt", path: "a.txt", isDirectory: false, hidden: false },
  ], "root: dirs first, hidden filtered");
assert.deepStrictEqual(
  snapshotDirListing("a.txt\nsub/b.txt\nsub/deep/c.txt\n.hidden\n", "", { showHidden: true }).entries,
  [
    { name: "sub", path: "sub", isDirectory: true, hidden: false },
    { name: ".hidden", path: ".hidden", isDirectory: false, hidden: true },
    { name: "a.txt", path: "a.txt", isDirectory: false, hidden: false },
  ], "showHidden includes dotfiles (sorted as plain entries)");
assert.deepStrictEqual(
  snapshotDirListing("sub/b.txt\nsub/deep/c.txt\nsub/deep/.dot\n", "sub").entries,
  [
    { name: "deep", path: "sub/deep", isDirectory: true, hidden: false },
    { name: "b.txt", path: "sub/b.txt", isDirectory: false, hidden: false },
  ], "subdir: nested paths become child paths (deeper levels don't leak up)");
assert.deepStrictEqual(
  snapshotDirListing("sub/deep/c.txt\nsub/deep/.dot\n", "sub/deep", { showHidden: true }).entries,
  [
    { name: ".dot", path: "sub/deep/.dot", isDirectory: false, hidden: true },
    { name: "c.txt", path: "sub/deep/c.txt", isDirectory: false, hidden: false },
  ], "deep level lists its own hidden entries (showHidden)");
assert.deepStrictEqual(
  snapshotDirListing("sub/b.txt\nsub/deep/c.txt\n", "sub").entries,
  [
    { name: "deep", path: "sub/deep", isDirectory: true, hidden: false },
    { name: "b.txt", path: "sub/b.txt", isDirectory: false, hidden: false },
  ], "dir with only a subdirectory still shows the directory");
assert.deepStrictEqual(snapshotDirListing("", "").entries, [], "empty file list → empty dir");
assert.deepStrictEqual(
  snapshotDirListing("other/x.txt\nsub/a.txt\n", "sub").entries,
  [{ name: "a.txt", path: "sub/a.txt", isDirectory: false, hidden: false }], "lines outside the scoped dir ignored");
assert.deepStrictEqual(
  snapshotDirListing("b.txt\nc.txt\nd.txt\n", "", { cap: 2 }),
  { entries: [
      { name: "b.txt", path: "b.txt", isDirectory: false, hidden: false },
      { name: "c.txt", path: "c.txt", isDirectory: false, hidden: false },
    ], truncated: true },
  "cap + truncated flag");

assert.deepStrictEqual(parseConflicts(
  "The working copy has no changes.\n" +
  "Working copy  (@) : sozzrtmq e59d9f61 (conflict) merge\n" +
  "Parent commit (@-): xwlvutmw 8310583e left\n" +
  "Warning: There are unresolved conflicts at these paths:\n" +
  "c.txt    2-sided conflict\n" +
  "my file.txt    2-sided conflict\n"),
  ["c.txt", "my file.txt"], "conflict section parsed (incl. spaces)");
assert.deepStrictEqual(parseConflicts("The working copy has no changes.\nWorking copy  (@) : abc\n"),
  [], "no warning section → none");

assert.ok(insideWorkspace("a.txt") && insideWorkspace("sub/b.txt") && insideWorkspace("a/../b.txt"), "inside ok");
assert.ok(!insideWorkspace("") && !insideWorkspace("../x") && !insideWorkspace("/abs") && !insideWorkspace("a/../../x"), "escapes rejected");

const hasJj = await new Promise((res) => execFile("jj", ["--version"], (e) => res(!e)));
if (!hasJj) {
  console.log(`jj: pure tests only (${n} assertions) — no jj on PATH, I/O sections skipped`);
  process.exit(0);
}

const ENV = { ...process.env, JJ_USER: "TestUser", JJ_EMAIL: "test@example.com" };
const runJj = (cwd, args) => new Promise((res) =>
  execFile("jj", args, { cwd, env: ENV }, (e, so, se) => res({ code: e ? e.code : 0, out: so, err: se })));
const jjIn = (ws, args) => runJj(ws, [...args]);
// The no-op fingerprint: the INTEGRATED op-log head = token 1 of the SECOND
// line of `jj op log --no-integrate-operation`. (Line 1 is the command's own
// freshly-snapshotted ORPHAN op, a new id on every call, useless as a
// fingerprint. With --no-integrate-operation, orphans never enter the
// retained lineage, so line 2 stays put across reads and moves only when an
// integrated jj command runs.)
const opHead = (ws) => runJj(ws, ["op", "log", "--no-integrate-operation"]).then((r) => r.out.split("\n")[1]?.split(/\s+/)[1]);

const base = await mkdtemp(join(tmpdir(), "filez-jj-"));
const ws = join(base, "ws");
await runJj(base, ["git", "init", ws]);

await writeFile(join(ws, "a.txt"), "l1\nl2\nl3\n");
await writeFile(join(ws, "k.txt"), "keep\n");
await mkdir(join(ws, "sub"));
await writeFile(join(ws, "sub", "s.txt"), "s1\n");
ok((await jjIn(ws, ["commit", "-m", "baseline"])).code === 0, "baseline commit");
await writeFile(join(ws, "a.txt"), "l1\nl2 CHANGED\nl3\n");
await writeFile(join(ws, "n.txt"), "brand new\n");
await rm(join(ws, "k.txt"));
await rename(join(ws, "sub", "s.txt"), join(ws, "sub", "s2.txt"));

const opBefore = await opHead(ws);
const stA = await jjWorkspaceStatus(ws);
ok(stA.ok, "status A ok: " + JSON.stringify(stA));
{
  const by = Object.fromEntries(stA.changes.map((e) => [e.path, e]));
  ok(by["a.txt"]?.status === "M" && by["a.txt"].base === "worktree", "M a.txt (worktree): " + JSON.stringify(by["a.txt"]));
  ok(by["n.txt"]?.status === "U" && by["n.txt"].base === "worktree", "unadded n.txt shows U (jj has no staging: worktree A = git U): " + JSON.stringify(by["n.txt"]));
  ok(by["k.txt"]?.status === "D" && by["k.txt"].base === "worktree", "D k.txt (worktree)");
  ok(by["sub/s2.txt"]?.status === "R" && by["sub/s2.txt"]?.oldPath === "sub/s.txt", "R sub/s2.txt (worktree): " + JSON.stringify(by["sub/s2.txt"]));
  ok(stA.conflicts.length === 0, "no conflicts");
  ok(stA.head.marker === "@", "anchor is @ while dirty: " + JSON.stringify(stA.head));
  ok(/^[0-9a-f]{12}$/.test(stA.head.id), "head id is 12-hex: " + stA.head.id);
}
// the load-bearing flag: all of the above left the INTEGRATED lineage untouched
assert.strictEqual(await opHead(ws), opBefore, "reads don't advance the current op (--no-integrate-operation)"); n++;

// Strictly-@-by-design: a clean worktree means NO changes; the anchor stays
// the current head (@), never flips to the commit just made.
ok((await jjIn(ws, ["commit", "-m", "step2"])).code === 0, "step2 commit");
const stB = await jjWorkspaceStatus(ws, { force: true });
ok(stB.ok, "status B ok: " + JSON.stringify(stB));
{
  ok(stB.changes.length === 0, "clean worktree → no changes (strictly worktree): " + JSON.stringify(stB.changes));
  ok(stB.conflicts.length === 0, "no conflicts");
  ok(stB.head.marker === "@", "anchor stays @ (the current head): " + JSON.stringify(stB.head));
  ok(stB.head.description === "", "fresh empty working copy has no description: " + JSON.stringify(stB.head));
  ok(/^[0-9a-f]{12}$/.test(stB.head.id), "head id is the working copy's: " + JSON.stringify(stB.head));
  // The review dropdown's list: newest-first, and the root (the log's floor)
  // is the LAST row — a small repo's log reaches the root within the first page.
  ok(Array.isArray(stB.commits) && stB.commits.length === 3, "commits listed (2 real + root): " + JSON.stringify(stB.commits));
  ok(stB.commits[0]?.description === "step2" && stB.commits[1]?.description === "baseline", "commits newest-first: " + JSON.stringify(stB.commits));
  ok(stB.commits.every((c) => /^[0-9a-z]{12}$/.test(c.id)), "12-char change ids (a–z form)");
  ok(stB.commits[2]?.root === true && stB.commits[2]?.id === "z".repeat(12), "the root is the last row, flagged root: " + JSON.stringify(stB.commits[2]));
  ok(stB.commits.filter((c) => !c.root).every((c) => c.empty === false), "real commits are non-empty (the root is): " + JSON.stringify(stB.commits));
  // Change-tree columns (the log template's new fields, end-to-end).
  ok(stB.commits.filter((c) => !c.root).every((c) => c.author === "test@example.com"), "author email (JJ_EMAIL), real rows: " + JSON.stringify(stB.commits));
  ok(stB.commits.every((c) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(c.date)), "author date, local ISO: " + JSON.stringify(stB.commits));
  ok(stB.commits.every((c) => c.conflict === false && Array.isArray(c.bookmarks) && Array.isArray(c.tags)), "conflict + ref fields present");
  ok(stB.commits.filter((c) => !c.root).every((c) => c.glyph === "○"), "plain rows carry jj's ○ node character (no wc/immutable/conflict in this history): " + JSON.stringify(stB.commits.map((c) => c.glyph)));
  ok(stB.commits[2]?.glyph === "◆", "the root row carries jj's immutable ◆ glyph: " + JSON.stringify(stB.commits[2]));
  // Both-id columns (the agent ref tokens quote change id + commit id).
  ok(stB.commits.every((c) => /^[0-9a-f]{12}$/.test(c.commitId)), "each row carries its 12-hex commit id: " + JSON.stringify(stB.commits));
  ok(stB.commits.every((c) => c.commitId !== c.id), "commit id (hex) differs from change id (a–z form)");
  // The graph's edges (parent COMMIT ids — rows key on the commit id, since
  // a divergent change has several commits sharing one change id).
  ok(Array.isArray(stB.commits[0].parents) && stB.commits[0].parents.length === 1
     && stB.commits[0].parents[0] === stB.commits[1].commitId, "step2's parent is baseline's COMMIT: " + JSON.stringify(stB.commits));
  ok(stB.commits[1].parents.length === 1 && /^[0-9a-f]{12}$/.test(stB.commits[1].parents[0]), "baseline's parent (the root) is a 12-hex commit id: " + JSON.stringify(stB.commits));
  ok(stB.head.parents.length === 1 && stB.head.parents[0] === stB.commits[0].commitId, "the worktree's parent is step2's COMMIT: " + JSON.stringify(stB.head));
  // The new ref columns, end-to-end (this fixture: no remotes/workspaces,
  // nothing divergent — the flags are present and false, tracking empty).
  ok(stB.commits.every((c) => Array.isArray(c.workspaces) && c.workspaces.length === 0
     && c.hidden === false && c.divergent === false && c.offset === 0
     && Array.isArray(c.tracking) && c.tracking.length === 0), "new ref columns present + quiet: " + JSON.stringify(stB.commits.map((c) => [c.workspaces, c.hidden, c.divergent, c.offset, c.tracking])));
  ok(Array.isArray(stB.head.workspaces) && stB.head.hidden === false && stB.head.divergent === false && stB.head.offset === 0 && Array.isArray(stB.head.tracking), "head carries the new ref columns: " + JSON.stringify(stB.head));
  // The id's significant prefix (jj's own shortest(8) split, end-to-end).
  ok(stB.commits.every((c) => c.id.startsWith(c.idPrefix) && c.idPrefix.length + c.idRest.length >= 8
     && c.idPrefix.length + c.idRest.length <= 12
     && c.id.slice(0, c.idPrefix.length + c.idRest.length) === c.idPrefix + c.idRest),
     "prefix+rest ≥8 ≤12 chars, a leading slice of the id: " + JSON.stringify(stB.commits));
  ok(Array.isArray(stB.head.bookmarks) && Array.isArray(stB.head.tags), "head carries the ref columns: " + JSON.stringify(stB.head));
  ok(/^[0-9a-z]{12}$/.test(stB.head.changeId), "head carries the worktree's 12-char change id: " + JSON.stringify(stB.head));
  ok(stB.head.changeId !== stB.head.id, "head change id (a–z) differs from its commit id (hex)");
  ok((await jjIn(ws, ["bookmark", "create", "test-bm", "-r", stB.commits[0].id])).code === 0, "bookmark create");
  const stB3 = await jjWorkspaceStatus(ws, { force: true });
  ok(stB3.ok && stB3.commits[0]?.bookmarks?.includes("test-bm"), "bookmark lands on ITS commit row: " + JSON.stringify(stB3.commits[0]?.bookmarks));
  ok(stB3.commits[1]?.bookmarks?.length === 0, "the other row stays ref-less: " + JSON.stringify(stB3.commits[1]?.bookmarks));
}
// New work in the worktree shows up again (worktree base), then restore the
// clean tree for the handler tests below.
await writeFile(join(ws, "a.txt"), "l1\nl2 CHANGED AGAIN\nl3\n");
const stB2 = await jjWorkspaceStatus(ws, { force: true });
{
  const by = Object.fromEntries(stB2.changes.map((e) => [e.path, e]));
  ok(by["a.txt"]?.status === "M" && by["a.txt"]?.base === "worktree", "new worktree change shows (worktree base): " + JSON.stringify(by["a.txt"]));
}
await writeFile(join(ws, "a.txt"), "l1\nl2 CHANGED\nl3\n");

const plainWs = join(base, "plain");
await mkdir(plainWs);
await writeFile(join(plainWs, "x.txt"), "x");
const ctx = {
  get(name) {
    if (name === "sessions") return { get: (id) => ({ id, header: { cwd: id === "sess-2" ? plainWs : ws } }) };
    if (name === "sandboxPolicy") return { resolve: ({ session }) => ({ mode: "workspace-write", workspaceRoot: session?.header?.cwd }) };
    return undefined;
  },
  on() {},
  effect: (fn) => { fn(); },
  logger: { info() {}, error() {} },
};
const call = (endpoint, payload) => __test.makeBrowseHandler(ctx)(endpoint, payload);

// Dirty the worktree again, with files other than a.txt (the later
// worktree-diff test expects a.txt's worktree patch to stay empty).
await writeFile(join(ws, "b.txt"), "extra\n");
await writeFile(join(ws, "c.txt"), "extra2\n");
await rm(join(ws, "n.txt"));
{ const r = await call("list", { sessionId: "sess-1" });
  ok(r.ok, "list ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.vcs?.ok === true && r.value.vcs?.backend === "jj", "list carries the vcs block (jj backend — the fixture is co-located jj+git, jj wins): " + JSON.stringify(r.value.vcs));
  ok(Array.isArray(r.value.vcs.changes) && r.value.vcs.changes.length >= 3, "worktree changes present: " + JSON.stringify(r.value.vcs?.changes));
  ok(r.value.vcs.changes.every((e) => e.base === "worktree"), "every listed change is worktree-based: " + JSON.stringify(r.value.vcs?.changes)); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: "commit" });
  ok(r.ok, "diff commit-base ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.patch.includes("-l2\n") && r.value.patch.includes("+l2 CHANGED\n"), "commit-base patch shows the step2 change: " + r.value.patch);
  ok(r.value.base === "commit" && r.value.truncated === false, "echoed base, not truncated"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: "worktree" });
  ok(r.ok && r.value.patch === "", "worktree clean → ok:true with EMPTY patch (a state, not an error)"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "k.txt", base: "commit" });
  ok(r.ok && r.value.patch.includes("+++ /dev/null") && r.value.patch.includes("-keep"), "deleted file diffs against /dev/null: " + r.value.patch); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "n.txt", base: "commit" });
  ok(r.ok && r.value.patch.includes("new file mode 100644") && r.value.patch.includes("+brand new"), "added file shows new-file header (commit base)"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "sub/s2.txt", base: "commit" });
  ok(r.ok && r.value.patch.includes("rename from sub/s.txt") && r.value.patch.includes("rename to sub/s2.txt"), "rename section: " + r.value.patch); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "../escape.txt", base: "worktree" });
  ok(!r.ok && r.error.code === "workspace-invalid-path", ".. escape → workspace-invalid-path (envelope-legal): " + JSON.stringify(r)); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "/etc/passwd", base: "worktree" });
  ok(!r.ok && r.error.code === "workspace-invalid-path", "absolute → workspace-invalid-path: " + JSON.stringify(r)); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: "evil" });
  ok(!r.ok && r.error.code === "bad-request", "base whitelist: " + JSON.stringify(r)); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt" });
  ok(!r.ok && r.error.code === "bad-request", "missing base → bad-request: " + JSON.stringify(r)); }

{ const r = await call("list", { sessionId: "sess-1" });
  const c = r.value.vcs?.commits;
  ok(Array.isArray(c) && c.length === 3, "list carries commits (newest first, 2 real + root): " + JSON.stringify(c));
  ok(c[0]?.description === "step2" && c[1]?.description === "baseline", "commit order + descriptions");
  ok(c[2]?.root === true && c[2]?.id === "z".repeat(12), "the root is the last row, flagged root");
  ok(c.every((x) => /^[0-9a-z]{12}$/.test(x.id)), "change ids are the friendly a–z form"); }
const STEP2 = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;
const BASE0 = (await jjWorkspaceStatus(ws, { force: true })).commits[1].id;
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: STEP2 });
  ok(r.ok && r.value.patch.includes("-l2\n") && r.value.patch.includes("+l2 CHANGED\n"), "diff at a change id = that commit's delta vs parent: " + r.value.patch);
  ok(r.value.base === STEP2, "echoed rev base"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "b.txt", base: STEP2 });
  ok(r.ok && r.value.patch === "", "file the commit never touched → EMPTY patch (a state, not an error)"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: BASE0 });
  ok(r.ok && r.value.patch.includes("new file mode 100644") && r.value.patch.includes("+l2\n"), "oldest commit's diff vs the empty tree: " + r.value.patch); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "sub/s2.txt", base: STEP2 });
  ok(r.ok && r.value.patch.includes("rename from sub/s.txt") && r.value.patch.includes("rename to sub/s2.txt"), "text rename at a change id: " + r.value.patch);
  ok(r.value.binary === undefined, "text-file rename carries NO binary block (the rename gate must not fire for non-binary): " + JSON.stringify(r.value && Object.keys(r.value))); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: "deadbeef0000" });
  ok(!r.ok && r.error.code === "internal", "unresolvable rev (rewritten history) → internal (jj-error mapped, envelope-legal): " + JSON.stringify(r)); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: "abc12" });
  ok(!r.ok && r.error.code === "bad-request", "too-short id → bad-request: " + JSON.stringify(r)); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "a.txt", base: "a@ & root() | all()" });
  ok(!r.ok && r.error.code === "bad-request", "revset injection via base → bad-request (hex whitelist)"); }
{ const r = await call("diff", { relPath: "a.txt", base: "worktree" });
  ok(!r.ok && r.error.code === "bad-request", "missing sessionId → bad-request: " + JSON.stringify(r)); }

// History at this point: root → baseline (a.txt, k.txt, sub/s.txt) → step2
// (a.txt M, n.txt A, k.txt D, sub/s.txt → sub/s2.txt). The worktree is dirty
// (b.txt A, c.txt A, n.txt D), none of that may leak into a snapshot.
{ const r = await call("list", { sessionId: "sess-1", rev: BASE0 });
  ok(r.ok, "list@rev ok: " + JSON.stringify(r?.error ?? null));
  const paths = (r.value.entries || []).map((e) => e.path).sort();
  assert.deepStrictEqual(paths, ["a.txt", "k.txt", "sub"], "baseline snapshot = exact baseline tree (no worktree files): " + JSON.stringify(paths));
  const sub = r.value.entries.find((e) => e.name === "sub");
  ok(sub && sub.isDirectory === true, "synthesized directory entry");
  ok(!r.value.entries.some((e) => e.path === "n.txt"), "worktree-only n.txt absent from the old snapshot");
  ok(r.value.vcs?.ok === true && Array.isArray(r.value.vcs?.commits), "vcs block stays the WORKTREE's (dropdown live in snapshot mode)"); }
{ const r = await call("list", { sessionId: "sess-1", rev: BASE0, relPath: "sub" });
  ok(r.ok, "list@rev sub ok: " + JSON.stringify(r?.error ?? null));
  assert.deepStrictEqual(r.value.entries.map((e) => e.path), ["sub/s.txt"], "subdir at baseline = the PRE-RENAME name: " + JSON.stringify(r.value.entries)); }
{ const r = await call("list", { sessionId: "sess-1", rev: STEP2 });
  ok(r.ok, "list@step2 ok");
  const paths = r.value.entries.map((e) => e.path).sort();
  assert.deepStrictEqual(paths, ["a.txt", "n.txt", "sub"], "step2 snapshot = post-rename/add/delete tree: " + JSON.stringify(paths)); }
{ const r = await call("list", { sessionId: "sess-1", rev: STEP2, relPath: "sub" });
  ok(r.ok, "list@step2 sub ok");
  assert.deepStrictEqual(r.value.entries.map((e) => e.path), ["sub/s2.txt"], "subdir at step2 = the POST-RENAME name"); }
{ const r = await call("list", { sessionId: "sess-1", rev: STEP2, relPath: "no/such/dir" });
  ok(r.ok && r.value.entries.length === 0, "dir absent at the rev → empty listing (a state): " + JSON.stringify(r)); }
{ const r = await call("list", { sessionId: "sess-1", rev: "worktree" });
  ok(!r.ok && r.error.code === "bad-request", "rev='worktree' is not a change id → bad-request: " + JSON.stringify(r)); }
{ const r = await call("list", { sessionId: "sess-1", rev: "abc12" });
  ok(!r.ok && r.error.code === "bad-request", "too-short rev → bad-request"); }
{ const r = await call("list", { sessionId: "sess-1", rev: "deadbeef0000" });
  ok(!r.ok && r.error.code === "internal", "unresolvable rev → internal (envelope-legal): " + JSON.stringify(r)); }
{ const r = await call("list", { sessionId: "sess-1", rev: STEP2, relPath: "../escape" });
  ok(!r.ok && r.error.code === "workspace-invalid-path", "snapshot containment: .. escape → workspace-invalid-path: " + JSON.stringify(r)); }

{ const r = await call("list", { sessionId: "sess-1", rev: STEP2 });
  ok(r.ok, "list@step2 ok (changeset): " + JSON.stringify(r?.error ?? null));
  const by = Object.fromEntries((r.value.commitChanges || []).map((e) => [e.path, e]));
  assert.deepStrictEqual(Object.keys(by).sort(), ["a.txt", "k.txt", "n.txt", "sub/s2.txt"], "step2's own changeset (vs parent): " + JSON.stringify(r.value.commitChanges));
  ok(by["a.txt"].status === "M", "M a.txt at step2");
  ok(by["n.txt"].status === "A", "A n.txt at step2");
  ok(by["k.txt"].status === "D", "D k.txt at step2");
  ok(by["sub/s2.txt"].status === "R" && by["sub/s2.txt"].oldPath === "sub/s.txt", "R sub/s2.txt keeps oldPath: " + JSON.stringify(by["sub/s2.txt"]));
  ok(!by["b.txt"] && !by["c.txt"], "worktree-only changes never leak into the commit's set"); }
{ const r = await call("list", { sessionId: "sess-1", rev: BASE0 });
  const by = Object.fromEntries((r.value.commitChanges || []).map((e) => [e.path, e]));
  assert.deepStrictEqual(Object.keys(by).sort(), ["a.txt", "k.txt", "sub/s.txt"], "baseline's changeset vs the empty tree: " + JSON.stringify(r.value.commitChanges));
  ok(Object.values(by).every((e) => e.status === "A"), "all adds at the first commit"); }
{ const r = await call("list", { sessionId: "sess-1", rev: STEP2, relPath: "sub" });
  ok(r.ok && Array.isArray(r.value.commitChanges) && r.value.commitChanges.length === 4, "a SCOPED dir listing carries the FULL changeset (the rollup prefix-filters client-side): " + JSON.stringify(r.value.commitChanges)); }
{ const r = await call("list", { sessionId: "sess-1" });
  ok(r.ok && r.value.commitChanges === undefined, "worktree-mode listing carries NO commitChanges"); }


{ const r1 = await call("list", { sessionId: "sess-2" });
  ok(r1.ok, "plain workspace still lists: " + JSON.stringify(r1?.error ?? null));
  ok(r1.value.vcs?.ok === false && r1.value.vcs.code === "not-a-workspace", "non-jj degrades: " + JSON.stringify(r1.value.vcs));
  const r2 = await call("list", { sessionId: "sess-2" });
  ok(r2.value.vcs?.ok === false && r2.value.vcs.code === "not-a-workspace", "failure cached (force=false): " + JSON.stringify(r2.value.vcs));
  const r3 = await call("list", { sessionId: "sess-2", force: true });
  ok(r3.value.vcs?.code === "not-a-workspace", "force re-probes (still not-a-workspace): " + JSON.stringify(r3.value.vcs)); }
{ const r = await call("diff", { sessionId: "sess-2", relPath: "x.txt", base: "worktree" });
  ok(!r.ok && r.error.code === "internal", "diff on non-jj workspace → internal (envelope-legal): " + JSON.stringify(r)); }

await writeFile(join(ws, "bin.dat"), Buffer.from([0, 1, 2, 255, 0]));
// a real 1×1 PNG (v1), the displayable-binary path (the base64 `data` field)
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
await writeFile(join(ws, "pic.png"), PNG1);
ok((await jjIn(ws, ["commit", "-m", "bin"])).code === 0, "binary committed (folds the current worktree)");
const BIN = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;
// v2: a different byte + an OVER-CAP png (8-byte magic + 1_001_992 NULs =
// 1_002_000 total, inside maxBuffer), the newer rev's bytes must be v2's,
// and the over-cap image gets NO data (a truncated image is broken, and the
// binary card with its size is the honest view).
const PNG2 = Buffer.from(PNG1); PNG2[PNG2.length - 1] = 0x42;
await writeFile(join(ws, "pic.png"), PNG2);
await writeFile(join(ws, "big.png"), Buffer.concat([PNG1.subarray(0, 8), Buffer.alloc(1_001_992, 0)]));
ok((await jjIn(ws, ["commit", "-m", "pic2"])).code === 0, "png v2 + over-cap png committed");
const PIC2 = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;

// binary DIFF at a change id: the host attaches the file's BYTES at the rev
// and at its parent (`<rev>-`), old|new rendering for displayable images.
{ const r = await call("diff", { sessionId: "sess-1", relPath: "pic.png", base: BIN });
  ok(r.ok && r.value.binary, "binary patch carries the binary block: " + JSON.stringify(r?.value && Object.keys(r.value)));
  ok(r.value.binary.old === null, "NEW file: no old side: " + JSON.stringify(r.value.binary.old));
  ok(r.value.binary.new && r.value.binary.new.type === "image/png", "new side sniffed: " + JSON.stringify(r.value.binary.new));
  assert.strictEqual(Buffer.from(r.value.binary.new.data, "base64").toString("hex"), PNG1.toString("hex"), "new-side bytes = the committed png"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "pic.png", base: PIC2 });
  ok(r.ok && r.value.binary && r.value.binary.old && r.value.binary.new, "MODIFIED file: both sides: " + JSON.stringify(r?.value && Object.keys(r.value.binary)));
  assert.strictEqual(Buffer.from(r.value.binary.old.data, "base64").toString("hex"), PNG1.toString("hex"), "OLD side = the PARENT's bytes (the x- read)");
  assert.strictEqual(Buffer.from(r.value.binary.new.data, "base64").toString("hex"), PNG2.toString("hex"), "NEW side = the rev's bytes"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "pic.png", base: PIC2, noBinary: true });
  ok(r.ok && r.value.binary === undefined, "noBinary (the poll's refresh) → no binary block"); }
{ const r = await call("diff", { sessionId: "sess-1", relPath: "bin.dat", base: BIN });
  ok(r.ok && r.value.binary && r.value.binary.new && r.value.binary.new.data === undefined, "non-displayable binary → block without data (the card): " + JSON.stringify(r?.value?.binary)); }

{
  const mk = (ch) => Array.from({ length: 8000 }, (_, i) => `line ${i} ${ch.repeat(100)}`).join("\n") + "\n";
  await writeFile(join(ws, "big.txt"), mk("x"));
  await rm(join(ws, "pic.png")); // the big0 commit DELETES pic.png (the binary-delete case)
  ok((await jjIn(ws, ["commit", "-m", "big0"])).code === 0, "big baseline committed");
  const BIG0 = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;
  await writeFile(join(ws, "big.txt"), mk("y"));
  const r = await call("diff", { sessionId: "sess-1", relPath: "big.txt", base: "worktree" });
  ok(r.ok, "big diff ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.truncated === true, "big diff flagged truncated");
  ok(r.value.patch.length <= 1000000, "patch capped at 1 MB: " + r.value.patch.length);
  ok(r.value.patch.endsWith("\n"), "cap cuts at a line boundary (client parser stays in sync)");
  { const r2 = await call("diff", { sessionId: "sess-1", relPath: "pic.png", base: BIG0 });
    ok(r2.ok && r2.value.binary, "deleted-binary diff ok: " + JSON.stringify(r2?.error ?? null));
    ok(r2.value.binary.new === null && r2.value.binary.old, "DELETED file: no new side, old side present: " + JSON.stringify(Object.keys(r2.value.binary)));
    assert.strictEqual(Buffer.from(r2.value.binary.old.data, "base64").toString("hex"), PNG2.toString("hex"), "old side = the parent's (last surviving) bytes"); }
}

// A binary RENAME (identical bytes): jj's --git output carries only the
// rename lines (no "Binary files" marker), and the two sides live at
// DIFFERENT paths. The endpoint must still attach both sides' bytes: the
// old side read at the parent under `rename from`, the new side at the rev
// under `rename to`. Without that, the diff view shows a bare "no changes"
// for the renamed image. (jj detects a rename only when the bytes are
// unchanged; a changed rename arrives as add+delete, like any add.)
{
  await writeFile(join(ws, "pic3.png"), PNG2);
  ok((await jjIn(ws, ["commit", "-m", "add pic3"])).code === 0, "pic3 committed");
  await rename(join(ws, "pic3.png"), join(ws, "pic4.png"));
  ok((await jjIn(ws, ["commit", "-m", "rename pic3"])).code === 0, "pic3→pic4 rename committed");
  const P4 = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;
  const r = await call("diff", { sessionId: "sess-1", relPath: "pic4.png", base: P4 });
  ok(r.ok, "rename-binary diff ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.patch.includes("rename from pic3.png") && r.value.patch.includes("rename to pic4.png"), "patch is a rename: " + r.value.patch);
  ok(!r.value.patch.includes("Binary files"), "jj rename diff carries no binary marker: " + r.value.patch);
  ok(r.value.binary, "marker-less rename still carries the binary block: " + JSON.stringify(r.value && Object.keys(r.value)));
  assert.strictEqual(Buffer.from(r.value.binary.old.data, "base64").toString("hex"), PNG2.toString("hex"), "OLD side read under rename from (the parent's pic3.png)");
  assert.strictEqual(Buffer.from(r.value.binary.new.data, "base64").toString("hex"), PNG2.toString("hex"), "NEW side read under rename to (the rev's pic4.png)");
  const r2 = await call("diff", { sessionId: "sess-1", relPath: "pic4.png", base: P4, noBinary: true });
  ok(r2.ok && r2.value.binary === undefined, "noBinary skips the rename's byte reads too");
}

// The KEYWORD bases attach bytes too: the worktree base is the "current
// changes" review (jj diff = @ vs @- — its new side is the LIVE disk read),
// the commit base the last commit's own diff (diff -r @-). Without these,
// the most common review (the uncommitted worktree) shows only the binary
// card for images.
{
  await writeFile(join(ws, "pic4.png"), PNG1); // live edit: both sides differ
  const rw = await call("diff", { sessionId: "sess-1", relPath: "pic4.png", base: "worktree" });
  ok(rw.ok && rw.value.binary && rw.value.binary.old && rw.value.binary.new, "worktree-base binary diff carries both sides: " + JSON.stringify(rw?.value && Object.keys(rw.value)));
  assert.strictEqual(Buffer.from(rw.value.binary.old.data, "base64").toString("hex"), PNG2.toString("hex"), "worktree base: OLD side = @- (the committed pic4)");
  assert.strictEqual(Buffer.from(rw.value.binary.new.data, "base64").toString("hex"), PNG1.toString("hex"), "worktree base: NEW side = the LIVE worktree bytes");
  // @- is the RENAME commit (marker-less): asked under the NEW name the
  // sides read pic4.png at @- and pic3.png at @--.
  const rc = await call("diff", { sessionId: "sess-1", relPath: "pic4.png", base: "commit" });
  ok(rc.ok && rc.value.binary && rc.value.binary.old && rc.value.binary.new, "commit-base (the @- rename commit) carries both sides: " + JSON.stringify(rc?.value && Object.keys(rc.value)));
  assert.strictEqual(Buffer.from(rc.value.binary.old.data, "base64").toString("hex"), PNG2.toString("hex"), "commit base: OLD side = @-- under rename from (pic3.png)");
  assert.strictEqual(Buffer.from(rc.value.binary.new.data, "base64").toString("hex"), PNG2.toString("hex"), "commit base: NEW side = @- under rename to (pic4.png)");
  const rn = await call("diff", { sessionId: "sess-1", relPath: "pic4.png", base: "worktree", noBinary: true });
  ok(rn.ok && rn.value.binary === undefined, "noBinary skips the byte reads at the worktree base too");
}

// A dash-prefixed path must follow a `--` separator in jj file list/show, or jj parses it as a flag.
{
  await writeFile(join(ws, "--dash.txt"), "dash\n");
  ok((await jjIn(ws, ["commit", "-m", "dash"])).code === 0, "dash-prefixed file committed");
  const DASH = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;
  const r = await call("list", { sessionId: "sess-1", rev: DASH });
  ok(r.ok, "list@dash ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.entries.some((e) => e.path === "--dash.txt"), "dash-prefixed path listed (the `--` separator): " + JSON.stringify(r.value.entries.map((e) => e.path)));
}

// Glob metacharacters in a path: jj fileset args are globs when they contain
// glob chars, so an unescaped `a*b.txt` would also diff/show/list the sibling
// `aXb.txt` (verified against jj 0.44).
{
  await writeFile(join(ws, "aXb.txt"), "ax\n");
  await writeFile(join(ws, "a*b.txt"), "ab\n");
  await writeFile(join(ws, "aXb.txt"), "ax2\n"); // BOTH change in the commit,
  await writeFile(join(ws, "a*b.txt"), "ab2\n"); // so a glob leak shows up
  ok((await jjIn(ws, ["commit", "-m", "glob"])).code === 0, "glob-metachar files committed");
  const GLOB = (await jjWorkspaceStatus(ws, { force: true })).commits[0].id;
  const r = await call("diff", { sessionId: "sess-1", relPath: "a*b.txt", base: GLOB });
  ok(r.ok, "glob-metachar diff ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.patch.includes("a*b.txt") && !r.value.patch.includes("aXb.txt"), "escaped path scopes to the literal file (no glob sibling leak): " + r.value.patch);
}

{
  const big = join(base, "big");
  await runJj(base, ["git", "init", big]);
  await mkdir(join(big, "sub"));
  await writeFile(join(big, "top.txt"), "t\n");
  ok((await runJj(big, ["commit", "-m", "b0"])).code === 0, "big baseline");
  await writeFile(join(big, "top.txt"), "t2\n");       // outside the sub "workspace"
  await writeFile(join(big, "sub", "in.txt"), "i\n");  // inside it
  const stC = await jjWorkspaceStatus(join(big, "sub"));
  ok(stC.ok, "sub-workspace status ok: " + JSON.stringify(stC));
  const paths = stC.changes.map((e) => e.path);
  ok(paths.includes("in.txt") && !paths.includes("../top.txt"), "outside-workspace change filtered: " + JSON.stringify(paths));
}

// jj's `diff -r <merge>` (the dropdown's payload) is the commit's own
// contribution over its parent(s), `jj log -p` semantics. A clean auto-merge
// contributes nothing, so the patch is empty (the client shows its "no
// changes in this commit" note). A conflicted merge's resolution is what
// shows instead.
{
  const m = join(base, "mergews");
  await runJj(base, ["git", "init", m]);
  await writeFile(join(m, "f.txt"), "a\n");
  ok((await runJj(m, ["commit", "-m", "m0"])).code === 0, "m0");
  await writeFile(join(m, "f.txt"), "ab\n");
  ok((await runJj(m, ["commit", "-m", "m1"])).code === 0, "m1");
  await writeFile(join(m, "x.txt"), "x\n");
  ok((await runJj(m, ["commit", "-m", "m2"])).code === 0, "m2");
  const idLog = (await runJj(m, ["--no-integrate-operation", "--color", "never", "log", "-G", "-T", 'change_id.short() ++ " " ++ description.first_line() ++ "\\n"'])).out;
  const pick = (d) => idLog.split("\n").find((l) => l.trim().endsWith(" " + d))?.trim().split(" ")[0];
  const merge = await runJj(m, ["new", pick("m1") + "|" + pick("m2"), "-m", "mm"]);
  ok(merge.code === 0, "merge commit made: " + merge.err);
  // The merge sits at @ (jj's "uncommitted" position), the list shows
  // ancestors(@-), i.e. commits BEHIND the worktree. Move the worktree forward
  // (jj new, NOT jj commit, commit -m would OVERWRITE the merge's
  // description) so the merge becomes a real @- entry.
  ok((await runJj(m, ["new", "-m", "post"])).code === 0, "worktree moved past the merge");
  const stM = await jjWorkspaceStatus(m, { force: true });
  ok(stM.ok && stM.commits.some((c) => c.description === "mm"), "merge listed in commits: " + JSON.stringify(stM.commits));
  ok(stM.commits.find((c) => c.description === "mm")?.empty === true, "clean merge flagged (empty) like jj log: " + JSON.stringify(stM.commits));
  ok(stM.commits.find((c) => c.description === "m1")?.empty === false, "real commit not flagged empty: " + JSON.stringify(stM.commits));
  const MM = stM.commits.find((c) => c.description === "mm").id;
  const r = await jj(m, ["diff", "-r", MM, "--git"]);
  ok(r.ok && r.value === "", "clean merge's own diff is EMPTY (jj log -p semantics): " + JSON.stringify(r.ok ? r.value : r.code));
}

// Regression (false-positive binary marker): a text file whose DIFF BODY
// contains the literal git marker strings as FILE CONTENT must not be
// classified as binary. The server's marker scan is line-based, anchored to
// column 0; the diff body prefixes content lines with space/+/−, so an
// embedded string never matches. (changestab's own src/index.ts trips this:
// its marker-scan code contains the strings, so diffing it attached an
// all-null binary block and the client rendered "binary file (content
// differs)".)
{
  const mws = join(base, "marker-ws");
  await runJj(base, ["git", "init", mws]);
  await writeFile(join(mws, "m.ts"), "export const a = 1;\n");
  ok((await runJj(mws, ["commit", "-m", "base"])).code === 0, "marker baseline");
  // Add a line carrying all three marker STRINGS inside a literal: they sit
  // mid-line (after the + prefix), never at column 0.
  await writeFile(join(mws, "m.ts"), 'export const a = 1;\nexport const m = "Binary files a/x and b/y differ | new file mode 100644 | deleted file mode 100644";\n');
  const mkCtx = {
    get(name) {
      if (name === "sessions") return { get: (id) => ({ id, header: { cwd: mws } }) };
      if (name === "sandboxPolicy") return { resolve: ({ session }) => ({ mode: "workspace-write", workspaceRoot: session?.header?.cwd }) };
      return undefined;
    },
    on() {},
    effect: (fn) => { fn(); },
    logger: { info() {}, error() {} },
  };
  const mkCall = (endpoint, payload) => __test.makeBrowseHandler(mkCtx)(endpoint, payload);
  const r = await mkCall("diff", { sessionId: "smk", relPath: "m.ts", base: "worktree" });
  ok(r.ok, "marker-file diff ok: " + JSON.stringify(r?.error ?? null));
  ok(r.value.patch.startsWith("diff --git"), "marker-file patch is a real text diff");
  ok(r.value.patch.indexOf("Binary files ") >= 0 && r.value.patch.indexOf("new file mode") >= 0, "sanity: the marker substrings ARE in the patch body (the old substring scan would have fired)");
  ok(r.value.binary === undefined, "NO binary block for a text file whose content contains the marker strings (false-positive regression)");
}

// ── tick: the jj hot-file gate ──────────────────────────────────────────
// The gate stats .jj/working_copy/tree_state + .jj/repo/op_heads/heads.
// Verified behavior: changestab's own reads (--no-integrate-operation) leave
// them stable; an INTEGRATED jj op (bookmark, new) moves op_heads/heads
// and trips the gate on the next shallow tick.
{ const r = await call("tick", { sessionId: "sess-1", dirs: [""] });
  ok(r.ok && r.value.openFile === "same" && r.value.list === "same", "jj cold tick baselines (the client already holds the listing): " + JSON.stringify(r.value)); }
{ const r = await call("tick", { sessionId: "sess-1", dirs: [""] });
  ok(r.value.openFile === "same" && r.value.list === "same", "jj quiet tick → same/same (changestab's own deep read left the hot files stable): " + JSON.stringify(r.value)); }
// An integrated op that moves the op head but NO visible state: the gate
// MUST trip (op_heads/heads is rewritten), the deep read runs, the
// signature is unchanged, and the answer is an honest "same" — a trip is
// not a change.
{ const before = await opHead(ws);
  const bb = await jjIn(ws, ["bookmark", "create", "tick-bm"]);
  ok(bb.code === 0, "bookmark create: " + bb.err);
  const after = await opHead(ws);
  ok(before !== after, "(sanity) the bookmark op moved the integrated op head");
  const r = await call("tick", { sessionId: "sess-1", dirs: [""] });
  ok(r.value.openFile === "same" && r.value.list === "same", "op-head move with no visible state change → same (gate tripped, sig did not): " + JSON.stringify(r.value)); }
// An integrated op that moves the HEAD: the commit list changes → visible.
{ const h1 = (await jjWorkspaceStatus(ws, { force: true })).head.id;
  const nv = await jjIn(ws, ["new", "-m", "tick-step"]);
  ok(nv.code === 0, "jj new: " + nv.err);
  const r = await call("tick", { sessionId: "sess-1", dirs: [""] });
  ok(r.value.list !== "same", "jj new (head moved) → list changed: " + JSON.stringify(r.value.list === "same" ? "same" : "changed"));
  const vcs = r.value.list.listings[0].vcs;
  ok(vcs.ok === true && vcs.head.id !== h1, "the fresh vcs block carries the new head"); }
{ const r = await call("tick", { sessionId: "sess-1", dirs: [""] });
  ok(r.value.list === "same", "after the deep read absorbed the state, the next shallow tick is quiet: " + JSON.stringify(r.value)); }

// The `log` endpoint's page function (the change log's scroll auto-load). A
// fresh fixture with MORE than one page of commits: page 0 (50) + the
// remainder as one short page, contiguous in jj's own order, and a page at/
// past the end that is empty (the client's exhaustion signal).
{
  const lb = await mkdtemp(join(tmpdir(), "filez-jj-log-"));
  const lws = join(lb, "ws");
  await runJj(lb, ["git", "init", lws]);
  // 54 real commits + the root = 55 rows: page 0 (50) + page 1 (4 commits +
  // the root), so the root lands on the short remainder and is the final row.
  const N = 54;
  for (let i = 1; i <= N; i++) {
    // `jj commit` (not `jj new`): it commits the current worktree as log-c<i>
    // and leaves @ a FRESH empty worktree, so the visible log (the `~ @`
    // revset) is exactly log-c1..log-c54 + the root, newest first.
    const r = await jjIn(lws, ["commit", "-m", "log-c" + i]);
    if (r.code !== 0) throw new Error("jj commit log-c" + i + ": " + r.err);
  }
  const p0 = await jjLogPage(lws, 0, 50);
  ok(p0.commits.length === 50, "log page 0 = 50 rows: " + p0.commits.length);
  const p1 = await jjLogPage(lws, 50, 50);
  ok(p1.commits.length === 5, "log page 1 = the short remainder (4 commits + the root): " + p1.commits.length);
  const all = [...p0.commits, ...p1.commits];
  ok(new Set(all.map((c) => c.id)).size === 55, "55 distinct change ids across the two pages (no overlap)");
  ok(all[0].description === "log-c54" && all[53].description === "log-c1", "newest-first across the page boundary: " + all[0].description + " … " + all[53].description);
  ok(all[54].root === true && all[54].id === "z".repeat(12), "the root is the final row (the log's floor): " + JSON.stringify(all[54]));
  // Page 0 matches the worktree status's own first 50 (same revset + order).
  const stP = await jjWorkspaceStatus(lws, { force: true });
  ok(stP.ok && p0.commits.every((c, i) => stP.commits[i]?.id === c.id), "page 0 == the vcs block's first 50 (same order)");
  const pEnd = await jjLogPage(lws, N + 1, 50);
  ok(pEnd.commits.length === 0, "a page at the end is empty (exhaustion): " + JSON.stringify(pEnd.commits));
  const pPast = await jjLogPage(lws, 1000, 50);
  ok(pPast.commits.length === 0, "a page past the hard cap is empty");
  await rm(lb, { recursive: true, force: true });
}

await rm(base, { recursive: true, force: true });
console.log(`jj: ${n} assertions passed (parse + real jj ${await new Promise((r) => execFile("jj", ["--version"], (_, so) => r(so.trim().split("\n")[0])))})`);

// The CLI is the only stable jj interface (no Node bindings. The .jj/ store
// formats are binary and churn). Every call here is READ-ONLY and must stay
// that way:
//   - `--no-integrate-operation` (jj >= 0.41): without it, every read
//     INTEGRATES the snapshot op. The current op advances. A polling browser
//     hammers the op store. With it, the read still snapshots (view stays
//     fresh) but the op is ORPHANED: never retained, current op unchanged
//     (verified across reads, test/jj.test.mjs). The `--ignore-working-copy`
//     flag avoids the brief op-store residue per read, but the view goes
//     stale until an integrated jj command. The trade is wrong for a live view.
//   - `--color never`: machine-parseable output (explicit, regardless of the
//     user's ui.color).
//   - No editor-opening commands: a `jj commit`/`jj new` without `-m` pops
//     the user's ui.editor. This module runs only diff/show/status/log reads.
//
// The output shapes match jj 0.44.0 (golden tables in test/jj.test.mjs):
//   - `diff --summary` letters A/M/D/R (+C defensively). Renames use git's
//     BRACE form `R {old => new}` / `R prefix/{old => new}suffix`, NOT
//     `old -> new`.
//   - The "uncommitted" diff is `jj diff` (default = `-r @`): jj auto-snapshots
//     the worktree into @, so @ vs @- IS the worktree diff.
//   - Head info is `jj show -r @ -T <tsv>`: one TSV line, no graph. `jj log -T`
//     needs `-G` because 0.44 renders the log graph by default (see LOG_TSV).
//     Flag-order gotcha (verified 0.44): `-G` is a LOG option, NOT global.
//     `jj -G log …` silently runs the default command with `log` as a PATHSPEC.
//   - Conflicts appear in NO diff (a conflicted merge commit diffs empty
//     against its auto-merged parents). `jj status`'s "Warning: There are
//     unresolved conflicts at these paths:" section is the machine source.
//   - A workspace that is a SUBDIRECTORY of a jj repo sees `../` pathspecs in
//     summary output. `insideWorkspace()` filters them (badges are about THIS
//     workspace. The diff endpoint re-checks containment per request anyway).

import { execFile } from "node:child_process";

const JJ_FLAGS = ["--no-integrate-operation", "--color", "never"];
// TSV column order: fixed columns first, free-text LAST (a description line
// may contain tabs; the parser takes it as the remainder). HEAD_TSV is
// `jj show -r @ -T` (no graph); LOG_TSV is `jj log -G -n 50 -T` (`-G` = flat
// list — 0.44 renders the log graph by default).
// HEAD_TSV carries BOTH ids: the worktree's commit id (its git form) AND its
// change id (jj's friendly form — the agent's natural handle for `jj
// describe/squash -r <id>`). The change tree's agent ref tokens quote both.
// The change id also carries the same shortest(8) prefix/rest split as
// LOG_TSV, so the working-copy row renders its id the way jj does.
const HEAD_TSV =
  'commit_id.short() ++ "\\t" ++ change_id.short() ++ "\\t" ++ ' +
  'change_id.shortest(8).prefix() ++ "\\t" ++ ' +
  'change_id.shortest(8).rest() ++ "\\t" ++ ' +
  'bookmarks.join(",") ++ "\\t" ++ ' +
  'tags.join(",") ++ "\\t" ++ ' +
  'self.working_copies().join(",") ++ "\\t" ++ ' +
  '(if(hidden, "1", "0")) ++ "\\t" ++ ' +
  '(if(divergent, "1", "0")) ++ "\\t" ++ ' +
  'self.change_offset() ++ "\\t" ++ ' +
  'remote_bookmarks.filter(|b| b.tracked()).map(|b| b.name() ++ "@" ++ b.remote() ++ ":" ++ b.tracking_ahead_count().lower() ++ "/" ++ b.tracking_behind_count().lower()).join(",") ++ "\\t" ++ ' +
  'parents.map(|p| p.commit_id().short()).join(" ") ++ "\\t" ++ ' +
  'description.first_line() ++ "\\n"';
// Change-tree log. Template gotchas, all verified against jj 0.45:
//   - Root-commit methods are called on an explicit receiver: `self.conflict()`
//     / `self.empty()`. A bare `conflict()` is a FUNCTION lookup and fails
//     ("Function `conflict` doesn't exist") — bare names only resolve PROPERTIES.
//   - `self.empty()` mirrors jj's own `(empty)` marker (a commit whose tree
//     equals the auto-merged parents'), so merges flag correctly without a
//     diff.stat() computation.
//   - `author.timestamp().format(...)` — `author.date()` does not exist (the
//     author is a Signature, no date method).
//   - `local_bookmarks`/`tags` are COMMIT-REF lists: `.join(",")` exists on
//     each list, but `++` of two lists is a plain Template with no `join`.
//     Hence the two separate columns.
// LOG_TSV carries BOTH ids per row: the change id (the row's identity, the
// agent's handle) and the commit id (its git form, for cross-referencing).
// The id pair is split the way jj's own log renders it: `shortest(8)` = the
// SIGNIFICANT (uniquely identifying) prefix + the rest, minimum 8 characters
// total — the client highlights the prefix exactly like jj highlights it in
// the terminal. The parents column (space-joined change ids) feeds the
// change graph's edges; a parent outside the 50-row window (or the root,
// all-z id) simply has no row, so the client draws the edge as elided.
// The glyph column is jj's own node character (its builtin_log_node
// template, priority working copy > immutable > conflicted > normal:
// @ / ◆ / × / ○ — the `~` elided case is a pruned graph node and never
// occurs here, every row is a fetched commit). The HEAD read needs no
// glyph: the worktree's head is by definition the working copy (@).
// Ref fidelity (all verified against jj 0.45): `bookmarks` (NOT
// `local_bookmarks`) renders each ref the way the CLI does — a remote ref as
// `name@remote`, a conflicted ref with a trailing `??`, an unsynced LOCAL
// ref with a trailing `*` — so the row's pills carry remote tracking +
// sync state + conflict sigils for free. `self.working_copies()` names the
// workspaces whose working copy this commit is (the `ws/0`-style markers).
// `divergent`/`hidden` + `self.change_offset()` are the CLI's
// `(divergent)`/`(hidden)` labels + the `/N` change offset (a divergent
// change id renders as `xyz/0`, `xyz/1`, …). `change_offset()` and
// `working_copies()` are METHODS (need the `self.` receiver); `divergent`,
// `hidden`, `bookmarks`, `remote_bookmarks` are PROPERTIES (bare). The
// tracking column (remote ahead/behind) filters to `tracked()` refs because
// `tracking_ahead_count()` ERRORS on an untracked remote ref (which would
// fail the whole `jj log`); `.lower()` is the SizeHint→Integer accessor in
// 0.45 (`.as_integer()`/`.as_hint()` don't exist there).
const LOG_TSV =
  'change_id.short() ++ "\\t" ++ ' +
  'commit_id.short() ++ "\\t" ++ ' +
  'change_id.shortest(8).prefix() ++ "\\t" ++ ' +
  'change_id.shortest(8).rest() ++ "\\t" ++ ' +
  'coalesce(if(current_working_copy, "@"), if(immutable, "◆"), if(conflict, "×"), "○") ++ "\\t" ++ ' +
  '(if(self.conflict(), "1", "0")) ++ "\\t" ++ ' +
  '(if(self.empty(), "1", "0")) ++ "\\t" ++ ' +
  'author.email() ++ "\\t" ++ ' +
  'author.timestamp().format("%Y-%m-%dT%H:%M:%S") ++ "\\t" ++ ' +
  'bookmarks.join(",") ++ "\\t" ++ ' +
  'tags.join(",") ++ "\\t" ++ ' +
  'self.working_copies().join(",") ++ "\\t" ++ ' +
  '(if(hidden, "1", "0")) ++ "\\t" ++ ' +
  '(if(divergent, "1", "0")) ++ "\\t" ++ ' +
  'self.change_offset() ++ "\\t" ++ ' +
  'remote_bookmarks.filter(|b| b.tracked()).map(|b| b.name() ++ "@" ++ b.remote() ++ ":" ++ b.tracking_ahead_count().lower() ++ "/" ++ b.tracking_behind_count().lower()).join(",") ++ "\\t" ++ ' +
  'parents.map(|p| p.commit_id().short()).join(" ") ++ "\\t" ++ ' +
  'description.first_line() ++ "\\n"';
const MAX_COMMITS = 50; // change-tree length: `-n` caps the process. The parser caps the array
const LOG_PAGE_HARD_CAP = 500; // the deepest a log page may reach (10 pages); a page past it returns []

// Failure codes safe to remember per workspace (structural, not transient).
const STRUCTURAL = new Set(["jj-missing", "not-a-workspace"]);
const jjFailCache = new Map<string, string>(); // workspaceRoot → structural failure code

export type JjCode = "jj-missing" | "not-a-workspace" | "jj-timeout" | "jj-overflow" | "jj-error";
export type JjResult =
  | { ok: true; value: string | Buffer }
  | { ok: false; code: JjCode; message: string };

/**
 * The function runs jj in the workspace. It resolves and never throws
 * (result shape: JjResult). `value` is a Buffer when opts.encoding is
 * "buffer".
 */
export function jj(
  workspaceRoot: string,
  args: string[],
  { maxBuffer = 4 * 1024 * 1024, timeout = 8000, encoding = "utf8" }: { maxBuffer?: number; timeout?: number; encoding?: BufferEncoding | "buffer" } = {},
): Promise<JjResult> {
  return new Promise((resolve) => {
    execFile("jj", [...JJ_FLAGS, ...args], { cwd: workspaceRoot, maxBuffer, timeout, encoding },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as { code?: string | number; message?: string; killed?: boolean };
          const msg = (String(stderr || "").trim() || String(err.message || "").trim()).split("\n")[0] || "jj failed";
          if (e.code === "ENOENT") {
            // ENOENT is ambiguous: the jj binary is missing (structural,
            // safe to cache) OR the cwd (workspace dir) is gone (transient.
            // Caching it as jj-missing poisons the verdict forever).
            // The one-shot probe decides which.
            return jjBinaryOnPath().then((onPath) => resolve(onPath
              ? { ok: false, code: "jj-error", message: "jj spawn failed (workspace directory missing?)" }
              : { ok: false, code: "jj-missing", message: "jj binary not found on PATH" }));
          }
          if (/maxBuffer length exceeded/i.test(msg))
            return resolve({ ok: false, code: "jj-overflow", message: "jj output exceeded the buffer cap" });
          if (e.killed)
            return resolve({ ok: false, code: "jj-timeout", message: "jj timed out" });
          if (/no jj repo/i.test(msg))
            return resolve({ ok: false, code: "not-a-workspace", message: msg });
          return resolve({ ok: false, code: "jj-error", message: msg });
        }
        resolve({ ok: true, value: stdout as string | Buffer });
      });
  });
}

/**
 * The function escapes glob metacharacters so jj's FILESET argument matches
 * the path LITERALLY. A fileset arg containing glob chars is a glob. An
 * unescaped `a*b.txt` also matches `aXb.txt` in diff/show/list (verified
 * against jj 0.44). The git analog is the `:(literal)` pathspec magic
 * (git.ts).
 */
export function jjEscapePath(p: string): string {
  return p.replace(/[\\*?\[\]{}!]/g, "\\$&");
}

// One-shot: the jj binary is on PATH or absent. `jj --version` needs no repo
// (the flags are repo-independent), so the probe isolates "binary missing"
// from "cwd missing".
let jjOnPath: Promise<boolean> | null = null;
function jjBinaryOnPath(): Promise<boolean> {
  if (!jjOnPath) {
    jjOnPath = new Promise((resolve) => {
      execFile("jj", [...JJ_FLAGS, "--version"], { timeout: 8000 }, (err) => resolve(!err));
    });
  }
  return jjOnPath;
}

export interface ChangeEntry {
  path: string;
  status: string;
  oldPath?: string | null;
}

/**
 * `jj diff --summary` stdout → [{ path, status, oldPath? }]. The parser skips
 * unknown lines, never fatal. Paths keep their spaces.
 */
export function parseSummary(text: string | Buffer): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^([AMDRC])\s+(.*)$/);
    if (!m) continue;
    const status = m[1]!;
    const rest = m[2]!.trim();
    if (!rest) continue;
    if (status === "R") {
      const i = rest.indexOf("{");
      const j = rest.lastIndexOf("}");
      if (i >= 0 && j > i) {
        const prefix = rest.slice(0, i);
        const suffix = rest.slice(j + 1);
        const inner = rest.slice(i + 1, j);
        const k = inner.indexOf(" => ");
        if (k > 0) {
          const o = prefix + inner.slice(0, k) + suffix;
          const nw = prefix + inner.slice(k + 4) + suffix;
          if (o && nw) { out.push({ path: nw, status, oldPath: o }); continue; }
        }
      }
      const k = rest.indexOf(" => ");
      if (k > 0) { out.push({ path: rest.slice(k + 4).trim(), status, oldPath: rest.slice(0, k).trim() }); continue; }
      out.push({ path: rest, status, oldPath: null }); // opaque last resort
      continue;
    }
    out.push({ path: rest, status });
  }
  return out;
}

/** `jj show -r @ -T <tsv>` stdout → the worktree row's fields, or null (first TSV line; id = commit id, changeId = the worktree's change id, parents = the head's parent COMMIT ids — the graph's edge from the working-copy row; see HEAD_TSV for the column order). */
export function parseHead(text: string | Buffer): { id: string; changeId: string; idPrefix: string; idRest: string; parents: string[]; bookmarks: string[]; tags: string[]; workspaces: string[]; hidden: boolean; divergent: boolean; offset: number; tracking: TrackingRef[]; description: string } | null {
  for (const line of String(text).split("\n")) {
    const m = line.match(/^([0-9a-f]{7,40})\t([0-9a-z]{7,40})\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(0|1)\t(0|1)\t([0-9]+)\t([^\t]*)\t([^\t]*)\t(.*)$/);
    if (m) return { id: m[1]!, changeId: m[2]!, idPrefix: m[3]!, idRest: m[4]!, parents: m[12]!.split(" ").filter((x) => x !== ""), bookmarks: splitRefs(m[5]!), tags: splitRefs(m[6]!), workspaces: splitRefs(m[7]!), hidden: m[8] === "1", divergent: m[9] === "1", offset: parseInt(m[10]!, 10) || 0, tracking: parseTracking(m[11]!), description: m[13]! };
  }
  return null;
}

/** A comma-joined bookmark/tag/workspace column → names (an empty column → []). */
function splitRefs(s: string): string[] {
  return s === "" ? [] : s.split(",").filter((x) => x !== "");
}

/** A tracked remote bookmark's ahead/behind counts (the CLI's "ahead 2,
 *  behind 1" — the tooltip data). The host renders `name@remote:ahead/behind`
 *  pairs, comma-joined (see LOG_TSV). */
export type TrackingRef = { name: string; remote: string; ahead: number; behind: number };
/** `name@remote:ahead/behind,name2@remote2:…` → TrackingRef[] (never fatal). */
function parseTracking(s: string): TrackingRef[] {
  if (s === "") return [];
  const out: TrackingRef[] = [];
  for (const pair of s.split(",")) {
    const at = pair.lastIndexOf("@");
    const colon = pair.lastIndexOf(":");
    if (at < 0 || colon < at) continue; // malformed — skip
    const m = pair.slice(colon + 1).match(/^(-?\d+)\/(-?\d+)$/);
    if (!m) continue;
    out.push({ name: pair.slice(0, at), remote: pair.slice(at + 1, colon), ahead: parseInt(m[1]!, 10), behind: parseInt(m[2]!, 10) });
  }
  return out;
}

export interface CommitRow {
  id: string;        // change id (jj's friendly form) — the row's identity
  commitId: string;  // commit id (git form) — for cross-referencing
  idPrefix: string;  // the significant (unique) prefix of `id`, jj's shortest(8)
  idRest: string;    // the rest of shortest(8) — prefix + rest ≥ 8 chars
  glyph: string;     // jj's node character: @ working copy, ◆ immutable, × conflicted, ○ normal
  conflict: boolean;
  empty: boolean;
  root: boolean;     // jj's root commit (change id all-z): the log's floor
  author: string;
  date: string;
  bookmarks: string[]; // the CLI's ref strings: name, name@remote, + `*`/`??` sigils
  tags: string[];
  workspaces: string[]; // workspaces whose working copy is this commit
  hidden: boolean;      // the CLI's (hidden) label (takes precedence over divergent)
  divergent: boolean;   // the CLI's (divergent) label: the change has >1 commit
  offset: number;       // the change offset — rendered as /N when hidden|divergent
  tracking: TrackingRef[]; // tracked remote bookmarks' ahead/behind (tooltip)
  parents: string[]; // parent COMMIT ids (short form) — the graph's edges
  description: string;
}

/**
 * `jj log -G -T <tsv>` stdout → the change-tree rows (newest first, capped
 * at MAX_COMMITS). Columns: id (change id), commitId (commit id), idPrefix,
 * idRest (jj's shortest(8) split), glyph (@/◆/×/○), conflict(0|1),
 * empty(0|1), author, date, bookmarks (the CLI's ref strings, incl.
 * `@remote`/`*`/`??`), tags, workspaces, hidden(0|1), divergent(0|1),
 * change offset (int), tracking (`name@remote:ahead/behind` pairs), parents
 * (space-joined COMMIT ids), description (see LOG_TSV). The root revision
 * (all-z change id) is INCLUDED as the log's final row — `root` is set, so the
 * change tree terminates at a visible floor instead of a bare line out the
 * bottom edge. The parser skips non-TSV lines and is never fatal. `change_id.short()` is jj's FRIENDLY form, 12 lowercase a–z letters
 * (NOT hex. Full change ids and commit ids are hex). The class is
 * deliberately `[0-9a-z]` so a hex full-id TSV parses too.
 */
export function parseCommitLog(text: string | Buffer, cap: number = MAX_COMMITS): CommitRow[] {
  const out: CommitRow[] = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^([0-9a-z]{7,40})\t([0-9a-f]{7,40})\t([0-9a-z]*)\t([0-9a-z]*)\t([^\t]*)\t(0|1)\t(0|1)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(0|1)\t(0|1)\t([0-9]+)\t([^\t]*)\t([^\t]*)\t(.*)$/);
    if (!m) continue;
    const isRoot = m[1] === "z".repeat(m[1]!.length); // jj's root = the log's floor
    out.push({
      id: m[1]!,
      commitId: m[2]!,
      idPrefix: m[3]!,
      idRest: m[4]!,
      glyph: m[5] === "" ? "○" : m[5]!,
      conflict: m[6] === "1",
      empty: m[7] === "1",
      root: isRoot,
      author: m[8]!,
      date: m[9]!,
      bookmarks: splitRefs(m[10]!),
      tags: splitRefs(m[11]!),
      workspaces: splitRefs(m[12]!),
      hidden: m[13] === "1",
      divergent: m[14] === "1",
      offset: parseInt(m[15]!, 10) || 0,
      tracking: parseTracking(m[16]!),
      parents: m[17]!.split(" ").filter((x) => x !== ""),
      description: m[18]!,
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** `jj status` stdout → conflicted paths (the "unresolved conflicts" warning section). */
export function parseConflicts(text: string | Buffer): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of String(text).split("\n")) {
    if (!inSection) {
      if (/^Warning: There are unresolved conflicts at these paths:/.test(line)) inSection = true;
      continue;
    }
    const m = line.match(/^(.+?)\s{2,}\d+-sided conflict$/);
    if (m) { out.push(m[1]!.trim()); continue; }
    break; // section ended
  }
  return out;
}

/** A cwd-relative pathspec stays inside the workspace (no absolute, no `..` escape). */
export function insideWorkspace(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (rel.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rel)) return false;
  let depth = 0;
  for (const part of rel.split("/")) {
    if (part === "..") depth -= 1;
    else if (part !== "." && part !== "") depth += 1;
    if (depth < 0) return false;
  }
  return true;
}

/**
 * `jj diff --summary -r <rev>` → the SELECTED COMMIT's own changeset (vs its
 * parent(s)), same shape and letters as the worktree changes.
 * Workspace-scoped: the function drops `../` paths outside a subdirectory
 * workspace. A clean merge contributes nothing → [] (jj's own `diff -r`
 * semantics, so a file's badge and its per-file diff at that commit agree).
 * A failure (non-jj workspace, rewritten rev) → [] too: the badges are
 * simply absent, the listing stands.
 */
export async function jjCommitChanges(workspaceRoot: string, rev: string): Promise<ChangeEntry[]> {
  const s = await jj(workspaceRoot, ["diff", "--summary", "-r", rev]);
  if (!s.ok) return [];
  const keep = (e: ChangeEntry) => insideWorkspace(e.path) || (e.oldPath !== null && e.oldPath !== undefined && insideWorkspace(e.oldPath));
  return parseSummary(s.value).filter(keep);
}

/**
 * One page of the change log beyond the first (the `log` endpoint). `offset`
 * commits are skipped and `limit` returned, in jj's OWN log order (newest
 * first) — the same order the worktree's first page arrives in, so the client
 * can append a page below the rows it already holds. The revset is
 * `builtin_log() ~ @` (jj's default `jj log` scope minus the working copy,
 * which the head row renders separately). `jj log -n <offset+limit>` fetches
 * the first `offset+limit` rows and the slice picks this page; the fetch is
 * capped at LOG_PAGE_HARD_CAP, so a page that reaches past it returns [] —
 * the client treats a short page as the end of the log. Read-only, like
 * every other jj call here.
 */
export async function jjLogPage(workspaceRoot: string, offset: number, limit: number): Promise<{ commits: CommitRow[] }> {
  if (offset >= LOG_PAGE_HARD_CAP) return { commits: [] };
  const need = Math.min(LOG_PAGE_HARD_CAP, offset + limit);
  const s = await jj(workspaceRoot, ["log", "-G", "-n", String(need), "-r", "builtin_log() ~ @", "-T", LOG_TSV]);
  if (!s.ok) return { commits: [] };
  const all = parseCommitLog(s.value, need);
  return { commits: all.slice(offset, offset + limit) };
}

/**
 * The SELECTED change's full commit message (the change tree's rows carry
 * only `first_line()` — the log templates keep the 50-row wire compact, and
 * a raw multi-line description would break their line-based parse).
 * `jj log -G -r <rev> -T 'description'`: the template is the raw
 * description, which jj emits VERBATIM — 0 bytes when empty (verified
 * 0.45). `<rev>` is the row's COMMIT id (a divergent change's two rows
 * share a change id, but each row describes its own commit; a commit id
 * resolves to exactly one row in the revset) or `@` for the working-copy
 * row. Trailing newlines are stripped host-side (a display normalization —
 * interior blank lines are kept). A failure (a rewritten rev) → "" (the
 * client then shows nothing; the row's first line still stands).
 */
export async function jjDescription(workspaceRoot: string, rev: string): Promise<string> {
  const res = await jj(workspaceRoot, ["log", "-G", "-r", rev, "-T", "description"]);
  if (!res.ok) return "";
  return String(res.value).replace(/\n+$/, "");
}

export type JjWorkspaceStatusResult =
  | {
      ok: true;
      head: { id: string; changeId: string; parents: string[]; bookmarks: string[]; tags: string[]; description: string; marker: string };
      changes: (ChangeEntry & { base: "worktree" | "conflict" })[];
      conflicts: string[];
      commits: CommitRow[];
    }
  | { ok: false; code: JjCode; message?: string };

/**
 * One call → the whole `jj` block for the list response (shape:
 * JjWorkspaceStatusResult). Changes are STRICTLY the working copy
 * (`jj diff` = `@` vs `@-`): a clean worktree shows "no changes" by design.
 * `head` + `changes` are the working-copy row of the change tree; `commits`
 * are the rows below it (jj's default `jj log` scope, `builtin_log() ~ @` —
 * the worktree's ancestry plus sibling branches from bookmarks/tags). A picked
 * change id drives the diff endpoint's `jj diff -r <id>`. The badges stay
 * worktree-based. Conflicts override the letter. They come from `jj status`
 * (they appear in no diff). Per-commit conflicts come from the log template
 * (`self.conflict()` — worktree AND historical; the status warning only
 * covers the worktree).
 */
export async function jjWorkspaceStatus(
  workspaceRoot: string,
  { force = false }: { force?: boolean } = {},
): Promise<JjWorkspaceStatusResult> {
  if (!force) {
    const cached = jjFailCache.get(workspaceRoot);
    if (cached) return { ok: false, code: cached as JjCode };
  }
  const fail = (code: JjCode, message?: string): { ok: false; code: JjCode; message?: string } => {
    if (STRUCTURAL.has(code)) jjFailCache.set(workspaceRoot, code);
    return { ok: false, code, message: message || undefined };
  };

  // 1) Probe + the uncommitted diff in one read: `jj diff` = `@` vs `@-`.
  //    `@` is the anchor, always.
  const s1 = await jj(workspaceRoot, ["diff", "--summary"]);
  if (!s1.ok) return fail(s1.code, s1.message);
  // 2) head(@) + conflicts + the commit list. (`jj show` can append the diff
  //    below the template line. parseHead scans for the TSV line.) A log
  //    failure is NON-FATAL: commits degrades to [], the rest is untouched.
  //
  //    The commit revset is `builtin_log() ~ @` — jj's OWN default `jj log`
  //    scope, minus the working copy (rendered separately as the head row).
  //    `builtin_log()` is the curated "what a plain `jj log` shows" set: the
  //    worktree's ancestry PLUS sibling branches reachable from bookmarks /
  //    tags (a fork's off-path child is visible, matching the terminal). The
  //    older `ancestors(@-)` was worktree-history-only and silently pruned
  //    any branch that left the worktree's ancestor path — a fork child with
  //    no descendant back on the path never rendered. `~ @` drops the working
  //    copy so it isn't drawn twice; root is already excluded by builtin_log().
  const [headAt, st, log] = await Promise.all([
    jj(workspaceRoot, ["show", "-r", "@", "-T", HEAD_TSV]),
    jj(workspaceRoot, ["status"]),
    jj(workspaceRoot, ["log", "-G", "-n", String(MAX_COMMITS), "-r", "builtin_log() ~ @", "-T", LOG_TSV]),
  ]);
  if (!headAt.ok) return fail(headAt.code, headAt.message);
  const conflicts = (st.ok ? parseConflicts(st.value) : []).filter(insideWorkspace);
  const commits = log.ok ? parseCommitLog(log.value) : [];
  const keep = (e: ChangeEntry) => insideWorkspace(e.path) || (e.oldPath !== null && e.oldPath !== undefined && insideWorkspace(e.oldPath));
  const byPath = new Map<string, ChangeEntry & { base: "worktree" | "conflict" }>();
  for (const e of parseSummary(s1.value).filter(keep))
    // jj has no staging area: an `A` in the worktree diff (@ vs @-) means
    // "on disk, not yet in any real commit" — jj auto-snapshotted it, the
    // user did nothing. That IS the unadded (U) state git shows for `??`
    // files, so the markers agree across backends. Renames keep R (the
    // destination has an oldPath; a rename's source side is a tracked
    // deletion, not an unadded file).
    byPath.set(e.path, { path: e.path, status: e.status === "A" ? "U" : e.status, oldPath: e.oldPath ?? null, base: "worktree" });
  for (const p of conflicts) {
    const cur = byPath.get(p);
    if (cur) cur.status = "C";
    else byPath.set(p, { path: p, status: "C", oldPath: null, base: "conflict" });
  }
  const head = parseHead(headAt.value) ?? { id: "", changeId: "", idPrefix: "", idRest: "", parents: [], bookmarks: [], tags: [], workspaces: [], hidden: false, divergent: false, offset: 0, tracking: [], description: "" };
  return {
    ok: true,
    head: { ...head, marker: "@" },
    changes: [...byPath.values()],
    conflicts,
    commits,
  };
}

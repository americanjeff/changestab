// src/dsh/client.tsx, changestab web client: the read-only "Changes" tab —
// the change tree, each change's changed files, and the
// selected file's diff. No content preview: plain viewing is the official
// file viewer's job (the head row's "Open in Files" hands the file over).
//
// This file is a plain ES module (TSX). The dsh web shell loads a CJS
// `factory`/`require` closure. The tsdown banner (tsdown.config.ts) adds
// that wrapper, not this file. The web shell's frozen platform seed answers
// the externals (react, react/jsx-runtime, the optional ui-primitives)
// through the injected `require`.
//
// The diff is computed by the HOST (the old file version exists only in the
// VCS object store) and arrives as a patch; the pane renders the patch. No
// HTTP file route exists, so a workspace file is never a same-origin
// document.

import * as React from "react";
import { css } from "./files-css.generated.js";
import { iconSvg } from "./icon-svg.generated.js";

// The optional ui-primitives package loads at RUNTIME via the injected CJS
// `require`, inside a try/catch. The package can be ABSENT from the web
// shell's module table (a minimal profile). A static import fails the whole
// bundle when the package is missing, so this code MUST stay a runtime
// require.
let P: Record<string, unknown> | null = null;
try { P = require("@deepseek-ai/dsh-client-ui-primitives") as Record<string, unknown>; } catch { P = null; }

const BROWSE_CHANNEL = "/filez-browse";
const NS = "files";
// The per-row pill cap (the rest folds to "+N"). The host caps the commit
// list at 50; the log pane scrolls, so every fetched commit gets a row.
const CHANGE_TREE_PILL_CAP = 3;

const zh: Record<string, string> = {
  "view.files": "文件", "view.changestab": "Changes",
  "files.reload": "重新加载", "files.loading": "加载中…",
  "files.pathGone": "文件夹已不存在",
  "files.fetchStuck": "目录请求未完成 —— 请点“重新加载”",
  "files.sessionRetrying": "会话正在重启 —— 正在自动重试…",
  "files.sessionGone": "会话已不可用（服务端重启或会话已结束）—— 点“重新加载”重试",
  "files.previewEmpty": "选择变更文件以查看 diff",
  "files.diffLoading": "正在加载 diff…", "files.diffError": "无法加载 diff", "files.noChanges": "无变更",
  "files.diffNew": "新文件", "files.diffDeleted": "已删除", "files.diffRenamedFrom": "重命名自",
  "files.diffBinary": "二进制文件（内容不同）", "files.diffBinaryOld": "旧版（父提交）", "files.diffBinaryNew": "新版（此提交）", "files.diffBinaryNone": "（无）",
  "files.diffNoNewline": "文件末尾无换行",
  "files.diffTruncatedPatch": "diff 已截断（过大）", "files.diffTruncatedRows": "已截断（行数过多）",
  "files.diffAtRev": "提交", "files.noChangeAtRev": "此提交未修改该文件", "files.worktreeRow": "工作树",
  "files.editing": "编辑中", "files.changeTree": "变更历史",
  "files.noFilesChanged": "没有变更文件", "files.changedFiles": "已变更文件", "files.resizeTree": "调整变更历史与文件面板大小",
  "files.loadingOlder": "正在加载更多变更…",
  "files.openInFiles": "在 Files 中打开",
  "files.noVcs": "此工作区没有已初始化的仓库", "files.noVcsHint": "运行 git init 或 jj git init 后可在此查看变更", "files.noVcsBtn": "在 Files 中浏览",
  "files.emptyCommit": "（空）", "files.noDescription": "（未设置描述）", "files.rootCommit": "根修订",
  "files.hidden": "（已隐藏）", "files.divergent": "（已分叉）", "files.conflictLabel": "（冲突）",
  "files.ahead": "领先", "files.behind": "落后",
  "files.conflictNote": "存在未解决冲突（冲突标记在文件内容中可见）",
  "files.hideNav": "隐藏文件列表", "files.restoreNav": "恢复文件列表",
  "files.guideTitle": "Changes", "files.guideDescription": "浏览会话工作区的变更与 diff",
  "files.refAdd": "把引用添加到聊天", "files.refCopy": "复制引用", "files.refCopied": "已复制",
  "files.ageNow": "刚刚", "files.ageMin": "{n} 分钟", "files.ageHour": "{n} 小时", "files.ageDay": "{n} 天",
  "files.type.png": "PNG 图像", "files.type.jpeg": "JPEG 图像", "files.type.gif": "GIF 图像",
  "files.type.bmp": "BMP 图像", "files.type.webp": "WebP 图像", "files.type.svg": "SVG 图像",
  "files.type.avif": "AVIF 图像", "files.type.icon": "图标",
  "files.type.pdf": "PDF 文档", "files.type.zip": "ZIP 压缩包", "files.type.gzip": "GZIP 文件",
  "files.type.elf": "ELF 二进制文件", "files.type.binary": "二进制文件", "files.type.markdown": "Markdown",
  "files.type.mp3": "MP3 音频", "files.type.wav": "WAV 音频", "files.type.avi": "AVI 视频",
};
const en: Record<string, string> = {
  "view.files": "Files", "view.changestab": "Changes",
  "files.reload": "Reload", "files.loading": "Loading…",
  "files.pathGone": "the folder no longer exists",
  "files.fetchStuck": "the list request did not complete — press Reload",
  "files.sessionRetrying": "the session is restarting — retrying automatically…",
  "files.sessionGone": "session is no longer available (server restarted or session ended) — press Reload to retry",
  "files.previewEmpty": "Select a changed file to view its diff",
  "files.diffLoading": "Loading diff…", "files.diffError": "Couldn't load diff", "files.noChanges": "no changes",
  "files.diffNew": "new file", "files.diffDeleted": "deleted", "files.diffRenamedFrom": "renamed from",
  "files.diffBinary": "binary file (content differs)", "files.diffBinaryOld": "old (parent)", "files.diffBinaryNew": "new (this commit)", "files.diffBinaryNone": "(none)",
  "files.diffNoNewline": "no newline at end of file",
  "files.diffTruncatedPatch": "diff truncated (large)", "files.diffTruncatedRows": "truncated (too many rows)",
  "files.diffAtRev": "commit", "files.noChangeAtRev": "no changes to this file in this commit", "files.worktreeRow": "Working Tree",
  "files.editing": "Editing", "files.changeTree": "Change history",
  "files.noFilesChanged": "no files changed", "files.changedFiles": "Changed files", "files.resizeTree": "Resize the change log and the changed-files pane",
  "files.loadingOlder": "Loading more changes…",
  "files.openInFiles": "Open in Files",
  "files.noVcs": "no initialized repository in this workspace", "files.noVcsHint": "run git init or jj git init here to see its changes", "files.noVcsBtn": "Browse in Files",
  "files.emptyCommit": "(empty)", "files.noDescription": "(no description set)", "files.rootCommit": "root",
  "files.hidden": "(hidden)", "files.divergent": "(divergent)", "files.conflictLabel": "(conflict)",
  "files.ahead": "ahead", "files.behind": "behind",
  "files.conflictNote": "unresolved conflict — markers visible in the file",
  "files.hideNav": "Hide file list", "files.restoreNav": "Restore file list",
  "files.guideTitle": "Changes", "files.guideDescription": "Browse this session workspace's changes and diffs",
  "files.refAdd": "Add ref to chat", "files.refCopy": "Copy ref", "files.refCopied": "Copied",
  "files.ageNow": "now", "files.ageMin": "{n}m", "files.ageHour": "{n}h", "files.ageDay": "{n}d",
  "files.type.png": "PNG image", "files.type.jpeg": "JPEG image", "files.type.gif": "GIF image",
  "files.type.bmp": "BMP image", "files.type.webp": "WebP image", "files.type.svg": "SVG image",
  "files.type.avif": "AVIF image", "files.type.icon": "icon",
  "files.type.pdf": "PDF document", "files.type.zip": "ZIP archive", "files.type.gzip": "GZIP file",
  "files.type.elf": "ELF binary", "files.type.binary": "binary file", "files.type.markdown": "Markdown",
  "files.type.mp3": "MP3 audio", "files.type.wav": "WAV audio", "files.type.avi": "AVI video",
};

const CSS_TAG = "changestab/Files.css";
function injectCss(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')) return;
  const el = document.createElement("style");
  el.setAttribute("data-plugin", "changestab");
  el.setAttribute("data-plugin-css", CSS_TAG);
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
}

const ICON_SPRITE_TAG = "changestab/icon.svg";
// The brand glyph ships as a hidden SPRITE: the shell serves only client.js
// per plugin (no asset route), so scripts/inject-icon.mjs embeds the SVG at
// build time and this mounts it once, the same apply-time, once-per-document
// pattern as injectCss. The sprite's ids are namespaced at build time, so
// every visible glyph is a plain <use> with no per-instance handling.
function mountIconSprite(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector('svg[data-plugin-icon="' + ICON_SPRITE_TAG + '"]')) return;
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("data-plugin", "changestab");
  el.setAttribute("data-plugin-icon", ICON_SPRITE_TAG);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("width", "0");
  el.setAttribute("height", "0");
  el.style.cssText = "position:absolute";
  el.innerHTML = iconSvg;
  (document.body || document.documentElement).appendChild(el);
}

function Icon(name: string, props: { className?: string; size?: number } | undefined, fallback: string): React.ReactElement {
  const C = P ? (P[name] as unknown) : null;
  if (typeof C === "function") return React.createElement(C as React.ComponentType<{ className?: string; size?: number }>, props);
  return React.createElement("span", { className: props ? props.className : undefined, "aria-hidden": "true" }, fallback);
}
// The nav column's state-pair glyph: a double chevron (» / «). The host's
// icon set has only single chevrons (IconChevron*Outline14), and a lone » is
// ambiguous in a button row (it reads as disclosure), so the pane toggle
// ships its own inline glyph. It points at the nav while it hides (right)
// and back at the gap it leaves while it restores (left).
function NavChevron(props: { size?: number; className?: string; dir?: "left" | "right" }): React.ReactElement {
  const right = props.dir !== "left";
  return React.createElement("svg", {
    width: props.size || 14, height: props.size || 14, viewBox: "0 0 14 14", fill: "none",
    className: props.className, "aria-hidden": "true", xmlns: "http://www.w3.org/2000/svg",
  }, React.createElement("path", {
    d: right ? "M3.25 3.5 L7.25 7 L3.25 10.5 M6.75 3.5 L10.75 7 L6.75 10.5"
             : "M10.75 3.5 L6.75 7 L10.75 10.5 M7.25 3.5 L3.25 7 L7.25 10.5",
    stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
  }));
}
// A rejected RPC carries the host's error code alongside its message so
// callers can branch on the code rather than string-matching the text. The
// message keeps the "code: message" shape the panes used to show verbatim.
class RpcError extends Error {
  readonly code: string;
  /** The host's details object (the closed envelope carries a per-code shape, e.g. details.path). */
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message || code);
    this.name = "RpcError";
    this.code = code;
    this.details = details;
  }
}
function unwrap<T>(result: unknown): T {
  const r = result as { ok?: boolean; value?: T; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null | undefined;
  if (!r || r.ok !== true) {
    const err = r && r.error;
    // .code always carries a code for branching; the "rpc-failed" fallback is
    // a synthetic marker, not a host code, so it is never shown in the text.
    const code = typeof err?.code === "string" && err.code ? err.code : "rpc-failed";
    const msg = err && typeof err.message === "string" ? err.message : "";
    const shown = code === "rpc-failed"
      ? (msg || "rpc failed")
      : (msg ? code + ": " + msg : code);
    // details rides along (callers can branch on it — BUG-009's recovery
    // reads details.path) while the text keeps the code + message shape.
    const details = (err?.details && typeof err.details === "object") ? err.details : undefined;
    throw new RpcError(code, shown, details);
  }
  return r.value as T;
}
// The host tears a session down (server restart, session closed) while this
// view still holds its id, so every RPC for it fails with session-not-found.
// That is a distinct condition for this view — not a transient read hiccup —
// so callers branch on it specifically. It is NOT instantly terminal: a
// restarted server cold-resolves the session by id within seconds, so the
// view retries a few times (async, exponential backoff) before the latch
// turns terminal. The ⟳ button stays the manual escape hatch.
const GONE_RETRY_MAX = 3;
const goneRetryDelay = (n: number): number => 1500 * 2 ** n; // 1.5s, 3s, 6s
function isSessionGone(e: unknown): boolean {
  return (e as { code?: unknown } | null | undefined)?.code === "session-not-found";
}
// Human text for a rejected RPC. session-not-found gets a friendly localized
// line (never the raw code + UUID); anything else passes its message through.
function rpcErrorText(e: unknown, t: TFunc): string {
  if (isSessionGone(e)) return t("files.sessionGone");
  // A vanished listing directory (BUG-009): the localized note names the
  // dead path from details.path — never the raw "internal: not-found" string.
  if ((e as { code?: unknown } | null | undefined)?.code === "directory-unreadable") {
    const path = (e as { details?: { path?: unknown } } | null | undefined)?.details?.path;
    return t("files.pathGone") + (typeof path === "string" && path ? " (" + path + ")" : "");
  }
  const m = (e as { message?: string } | null | undefined)?.message;
  return m ? m : String(e);
}
function formatBytes(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "";
  const v0 = Number(n);
  if (!isFinite(v0)) return "";
  if (v0 < 1024) return v0 + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let v = v0, u = -1;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  const rounded = Math.round(v * 10) / 10;
  return (rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)) + " " + (units[u] || "");
}
// Client-side file-type labels. The host sends the sniffed/derived MIME type
// (plus an English label it no longer displays); the displayed label comes
// from the active locale dictionary so it follows the user's language.
// Unknown types fall back to the raw MIME string (a technical token, identical
// in every language); a missing type falls back to the localized "binary file".
const TYPE_LABEL_KEYS: Record<string, string> = {
  "image/png": "files.type.png", "image/jpeg": "files.type.jpeg", "image/gif": "files.type.gif",
  "image/bmp": "files.type.bmp", "image/webp": "files.type.webp", "image/svg+xml": "files.type.svg",
  "image/avif": "files.type.avif", "image/x-icon": "files.type.icon",
  "application/pdf": "files.type.pdf", "application/zip": "files.type.zip", "application/gzip": "files.type.gzip",
  "application/x-elf": "files.type.elf", "application/octet-stream": "files.type.binary",
  "text/markdown": "files.type.markdown", "audio/mpeg": "files.type.mp3", "audio/vnd.wave": "files.type.wav",
  "video/vnd.avi": "files.type.avi",
};
function typeLabel(type: string | undefined, t: TFunc): string {
  const key = type ? TYPE_LABEL_KEYS[type] : undefined;
  return key ? t(key) : type ? type : t("files.type.binary");
}

// ---- Section references ("refer this selection to the chat") ----
//
// The reference a selection produces is the shortest string that points at
// one section of one file such that BOTH readers resolve it: the user,
// reading it back in the draft, and the agent, which follows the
// "@-prefixed paths are files explicitly referenced by the user" rule and
// calls read with offset/limit. It is therefore always a canonical dsh
// `@path` mention (the ref degrades to a plain file ref if the fragment is
// ignored), optionally a GitHub-style line fragment, optionally the
// selected text quoted.
//
// The generated string is a fixed-ASCII technical token, NOT UI copy — it is
// never localized. Only the button labels/tooltips around it are.
//
// Shapes (all workspace-relative, VS Code-style `path:line-line`; the
// `@path` core is dsh's native mention, so the ref degrades to a plain file
// ref if a model ignores the fragment):
//   view pane              @src/foo.ts:12          @src/foo.ts:12-40
//   diff, new side         @src/foo.ts:12-16       (numbers = worktree lines)
//   diff, old side only    @src/foo.ts "deleted…"  (no numbers: those lines
//                                            no longer exist in the worktree,
//                                            so the quoted snippet is the only
//                                            reliable anchor)
//   snapshot (commit rev)  @src/foo.ts@abc123:12-40
//   preview (rendered)     @docs/notes.md "first selected line…" (rendered
//                                            markdown has no stable source
//                                            line numbers → snippet anchor)
//   path with a space      @"my dir/foo.ts":12-40  (dsh quoted-mention)
//   External (outside the  /home/u/notes.md:12-40   (no `@`: that grammar is
//    workspace)              /home/u/notes.md "…"    workspace-relative)
// When a quoted snippet is present it follows the fragment, whitespace-
// separated: `@path:12-40 "…text…"`.

// The quote cap: the full selection at or below it, otherwise the head plus
// the ellipsis (the section's beginning is the identifying part).
const REF_TEXT_MAX = 200;

function mentionOf(path: string): string {
  const p = String(path || "");
  if (!p) return "@";
  // Whitespace, a double quote, or a control char forces the dsh quoted
  // grammar (`@"path"`); the grammar cannot represent those inside, so they
  // are dropped (a workspace path containing them degrades best-effort).
  if (/[ \s"\u0000-\u001f\u007f-\u009f]/.test(p)) {
    const clean = p.replace(/[\u0000-\u001f\u007f-\u009f"]/g, "");
    return clean ? '@"' + clean + '"' : "@";
  }
  return "@" + p;
}

// One builder for both copy variants: the line-range ref is the input
// without `text`, the snippet ref the same input with it. A missing range is
// the snippet-only shape (deleted diff lines, rendered preview, an
// unresolvable selection) — the quote is the anchor then.
interface RefInput {
  path: string;
  /** 1-based inclusive line range; absent → no fragment. */
  start?: number;
  end?: number;
  /** 1-based column WITHIN the line (a click's exact point). Emitted as
      `:line:col` — the universal file:line:col convention — only for a
      single line with no quoted text: a range spans columns, and a quoted
      single-line selection is already anchored by its text. */
  col?: number;
  /** The commit under review (snapshot mode): `@rev` before the fragment. */
  rev?: string;
  /** The selected text (quoted after the fragment when non-blank). */
  text?: string;
  /** An out-of-workspace (External) file: the path goes in verbatim, WITHOUT
      the `@` mention. The `@` grammar is workspace-relative by dsh's
      convention ("@-prefixed paths are files explicitly referenced, relative
      to the workspace root"), so an outside file is referenced by its
      absolute path alone — the agent's read tool takes absolute paths, and
      dsh's file sandbox fences writes, never reads. A bare path needs no
      quoting: there is no `@`-grammar to break on whitespace. */
  bare?: boolean;
}
function buildFileRef(inp: RefInput): string {
  let out = inp.bare ? String(inp.path || "") : mentionOf(inp.path);
  // @rev applies to the ref as a whole (the file AND the quoted text are the
  // state at that commit) — but the caller must not pass it for old-side diff
  // lines, which belong to the commit's PARENT, not to it.
  if (inp.rev) out += "@" + inp.rev;
  if (typeof inp.start === "number" && inp.start >= 1) {
    let s = inp.start;
    let e = typeof inp.end === "number" ? inp.end : s;
    if (e < s) { const t = s; s = e; e = t; } // ranges can arrive out of order
    const nums = s === e ? String(s) : s + "-" + e;
    out += ":" + nums;
    // A column belongs to a single line with no quoted text (the text is
    // the anchor then); a range or a snippet never carries one.
    if (s === e && typeof inp.col === "number" && inp.col >= 1 && !inp.text) out += ":" + inp.col;
  }
  // The selection quote: double quotes inside become single (the delimiters
  // must stay unambiguous), trimmed ends, capped with the ellipsis.
  const sel = (inp.text || "").replace(/"/g, "'").trim();
  if (sel) {
    const body = sel.length <= REF_TEXT_MAX ? sel : sel.slice(0, REF_TEXT_MAX).replace(/\s+$/, "") + "…";
    out += ' "' + body + '"';
  }
  return out;
}

// what keeps a mod-row selection clean: the ref quotes ONE side's text.
function diffSelRange(root: HTMLElement, attr: string): { min: number; max: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  let min = Infinity, max = -1;
  const parts: string[] = [];
  const els = root.querySelectorAll<HTMLElement>("[" + attr + "]");
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    const n = Number(el.getAttribute(attr));
    if (!Number.isFinite(n)) continue;
    if (!range.intersectsNode(el)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
    const t = (el.textContent || "").trim();
    if (t) parts.push(t);
  }
  if (max < 0) return null;
  return { min, max, text: parts.join("\n") };
}

type TFunc = (key: string) => string;
type DiffRow = { k: string; text: string; oldNo: number | null; newNo: number | null; noNewline: boolean };
type DiffHunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; rows: DiffRow[] };
type DiffFile = {
  oldPath: string | null; newPath: string | null;
  isNew: boolean; isDeleted: boolean; isBinary: boolean;
  modeFrom: string | null; modeTo: string | null;
  renameFrom: string | null; renameTo: string | null;
  hunks: DiffHunk[];
};
type DisplayRow = { type: string; old: DiffRow | null; nw: DiffRow | null };
// The file's real path. Deleted files carry the /dev/null placeholder in
// newPath (new files carry it in oldPath). Using the placeholder for
// identity or display collides every deleted file (and prints "/dev/null"
// as the name).
function realPathOf(m: DiffFile): string {
  if (m.newPath && m.newPath !== "/dev/null") return m.newPath;
  return m.oldPath && m.oldPath !== "/dev/null" ? m.oldPath : "";
}
type Gap = { old: [number, number] | null; new: [number, number] | null };
type VcsChange = { path: string; status: string; oldPath?: string | null; base?: string };
// The change tree's commit row (host: jj log 8-col TSV / git log --numstat).
// The new columns are optional: a stale listing (or a test fixture) may
// carry the old {id, empty, description} shape and the tree degrades — no
// pills, no date — rather than breaking.
// id = the row's identity (jj: change id, git: short sha); commitId = the
// git form of the same commit (jj only — the agent ref tokens quote both).
type VcsTracking = { name: string; remote: string; ahead: number; behind: number };
type VcsCommit = {
  id: string;
  commitId?: string;
  // jj's significant-prefix split of the id (shortest(8): the unique prefix
  // + the rest, ≥ 8 chars total) — the tree highlights the prefix the way
  // jj's terminal does. Absent on git rows (git has no stable-prefix
  // concept) and on stale listings.
  idPrefix?: string;
  idRest?: string;
  // jj's node character for the row, from its own builtin_log_node template
  // (@ working copy / ◆ immutable / × conflicted / ○ normal). Absent on git
  // rows and stale listings — the tree falls back to ○.
  glyph?: string;
  conflict?: boolean;
  empty?: boolean;
  // jj's root commit (change id all-z) — the log's floor. jj-only (git has no
  // synthetic root); the tree renders it with a localized "root" label in the
  // date slot instead of the root's epoch author date.
  root?: boolean;
  author?: string;
  date?: string;
  // jj's ref strings, exactly as the CLI renders them: a remote ref carries
  // `@remote`, a conflicted ref ends in `??`, an unsynced LOCAL ref ends in
  // `*` (the pill parser strips the sigil; git rows carry plain names).
  bookmarks?: string[];
  tags?: string[];
  // Workspaces whose working copy this commit is (jj's working_copies; the
  // CLI shows the workspace name on that row).
  workspaces?: string[];
  // The CLI's row labels: (hidden) — takes render precedence over
  // (divergent); + the /N change offset shown when either is set (a
  // divergent change id renders as `xyz/0`, `xyz/1`, …).
  hidden?: boolean;
  divergent?: boolean;
  offset?: number;
  // Tracked remote bookmarks' ahead/behind counts (the tooltip data).
  tracking?: VcsTracking[];
  // Parent COMMIT ids (short form) — the graph's edges. Rows key on the
  // commit id (a divergent change has several commits sharing one change
  // id, so the change id alone can't identify a row).
  parents?: string[];
  description: string;
};
// id = the head commit's commit id (jj/git); changeId = the jj worktree's
// change id (absent on git — git's worktree row shows `id`, the HEAD sha);
// idPrefix/idRest = the jj change id's shortest(8) split (absent on git);
// parents = the head's parent change ids (jj) — the graph's edge from the
// working-copy row into the history.
type VcsHead = { id: string; changeId?: string; idPrefix?: string; idRest?: string; parents?: string[]; bookmarks?: string[]; tags?: string[]; workspaces?: string[]; hidden?: boolean; divergent?: boolean; offset?: number; tracking?: VcsTracking[]; description: string; marker?: string };
type VcsInfo = {
  ok: boolean;
  backend?: string;
  head?: VcsHead;
  changes?: VcsChange[];
  conflicts?: string[];
  commits?: VcsCommit[];
  // Failure block (ok === false): the host sends {ok:false, code, message}.
  code?: string;
  message?: string;
};
type DirEntry = { name: string; path: string; isDirectory: boolean; size?: number; mtime?: number };
/** The tick's per-dir slot: a fresh listing, or the dir-level failure the
    list endpoint would have reported (parallel to the request's `dirs`). */
type TickListing = (Listing & { vcs?: VcsInfo }) | { error: string; relPath: string };
type TickResponse = { openFile: "same" | "changed"; list: "same" | { listings: TickListing[] } };
type DiffBinarySide = { kind: string; size?: number; type?: string; label?: string; data?: string };
type DiffBinary = { new: DiffBinarySide | null; old: DiffBinarySide | null };

// The host computes the patch (jj diff --git). This module only parses it.
// Safety contract:
//   - the parser skips unrecognized header lines (never fatal)
//   - the parser trusts no hunk count: line numbers follow the lines
//     actually present, so a patch truncated mid-hunk (the host 1 MB cap)
//     cannot desync them
//   - the parser degrades an unknown line inside a hunk to context (never
//     crash)
//   - the parser reads `---`/`+++` only BEFORE the first hunk: a deleted
//     line whose text starts with `-- ` must stay a del row
function parseDiff(patch: unknown): { files: DiffFile[] } {
  const files: DiffFile[] = [];
  let f: DiffFile | null = null, h: DiffHunk | null = null;
  let oldNo = 0, newNo = 0, lastDel: DiffRow | null = null, lastAdd: DiffRow | null = null;
  const lines = String(patch).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop(); // trailing-newline artifact, not a row
  for (const raw of lines) {
    const line = raw; // keep \r (CRLF files). white-space:pre renders it
    if (line.indexOf("diff --git ") === 0) {
      const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
      f = { oldPath: m ? m[1]! : null, newPath: m ? m[2]! : null, isNew: false, isDeleted: false, isBinary: false, modeFrom: null, modeTo: null, renameFrom: null, renameTo: null, hunks: [] };
      files.push(f); h = null; oldNo = 0; newNo = 0; lastDel = lastAdd = null;
      continue;
    }
    if (f === null) continue; // preamble before the first section
    let m;
    // `diff --git` is authoritative for the paths (clean, no a/ b/ prefix).
    // `---`/`+++` only contribute the /dev/null → new/deleted detection.
    if (h === null && line.indexOf("--- ") === 0) {
      const p = line.slice(4).trim();
      if (p === "/dev/null") { f.isNew = true; f.oldPath = "/dev/null"; }
      continue;
    }
    if (h === null && line.indexOf("+++ ") === 0) {
      const p = line.slice(4).trim();
      if (p === "/dev/null") { f.isDeleted = true; f.newPath = "/dev/null"; }
      continue;
    }
    if ((m = line.match(/^rename from (.+)$/))) { f.renameFrom = m[1]!; continue; }
    if ((m = line.match(/^rename to (.+)$/))) { f.renameTo = m[1]!; continue; }
    if ((m = line.match(/^new file mode (\S+)$/))) { f.isNew = true; f.modeTo = m[1]!; continue; }
    if ((m = line.match(/^deleted file mode (\S+)$/))) { f.isDeleted = true; f.modeFrom = m[1]!; continue; }
    if ((m = line.match(/^old mode (\S+)$/))) { f.modeFrom = m[1]!; continue; }
    if ((m = line.match(/^new mode (\S+)$/))) { f.modeTo = m[1]!; continue; }
    if (line.indexOf("Binary files ") === 0) { f.isBinary = true; continue; }
    if (line.charAt(0) === "@" && (m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/))) {
      h = { oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]),
            newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]), rows: [] };
      f.hunks.push(h);
      oldNo = h.oldStart; newNo = h.newStart; lastDel = lastAdd = null;
      continue;
    }
    if (h !== null) {
      const c = line.charAt(0);
      if (c === "\\") { if (lastDel) lastDel.noNewline = true; else if (lastAdd) lastAdd.noNewline = true; continue; }
      if (c === "+") { const row: DiffRow = { k: "add", text: line.slice(1), oldNo: null, newNo: newNo++, noNewline: false }; h.rows.push(row); lastAdd = row; lastDel = null; continue; }
      if (c === "-") { const row: DiffRow = { k: "del", text: line.slice(1), oldNo: oldNo++, newNo: null, noNewline: false }; h.rows.push(row); lastDel = row; lastAdd = null; continue; }
      const row: DiffRow = { k: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++, noNewline: false };
      h.rows.push(row); lastDel = lastAdd = null;
    }
    // outside a hunk: unrecognized header line → skip (contract)
  }
  return { files };
}

// The line ranges the patch omits between hunk i and i+1, per side (null
// when the patch omits nothing). Zero-count hunks anchor at a phantom line
// 0, so the code clamps the end to 1.
function gapAfter(prev: DiffHunk | null, next: DiffHunk | null): Gap | null {
  if (!prev || !next) return null;
  const oldEnd = Math.max(prev.oldStart + prev.oldCount, 1);
  const newEnd = Math.max(prev.newStart + prev.newCount, 1);
  const oldRange: [number, number] | null = next.oldStart > oldEnd ? [oldEnd, next.oldStart - 1] : null;
  const newRange: [number, number] | null = next.newStart > newEnd ? [newEnd, next.newStart - 1] : null;
  return oldRange || newRange ? { old: oldRange, new: newRange } : null;
}

// Pair each contiguous del run with the contiguous add run that FOLLOWS it,
// in order, up to the shorter (surplus rows keep a blank opposite cell).
// In-order pairing prevents the `-a -b +c` mis-pair.
function displayRows(hunk: DiffHunk): DisplayRow[] {
  const out: DisplayRow[] = [];
  let i = 0;
  while (i < hunk.rows.length) {
    const r = hunk.rows[i]!;
    if (r.k === "ctx") { out.push({ type: "ctx", old: r, nw: null }); i++; continue; }
    const dels: DiffRow[] = [];
    while (i < hunk.rows.length && hunk.rows[i]!.k === "del") { dels.push(hunk.rows[i]!); i++; }
    const adds: DiffRow[] = [];
    while (i < hunk.rows.length && hunk.rows[i]!.k === "add") { adds.push(hunk.rows[i]!); i++; }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) out.push({ type: "mod", old: dels[p]!, nw: adds[p]! });
    for (let p = pairs; p < dels.length; p++) out.push({ type: "del", old: dels[p]!, nw: null });
    for (let p = pairs; p < adds.length; p++) out.push({ type: "add", old: null, nw: adds[p]! });
  }
  return out;
}

// The change tree's node glyph — character and tone, both taken from jj's
// own log: the row's node character is jj's log glyph, supplied by the host (its
// builtin_log_node template: @ working copy, ◆ immutable, × conflicted,
// ○ normal — the CLI's characters, rendered as text). The worktree row's
// glyph is fixed (jj: @, git: ○); git rows and stale listings fall back to
// ○. Styled after jj's node label colors: @ accent + bold, ◆ bold, × red +
// bold, ○ dim. A pure decision so the mapping is pinned by tests.
type GlyphTone = "wc" | "immutable" | "conflict" | "normal";
function glyphTone(glyph: string): GlyphTone {
  if (glyph === "@") return "wc";
  if (glyph === "◆") return "immutable";
  if (glyph === "×") return "conflict";
  return "normal";
}
function changeGlyph(glyph: string): React.ReactElement {
  return <span className={"dswFiles_changeGlyph dswFiles_changeGlyph_" + glyphTone(glyph)} aria-hidden="true">{glyph}</span>;
}
// The row's ref pills, capped: bookmarks first (jj bookmarks / git branch
// tips), then tags, then workspace names, at most `cap` shown with a "+N"
// fold. Pure (the element mapping stays in the render) so the cap math +
// sigil parsing are testable.
type RefPill = { name: string; remote?: string; sigil?: "*" | "??"; kind: "bookmark" | "tag" | "workspace" };
// jj renders each CommitRef as `name` + `@remote` (if a remote ref) +
// `??` (the ref's target is conflicted) or `*` (a LOCAL ref whose target
// differs from its tracked remote). Split that back: strip the trailing
// sigil, then break at the LAST `@` (git ref names may contain `@` — the
// remote segment is always last, like jj's own rendering).
function parseRefString(s: string): { name: string; remote?: string; sigil?: "*" | "??" } {
  let rest = s;
  let sigil: "*" | "??" | undefined;
  if (s.endsWith("??")) { sigil = "??"; rest = s.slice(0, -2); }
  else if (s.endsWith("*")) { sigil = "*"; rest = s.slice(0, -1); }
  const at = rest.lastIndexOf("@");
  const base = at >= 0 ? { name: rest.slice(0, at), remote: rest.slice(at + 1) } : { name: rest };
  return sigil ? { ...base, sigil } : base;
}
function refPillList(refs: { bookmarks?: string[]; tags?: string[]; workspaces?: string[] }, cap: number): RefPill[] {
  const all = [...(refs.bookmarks ?? []).map((s) => ({ ...parseRefString(s), kind: "bookmark" as const })),
    ...(refs.tags ?? []).map((s) => ({ ...parseRefString(s), kind: "tag" as const })),
    ...(refs.workspaces ?? []).map((s) => ({ ...parseRefString(s), kind: "workspace" as const }))];
  return all.slice(0, Math.max(0, cap));
}
function refPillCount(refs: { bookmarks?: string[]; tags?: string[]; workspaces?: string[] }): number {
  return (refs.bookmarks ?? []).length + (refs.tags ?? []).length + (refs.workspaces ?? []).length;
}
// Relative time for a VCS author date. jj emits LOCAL ISO without an offset
// (jj templates have no UTC mode); git's %aI carries the offset. Both parse
// via the platform Date (the offset-less one as the host's local time, which
// is what jj meant). Beyond a week — or unparseable/clock-skewed — the
// calendar date, matching formatAge's fallback.
function whenOf(dateIso: string | null | undefined, t: TFunc): string {
  if (!dateIso) return "";
  const time = new Date(dateIso).getTime();
  if (!Number.isFinite(time)) return dateIso;
  const age = Date.now() - time;
  if (age < 0 || age >= 7 * 86_400_000) return new Date(time).toLocaleDateString();
  if (age < 60_000) return t("files.ageNow");
  const min = Math.floor(age / 60_000);
  if (min < 60) return t("files.ageMin").replace("{n}", String(min));
  const h = Math.floor(min / 60);
  if (h < 24) return t("files.ageHour").replace("{n}", String(h));
  return t("files.ageDay").replace("{n}", String(Math.floor(h / 24)));
}

// The official file viewer's resource address for a session file (dsh's
// `dsh-resource://file/session/<sid>/<path>` grammar: every `/`-segment
// encodeURIComponent'd, drive-letter colons kept literal, backslashes
// normalized, a leading `./` dropped).
function sessionFileAddress(sessionId: string, path: string): string {
  const seg = (s: string) => encodeURIComponent(s).replace(/%3A/gi, ":");
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return "dsh-resource://file/session/" + seg(sessionId) + "/" + normalized.split("/").map(seg).join("/");
}

// Split a path for display (the header's root path): the directories through
// the last separator, and the final segment. A separator-only or empty path
// is all name. Both `/` and `\` separate.
function pathPartsOf(path: string): { directory: string; name: string } {
  const trimmed = path.replace(/[/\\]+$/, "");
  if (trimmed === "") return { directory: "", name: path };
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1;
  return { directory: trimmed.slice(0, cut), name: trimmed.slice(cut) };
}

// Per-session view state (localStorage): a refresh resets component state
// (the tab ring only restores the active tab), so FilesView restores its
// own selection + pane layout. The read and write are best-effort and never
// throw (SSR, privacy mode).
const STATE_KEY = (sid: string): string => "changestab/files/" + sid;
type SavedState = {
  /** The selected changed file (workspace relPath). */
  selected: string | null;
  navW: number | null;
  /** The reviewed change id (null = the working copy). */
  rev: string | null;
  collapsed: boolean;
  /** The change-log pane's height (px) in the split nav; null = default. */
  treeH: number | null;
};
/** The root's relPath. */
const ROOT_PATH = "";
function loadState(sessionId: string | null): SavedState | null {
  try {
    if (typeof localStorage === "undefined" || !sessionId) return null;
    const raw = localStorage.getItem(STATE_KEY(sessionId));
    if (!raw) return null;
    const s = JSON.parse(raw) as Record<string, unknown>;
    return {
      selected: typeof s.selected === "string" ? s.selected : null,
      navW: typeof s.navW === "number" ? s.navW : null,
      rev: typeof s.rev === "string" ? s.rev : null,
      collapsed: s.collapsed === true,
      // The 5th field (treeH) landed after the 4-field shape; older saved
      // state simply lacks it → the default height.
      treeH: typeof s.treeH === "number" ? s.treeH : null,
    };
  } catch (e) { return null; }
}
function saveState(
  sessionId: string | null, selected: string | null, navW: number | null,
  rev: string | null, collapsed: boolean, treeH: number | null,
): void {
  try {
    if (typeof localStorage === "undefined" || !sessionId) return;
    localStorage.setItem(STATE_KEY(sessionId), JSON.stringify({
      selected: selected || null,
      navW: typeof navW === "number" ? Math.round(navW) : null,
      rev: rev || null,
      collapsed: collapsed === true,
      treeH: typeof treeH === "number" ? Math.round(treeH) : null,
    }));
  } catch (e) { /* storage full / privacy mode, best-effort */ }
}
const MAX_DIFF_ROWS = 5000; // client render cap (the host caps patch BYTES)

const NN = () => <span className="dswFiles_diffNN" aria-hidden="true">⏎</span>;
function diffSide(row: DiffRow | null): string | [string, React.ReactElement] {
  if (!row) return "";
  return row.noNewline ? [row.text, <NN key="nn" />] : row.text;
}
// Intra-line diff (BUG-003, reworked per BUG-010 after checking how the
// established renderers do it):
//   - git's xdiff word-diff: the alignment runs over WORD tokens only
//     ([[:isalnum:]]+); a changed span is ONE contiguous stretch of the
//     original line from the first to the last changed word, so the
//     whitespace BETWEEN changed words is part of the span (verified on a
//     real change: git renders `{+-rotate 90+}` — the inner space rides in).
//     A whitespace-ONLY change shows no marker at all.
//   - diff-highlight (diff-so-fancy, the ancestor of GitHub's intra-line
//     highlight): common prefix/suffix, then ONE contiguous span per side
//     covering everything in between — plus an "interesting" gate: skip the
//     intra-line highlight when the changed region is the whole line
//     ("otherwise the highlighting is just useless noise").
//   - jsdiff's diffWords (documented): "each word and each punctuation mark
//     as a token. Whitespace is ignored when computing the diff (but
//     preserved as far as possible in the final change objects)."
// All three agree: a changed region is contiguous and its internal
// whitespace is highlighted with it; none post-processes the alignment to
// un-highlight changed whitespace. (The old BUG-004 rule did exactly that
// and is what made a changed space look unchanged — BUG-010.)
// Tokens here: word runs [A-Za-z0-9_]+ plus single punctuation (jsdiff's
// "word and each punctuation mark", with underscore/digits kept in the word
// so identifiers stay whole). null = no intra-line emphasis (identical
// lines, whitespace-only change, a token table too big for the quadratic
// pass, or a line pair too dissimilar for the spans to help — the gate
// below, the same family as diff-highlight's "interesting" rule; the row
// tint is enough in all four cases).
type IntraSeg = { text: string; cls: "same" | "del" | "add" };
type IntraDiff = { old: IntraSeg[]; nw: IntraSeg[] };
const INTRA_TOKENS = /[A-Za-z0-9_]+|\s+|\S/g;
// Similarity gate: at least this fraction of the SHORTER line's word tokens
// must be shared (in order, the LCS), or the mod row falls back to the plain
// row tint. A heavily rewritten line is a whole-line change — a span would
// cover the line and read as noise (diff-highlight's "interesting" gate is
// the coarse form of this: it highlights only when a non-whitespace prefix
// OR suffix survives).
const INTRA_MIN_SHARED_FRACTION = 0.5;
type IntraTok = { text: string; start: number; end: number };
function intraTokenize(text: string): IntraTok[] {
  const out: IntraTok[] = [];
  INTRA_TOKENS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INTRA_TOKENS.exec(text))) out.push({ text: m[0]!, start: m.index, end: m.index + m[0]!.length });
  return out;
}
function intraTokens(text: string): string[] {
  return intraTokenize(text).map((t) => t.text);
}
function intraLineDiff(oldText: string, newText: string): IntraDiff | null {
  if (oldText === newText) return null;
  // The alignment sees ONLY non-whitespace tokens. A whitespace run never
  // matches a whitespace run at another position (that skew is what let the
  // old alignment pair the wrong dashes and break a changed phrase into
  // word islands), and a whitespace-only change yields no changed tokens →
  // no span (git shows no word-diff marker for it either; the row tint
  // marks the line).
  const a = intraTokenize(oldText).filter((t) => !/^\s+$/.test(t.text));
  const b = intraTokenize(newText).filter((t) => !/^\s+$/.test(t.text));
  if (a.length * b.length > 100000) return null; // keep the O(n·m) pass cheap
  const n = a.length, m = b.length, w = m + 1;
  const tab: number[][] = new Array(n + 1);
  for (let i = 0; i <= n; i++) tab[i] = new Array<number>(w).fill(0);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      tab[i]![j] = a[i]!.text === b[j]!.text ? tab[i + 1]![j + 1]! + 1 : Math.max(tab[i + 1]![j]!, tab[i]![j + 1]!);
  // Legibility gate: the LCS length is tab[0][0]. Fewer than half the
  // shorter line's word tokens are shared → a whole-line rewrite in effect.
  if (tab[0]![0]! * 2 < Math.min(n, m)) return null;
  // Backtrack to the matched flags. On a TIE, prefer skipping the NEW token
  // (the add): the old token stays free to match at its own position, so a
  // word that merely shifted right stays "same" instead of being flagged
  // deleted (the alignment that keeps the most recognizable tokens shared).
  const matchedA: boolean[] = new Array<boolean>(n).fill(false);
  const matchedB: boolean[] = new Array<boolean>(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) { matchedA[i] = true; matchedB[j] = true; i++; j++; }
    else if (tab[i]![j + 1]! >= tab[i + 1]![j]!) j++;
    else i++;
  }
  if (matchedA.every(Boolean) && matchedB.every(Boolean)) return null; // whitespace-only change
  // Segments: a maximal run of consecutive UNMATCHED word tokens (consecutive
  // = no matched word token between them — whitespace in between never
  // breaks a run) becomes ONE span whose text is the original line VERBATIM
  // from the run's first token to its last: the whitespace inside the run is
  // part of the change and renders with it. Boundary whitespace (before the
  // first / after the last changed token) stays plain context, exactly as in
  // git's `{+-rotate 90+}` rendering.
  const build = (line: string, toks: IntraTok[], matched: boolean[], cls: "del" | "add"): IntraSeg[] => {
    const segs: IntraSeg[] = [];
    const push = (c: IntraSeg["cls"], text: string): void => {
      if (text === "") return;
      const last = segs[segs.length - 1];
      if (last && last.cls === c) last.text += text;
      else segs.push({ text, cls: c });
    };
    let cur = 0;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]!;
      if (matched[k]!) { push("same", line.slice(cur, t.end)); cur = t.end; continue; }
      let e = k;
      while (e + 1 < toks.length && !matched[e + 1]!) e++;
      push("same", line.slice(cur, t.start));
      push(cls, line.slice(t.start, toks[e]!.end));
      cur = toks[e]!.end;
      k = e;
    }
    push("same", line.slice(cur));
    return segs;
  };
  return { old: build(oldText, a, matchedA, "del"), nw: build(newText, b, matchedB, "add") };
}
// One side of a mod row: unchanged tokens stay plain text (the row tint
// shows through), changed tokens get the stronger span class. The no-newline
// marker rides at the end of the line, as in diffSide.
function modSideContent(segs: IntraSeg[], spanCls: string, keyBase: string, noNewline: boolean): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    out.push(s.cls === "same" ? s.text : <span key={keyBase + i} className={spanCls}>{s.text}</span>);
  }
  if (noNewline) out.push(<NN key={keyBase + "nn"} />);
  return out;
}
function sideBySideCells(d: DisplayRow, key: number): React.ReactElement[] {
  // data-dl/data-dn carry the real file line numbers on the cells AND the
  // gutters, so a selection OR a right-click anywhere on the row resolves to
  // the line(s) the ref should point at.
  const noOld = <span key={key + "no"} className={"dswFiles_diffNo" + (d.type === "del" || d.type === "mod" ? " dswFiles_diffNoDel" : "")} data-dl={d.old && d.old.oldNo != null ? d.old.oldNo : undefined}>{d.old ? d.old.oldNo : ""}</span>;
  const intra = d.type === "mod" && d.old && d.nw ? intraLineDiff(d.old.text, d.nw.text) : null;
  const cellOld = (
    <span key={key + "co"} className={"dswFiles_diffCell" + (d.type === "ctx" ? "" : d.type === "add" ? " dswFiles_cellAddO" : " dswFiles_cellDelO")}
      data-dl={d.old && d.old.oldNo != null ? d.old.oldNo : undefined}>
      <span className="dswFiles_diffCellIn">{intra ? modSideContent(intra.old, "dswFiles_spanDel", key + "o", d.old!.noNewline) : diffSide(d.old)}</span>
    </span>
  );
  const noNw = <span key={key + "nw"} className={"dswFiles_diffNo" + (d.type === "add" || d.type === "mod" ? " dswFiles_diffNoAdd" : "")} data-dn={d.nw && d.nw.newNo != null ? d.nw.newNo : undefined}>{d.nw ? d.nw.newNo : ""}</span>;
  const cellNw = (
    <span key={key + "cn"} className={"dswFiles_diffCell" + (d.type === "ctx" ? "" : d.type === "del" ? " dswFiles_cellDelN" : " dswFiles_cellAddN")}
      data-dn={d.nw && d.nw.newNo != null ? d.nw.newNo : undefined}>
      <span className="dswFiles_diffCellIn">{intra ? modSideContent(intra.nw, "dswFiles_spanAdd", key + "n", d.nw!.noNewline) : diffSide(d.nw)}</span>
    </span>
  );
  return [noOld, cellOld, noNw, cellNw];
}
function gapCells(gap: Gap, key: number): React.ReactElement[] {
  const txt = (rg: [number, number] | null) => (rg ? "… " + rg[0] + "–" + rg[1] + " …" : "");
  return [
    <span key={key + "no"} className="dswFiles_diffNo dswFiles_diffGapCell" />,
    <span key={key + "o"} className="dswFiles_diffGapTxt">{txt(gap.old)}</span>,
    <span key={key + "nw"} className="dswFiles_diffNo dswFiles_diffGapCell" />,
    <span key={key + "n"} className="dswFiles_diffGapTxt">{txt(gap.new)}</span>,
  ];
}
function gapCellsU(gap: Gap, key: number): React.ReactElement[] {
  const txt = (rg: [number, number] | null) => (rg ? "… " + rg[0] + "–" + rg[1] + " …" : "");
  return [
    <span key={key + "no"} className="dswFiles_diffNo dswFiles_diffGapCell" />,
    <span key={key + "c"} className="dswFiles_diffGapTxt dswFiles_diffGapCell">{txt(gap.new || gap.old)}</span>,
  ];
}
// The mod pairing for the unified (narrow) view: which del row pairs with
// which add row — the same in-order pairing displayRows uses for the
// side-by-side view. Raw row order is kept (del run before add run); the
// pairing only supplies the opposite line for the intra-line spans.
function unifiedPairs(hunk: DiffHunk): Map<DiffRow, { other: DiffRow; side: "old" | "new" }> {
  const map = new Map<DiffRow, { other: DiffRow; side: "old" | "new" }>();
  let i = 0;
  while (i < hunk.rows.length) {
    if (hunk.rows[i]!.k === "ctx") { i++; continue; }
    const dels: DiffRow[] = [], adds: DiffRow[] = [];
    while (i < hunk.rows.length && hunk.rows[i]!.k === "del") { dels.push(hunk.rows[i]!); i++; }
    while (i < hunk.rows.length && hunk.rows[i]!.k === "add") { adds.push(hunk.rows[i]!); i++; }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) {
      map.set(dels[p]!, { other: adds[p]!, side: "old" });
      map.set(adds[p]!, { other: dels[p]!, side: "new" });
    }
  }
  return map;
}
function unifiedCells(r: DiffRow, key: number, pair?: { other: DiffRow; side: "old" | "new" }): React.ReactElement[] {
  // Gutter carries the same numbers as the cell so a right-click on the line
  // NUMBER resolves to a ref, not just a right-click on the line content.
  const no = <span key={key + "no"} className={"dswFiles_diffNo" + (r.k === "del" ? " dswFiles_diffNoDel" : r.k === "add" ? " dswFiles_diffNoAdd" : "")}
    data-dl={r.k !== "add" && r.oldNo != null ? r.oldNo : undefined}
    data-dn={r.k !== "del" && r.newNo != null ? r.newNo : undefined}>{r.k === "add" ? r.newNo : r.oldNo}</span>;
  // The +/−/space marker sits INSIDE the cell in the unified view (unlike
  // side-by-side), so it is a span: the context menu's snippet excludes it.
  const marker = <span key={key + "mk"} className="dswFiles_diffMark" aria-hidden="true">{r.k === "ctx" ? " " : r.k === "add" ? "+" : "-"}</span>;
  let content: React.ReactNode = [marker, r.text];
  let nnInside = false;
  if (pair) {
    const intra = intraLineDiff(pair.side === "old" ? r.text : pair.other.text, pair.side === "old" ? pair.other.text : r.text);
    if (intra) {
      const isOld = pair.side === "old";
      content = [marker, ...modSideContent(isOld ? intra.old : intra.nw, isOld ? "dswFiles_spanDel" : "dswFiles_spanAdd", key + "u", r.noNewline)];
      nnInside = true;
    }
  }
  // Unified view: a "del" row carries only the old number, an "add" row only
  // the new number, a "ctx" row both (the ref prefers the new side).
  const cell = (
    <span key={key + "c"} className={"dswFiles_diffCell" + (r.k === "add" ? " dswFiles_cellAddN" : r.k === "del" ? " dswFiles_cellDelO" : "")}
      data-dl={r.k !== "add" && r.oldNo != null ? r.oldNo : undefined}
      data-dn={r.k !== "del" && r.newNo != null ? r.newNo : undefined}>
      <span className="dswFiles_diffCellIn">{content}{!nnInside && r.noNewline ? <NN /> : null}</span>
    </span>
  );
  return [no, cell];
}

// The two 44px number gutters of the split grid (the
// grid-template-columns of .dswFiles_diffGrid) — keep in sync with Files.css.
const DIFF_GUTTER_PX = 44;
// The file width the layout decision uses, in columns — FIXED, not the
// file's actual line width: a file whose lines run wider than a split side
// scrolls horizontally within that side, so measuring the real width would
// keep the view unified no matter how wide the pane gets. The fixed
// reference makes the cutoff predictable: side-by-side once each side can
// show DIFF_LAYOUT_FRACTION_PCT of it (≈66 columns) at the pane's font.
const DIFF_LAYOUT_COLS = 100;
// The fraction of the reference width each split side must be able to show
// for side-by-side to be worth it (0.66, in percent — integer math keeps
// the boundary exact where 0.66 would float).
const DIFF_LAYOUT_FRACTION_PCT = 66;
// Unified or side-by-side? The split grid shows (paneW - 2 gutters) / 2 of
// the reference file width on each side. Unified wins when that is LESS
// than the fraction of it — i.e. `100×(paneW - 2 gutters) < 2×66×fileW`.
function diffLayoutNarrow(paneW: number, fileW: number): boolean {
  if (paneW <= 0) return true;
  return 100 * (paneW - 2 * DIFF_GUTTER_PX) < 2 * DIFF_LAYOUT_FRACTION_PCT * fileW;
}
// The reference file width in px: DIFF_LAYOUT_COLS columns at the grid's
// own font (monospace, so the column width comes from any single glyph).
function diffLayoutFileWidth(grid: HTMLElement): number {
  const first = grid.querySelector(".dswFiles_diffCellIn");
  if (!first) return 0;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = getComputedStyle(first).font;
  return Math.ceil(ctx.measureText("0".repeat(DIFF_LAYOUT_COLS)).width);
}

interface DiffViewProps {
  model: DiffFile;
  truncated?: boolean;
  t: TFunc;
  baseLabel: string | null;
  binary: DiffBinary | null;
}
function DiffView(props: DiffViewProps) {
  const t = props.t;
  const model = props.model;
  const ref = React.useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = React.useState(false);
  // Unified or side-by-side is decided from PANE WIDTH against a fixed
  // 100-column file reference (the spacer's measure below sets it from
  // diffLayoutNarrow): unified when a split side would show less than
  // 66% of it (≈66 columns). False until the first measurement, so the
  // first paint is side-by-side.
  const cueRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current, cue = cueRef.current;
    if (!el || !cue) return;
    const update = () => {
      cue.classList.toggle("dswFiles_diffCueOn",
        el.scrollWidth > el.clientWidth + 1 && el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(update); ro.observe(el); }
    el.addEventListener("scroll", update, { passive: true });
    return () => { if (ro) ro.disconnect(); el.removeEventListener("scroll", update); };
  }, []);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const spacerRef = React.useRef<HTMLDivElement>(null);
  // The code resets scroll only when the file or review base changes. A
  // tick that changed the listing refreshes the same view with a fresh
  // model object (the reader is mid-diff). A reset keyed on model identity
  // yanks the view to the top on every such refresh.
  const fileKey = (props.baseLabel ? props.baseLabel + "\u0000" : "") + realPathOf(model);
  const lastFileRef = React.useRef(fileKey);
  React.useEffect(() => {
    if (lastFileRef.current === fileKey) return;
    lastFileRef.current = fileKey;
    const el = ref.current, grid = gridRef.current;
    if (!el || !grid) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    grid.style.setProperty("--diff-x", "0px");
  }, [fileKey]);
  // The effect sizes the zero-height spacer to provide the horizontal scroll
  // RANGE. The grid itself never overflows (100% wide, the cells clip), so
  // this effect synthesizes the range: `clientW + (maxW - windowW)`, maxW =
  // widest rendered cell, windowW = its clipping window
  // (scrollWidth/clientWidth). maxW alone under-provisions a line wider than
  // its half but shorter than the container.
  React.useEffect(() => {
    const el = ref.current, grid = gridRef.current, spacer = spacerRef.current;
    if (!el || !grid || !spacer) return;
    const measure = () => {
      const clientW = el.clientWidth;
      if (clientW <= 0) return;
      let maxW = 0;
      const inners = grid.querySelectorAll(".dswFiles_diffCellIn");
      for (let i = 0; i < inners.length; i++) {
        const w = inners[i]!.scrollWidth;
        if (w > maxW) maxW = w;
      }
      const windowW = inners.length ? inners[0]!.clientWidth : 0;
      const over = maxW - windowW;
      spacer.style.width = (over > 0 ? clientW + Math.ceil(over) : clientW) + "px";
      // Layout decision from the fixed 100-column reference at this font
      // (see diffLayoutFileWidth). setNarrow is a no-op on an unchanged
      // value; the effect's [model, narrow] deps re-measure after any flip.
      setNarrow(diffLayoutNarrow(clientW, diffLayoutFileWidth(grid)));
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(measure); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, [model, narrow]);
  React.useEffect(() => {
    const el = ref.current, grid = gridRef.current;
    if (!el || !grid) return;
    const onScroll = () => grid.style.setProperty("--diff-x", (-el.scrollLeft) + "px");
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const cue = <div className="dswFiles_diffCue" ref={cueRef} aria-hidden="true" />;

  const name = realPathOf(model);
  const meta: string[] = [];
  // The review-commit tag (commit mode): this patch is the file's state at
  // that commit, not the worktree's.
  if (props.baseLabel) meta.push(props.baseLabel);
  if (model.isNew) meta.push(t("files.diffNew"));
  if (model.isDeleted) meta.push(t("files.diffDeleted"));
  if (model.renameFrom && model.renameFrom !== model.newPath) meta.push(t("files.diffRenamedFrom") + " " + model.renameFrom);
  if (model.modeFrom && model.modeTo && model.modeFrom !== model.modeTo) meta.push(model.modeFrom + " → " + model.modeTo);
  // The file's name lives in the pane's general header (PreviewPane); this
  // sticky head keeps only the diff-specific meta and vanishes without it.
  const head = meta.length
    ? <div className="dswFiles_diffHead">
        <div className="dswFiles_diffMeta">{meta.join(" · ")}</div>
      </div>
    : null;

  // A binary patch has no text rows. A side that came back WITH its bytes
  // (a displayable image/PDF) renders old|new like the text split. The
  // absent side (a new or deleted file) gets a "(none)" slot. A side
  // without bytes (over the cap, not displayable) shows its card meta.
  // jj's rename diff has no "Binary files" marker (isBinary stays false),
  // so an attached binary block switches the view to the image row too.
  const b = props.binary || null;
  const binHasData = !!(b && ((b.new && b.new.data) || (b.old && b.old.data)));
  if (model.isBinary || b) {
    const side = (v: DiffBinarySide | null, label: string) => {
      const bytes = v && v.data && v.type ? "data:" + v.type + ";base64," + v.data : null;
      return (
        <div className="dswFiles_diffBinaryPane">
          <div className="dswFiles_diffBinaryLabel">{label}</div>
          {bytes
            ? <div className="dswFiles_previewImageWrap"><img className="dswFiles_previewImage" src={bytes} alt={name} /></div>
            : <div className="dswFiles_diffBinaryNone">{v ? [typeLabel(v.type, t), v.size ? formatBytes(v.size) : null].filter(Boolean).join(" · ") : t("files.diffBinaryNone")}</div>}
        </div>
      );
    };
    if (!binHasData) {
      return (
        <div className="dswFiles_diff" ref={ref}>
          {head}
          <div className="dswFiles_previewCard">
            <div className="dswFiles_previewCardName">{name}</div>
            <div className="dswFiles_previewCardMeta">{t("files.diffBinary")}</div>
          </div>
          {cue}
        </div>
      );
    }
    return (
      <div className="dswFiles_diff" ref={ref}>
        {head}
        <div className="dswFiles_diffBinaryRow">
          {side(b.old, t("files.diffBinaryOld"))}
          {side(b.new, t("files.diffBinaryNew"))}
        </div>
        {cue}
      </div>
    );
  }

  const flat: { kind: "gap" | "row"; gap: Gap; r: DiffRow; d: DisplayRow; pair: { other: DiffRow; side: "old" | "new" } | null }[] = [];
  for (let hi = 0; hi < model.hunks.length; hi++) {
    const h = model.hunks[hi]!;
    if (hi > 0) { const g = gapAfter(model.hunks[hi - 1]!, h); if (g) flat.push({ kind: "gap", gap: g, r: h as unknown as DiffRow, d: h as unknown as DisplayRow, pair: null }); }
    if (narrow) {
      const pairs = unifiedPairs(h);
      for (const r of h.rows) flat.push({ kind: "row", gap: null as unknown as Gap, r: r, d: h as unknown as DisplayRow, pair: pairs.get(r) ?? null });
    }
    else { for (const d of displayRows(h)) flat.push({ kind: "row", gap: null as unknown as Gap, r: d as unknown as DiffRow, d: d, pair: null }); }
  }
  const clipped = flat.length > MAX_DIFF_ROWS;
  const cells: React.ReactElement[] = [];
  for (let i = 0; i < flat.length && i < MAX_DIFF_ROWS; i++) {
    const item = flat[i]!;
    if (item.kind === "gap") cells.push(...(narrow ? gapCellsU(item.gap, i) : gapCells(item.gap, i)));
    else cells.push(...(narrow ? unifiedCells(item.r, i, item.pair ?? undefined) : sideBySideCells(item.d, i)));
  }
  const notes: string[] = [];
  if (props.truncated) notes.push(t("files.diffTruncatedPatch"));
  if (clipped) notes.push(t("files.diffTruncatedRows"));

  return (
    <div className="dswFiles_diff" ref={ref}>
      {head}
      {cells.length
        ? <div ref={gridRef} className={narrow ? "dswFiles_diffGrid dswFiles_diffGridU" : "dswFiles_diffGrid"}>{cells}</div>
        : <div className="dswFiles_previewNote">{t("files.noChanges")}</div>}
      {/* Zero-height spacer that provides the horizontal scroll range
          (width = widest line, the spacer sizing effect sets it). The grid
          and head stick to the left edge while the user traverses it. */}
      {cells.length ? <div ref={spacerRef} className="dswFiles_diffSpacer" aria-hidden="true" /> : null}
      {notes.length ? <div className="dswFiles_previewNote">{notes.join(" · ")}</div> : null}
      {cue}
    </div>
  );
}


// Clipboard write with the classic fallback (execCommand) for contexts
// where the async clipboard API is unavailable or denied.
function copyRefText(text: string): void {
  const fallback = (): void => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch (e) { /* best-effort */ }
  };
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
    return;
  }
  fallback();
}

// Appends the ref to the composer draft. It subscribes to the live draft
// through the session kit (useInput) so keystrokes in the composer re-render
// this tiny leaf only, never the file panes. The trailing space lets the
// user keep typing; a leading space is inserted only when the draft does not
// already end in whitespace.
// The COMMIT of a ref into the chat, as one action:
//   1. DEDUPE — a click that would append what the draft already ends with
//      is a no-op (a double-click is not a double-insert).
//   2. APPEND — a separating space when the draft doesn't already end in
//      whitespace, and the TRAILING space is functional: every editor commit
//      runs dsh's input triggers, and the space keeps the @-completion menu
//      from opening on the inserted token.
//   3. FOCUS — fullscreen: the right bar IS the window and the composer is
//      mounted but covered, so the window goes back through the host's own
//      exit control first (the layout face is a report seat and cannot drive
//      the mode), then the composer takes the caret. `setDraft` already put
//      it after the insertion (its selectEnd), the focus makes it visible.
function commitRefToChat(draft: string, refText: string, setDraft: (text: string) => void): void {
  const insertion = refText + " ";
  if (draft.endsWith(insertion)) return; // already there
  const sep = draft && !/\s$/.test(draft) ? " " : "";
  if (typeof document !== "undefined") {
    const exit = document.querySelector('[data-sidebar-right-panel="fullscreen"] [data-sidebar-right-mode="push"]');
    if (exit instanceof HTMLElement) exit.click();
  }
  setDraft(draft + sep + insertion);
  if (typeof document !== "undefined") {
    const composer = document.querySelector("[data-composer-input]");
    if (composer instanceof HTMLElement) composer.focus();
  }
}

function AddToChatBtn(props: {
  refText: string;
  useInput: ((sel: (s: { draft: string }) => string) => string) | null;
  inputActions: { setDraft(text: string): void };
  t: TFunc;
  /** Row styling (the head row's icon cluster). */
  className?: string;
  /** Icon-only (the head row): the tooltip/aria-label carries the label. */
  iconOnly?: boolean;
}): React.ReactElement {
  const { t } = props;
  const draft = props.useInput ? props.useInput((s) => s.draft) : "";
  const onClick = () => { commitRefToChat(draft, props.refText, (text) => props.inputActions.setDraft(text)); };
  return (
    <button type="button" className={props.className || "dswFiles_refBtn"}
      title={t("files.refAdd")} aria-label={t("files.refAdd")}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {Icon("IconPlus16", { size: 14 }, "+")}{props.iconOnly ? null : " " + t("files.refAdd")}
    </button>
  );
}

type DiffResponse = { patch: string; truncated?: boolean; base: string; binary?: DiffBinary };
type Listing = {
  root: string;
  relPath: string;
  entries: DirEntry[];
  /** The host capped the listing (DEFAULT_LIST_CAP entries). */
  truncated?: boolean;
  vcs?: VcsInfo;
  commitChanges?: VcsChange[];
};

type DiffState = {
  status: string;
  for?: string | null;
  base?: string;
  file?: DiffFile | null;
  truncated?: boolean;
  binary?: DiffBinary | null;
  error?: string;
};

interface PreviewPaneProps {
  name: string | null;
  relPath: string | null;
  status: VcsChange | null;
  base: string;
  fetchDiff: (relPath: string, base: string, signal: AbortSignal, opts?: { noBinary?: boolean }) => Promise<DiffResponse>;
  t: TFunc;
  /**
   * Session standard kit (composer): the live-draft selector hook and the
   * public draft write path. Absent in a minimal profile — the section-ref
   * affordance then degrades to copy-only (the copy buttons always work).
   */
  useInput?: ((sel: (s: { draft: string }) => string) => string) | null;
  inputActions?: { setDraft(text: string): void } | null;
  /** The "Open in Files" handoff: opens THIS file in the official file
      viewer. null = no host tab actions (pre-0.1.5 surface) — the button
      degrades away. */
  openInFiles?: ((path: string) => void) | null;
  /** The nav column's collapsed state and toggle: the state-pair's RESTORE
      control lives in this pane's top row (right end) while the nav is
      hidden; the HIDE control lives in the nav's own header. Both flip
      FilesView's collapsed state. navId names the nav column region for
      aria-controls (unique per session: files tabs can coexist). */
  navCollapsed: boolean;
  onToggleNav: () => void;
  navId: string;
}

// The preview pane: the selected changed file's DIFF at props.base
// ("worktree" by default, a change id for that change's patch). No content
// view — plain viewing is the official Files tab's job (the ↗ handoff in the
// head row). An empty patch is a state, not an error.
function PreviewPane(props: PreviewPaneProps) {
  const t = props.t;
  const diffSeq = React.useRef(0);
  const [diffSt, setDiffSt] = React.useState<DiffState>({ status: "idle", for: null });
  // The last patch actually shown, per file. A background refresh that comes
  // back UNCHANGED must not touch state (no re-render, no scroll jump).
  // Otherwise a live-change tick makes the open diff visibly "refresh".
  const lastPatchRef = React.useRef<{ base: string; patch: string } | null>(null);
  // The binary payload (old|new bytes), kept per (file, base). The first
  // fetch requests it. Later fetches pass noBinary — without the flag, a
  // 1 MB image's base64 re-crosses the wire on every refresh. Committed bytes
  // are history-stable; a worktree/commit edit shows up as a changed
  // patch, which drops the cache (see the fetch handler below).
  const binaryRef = React.useRef<{ key: string; binary: DiffBinary } | null>(null);

  // Diffable: a commit base is always (that change's patch for the file).
  // A worktree base needs the file's change to have a non-conflict base —
  // a conflict-only file has no worktree diff (its note is shown instead).
  const isRev = props.base !== "worktree";
  const diffable = isRev || !!(props.status && props.status.base !== "conflict" && props.fetchDiff);

  // The diff fetch, one per (file, base). A tick that changed the listing
  // hands us a FRESH status object, so this re-runs on real changes (and on
  // a file/base switch). It must stay invisible when the bytes didn't
  // change: no loading flash, no state update for a byte-identical patch.
  React.useEffect(() => {
    if (!diffable || !props.relPath) { setDiffSt({ status: "idle", for: null }); lastPatchRef.current = null; binaryRef.current = null; return; }
    const seq = ++diffSeq.current;
    const c = new AbortController();
    // Same file AND same base = the same view (a live-change refresh). A
    // base switch (commit → worktree, commit → commit) is a NEW view even
    // for the same file: allow the loading note + full scroll reset.
    const sameFile = diffSt.for === props.relPath && diffSt.base === props.base;
    if (!sameFile) { lastPatchRef.current = null; binaryRef.current = null; }
    if (!sameFile || diffSt.status === "error") setDiffSt({ status: "loading", for: props.relPath, base: props.base });
    const haveBinary = !!(binaryRef.current && binaryRef.current.key === props.relPath + "@" + props.base);
    props.fetchDiff(props.relPath, props.base, c.signal, haveBinary ? { noBinary: true } : undefined).then((v) => {
      if (seq !== diffSeq.current) return;
      if (!v || v.patch === "") { lastPatchRef.current = { base: props.base, patch: "" }; setDiffSt({ status: "none", for: props.relPath, base: props.base }); return; }
      if (v.binary) {
        binaryRef.current = { key: props.relPath + "@" + props.base, binary: v.binary };
      } else if (sameFile && lastPatchRef.current
          && lastPatchRef.current.base === props.base
          && lastPatchRef.current.patch !== v.patch) {
        // This fetch went out noBinary (a warm cache) and came back with a
        // CHANGED patch: the worktree/commit bytes the cache holds may be
        // stale (a live edit). Drop them — the next cold fetch re-reads
        // with bytes.
        binaryRef.current = null;
      }
      const binary = binaryRef.current && binaryRef.current.key === props.relPath + "@" + props.base ? binaryRef.current.binary : null;
      if (sameFile && lastPatchRef.current && lastPatchRef.current.base === props.base && lastPatchRef.current.patch === v.patch) return;
      lastPatchRef.current = { base: props.base, patch: v.patch };
      const parsed = parseDiff(v.patch);
      setDiffSt({ status: "diff", for: props.relPath, file: parsed.files[0] || null, truncated: !!v.truncated, base: v.base, binary: binary || null });
    }).catch((e) => {
      if (seq !== diffSeq.current || (e && e.name === "AbortError")) return;
      setDiffSt({ status: "error", for: props.relPath, error: rpcErrorText(e, t) });
    });
    return () => { c.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.relPath, props.status, props.base, diffable]);

  // ---- Section ref: a click or selection in the diff → the short ref the
  // user appends to the chat prompt (or copies). ONE ref, determined by the
  // gesture: selRef = the LIVE text selection (always carries its text),
  // clickRef = a single click (the line's number ref, or the snippet-only
  // anchor on old-side lines). The head row shows `selRef ?? clickRef`.
  const [selRef, setSelRef] = React.useState<string | null>(null);
  const [clickRef, setClickRef] = React.useState<string | null>(null);
  const [refCopied, setRefCopied] = React.useState(false);
  const refCopyTimer = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(refCopyTimer.current), []);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Selection → ref, ALWAYS with the selected text. The NEW side wins (its
  // lines exist in the worktree / at the reviewed commit); old-side-only
  // selections (deleted lines) get the snippet anchor only, no rev (the
  // lines belong to the commit's parent).
  const computeSelRef = (): string | null => {
    const root = bodyRef.current;
    const sel = typeof window === "undefined" ? null : window.getSelection();
    const path = props.relPath;
    if (!root || !path || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    if (!root.contains(sel.anchorNode)) return null;
    const rev = isRev ? props.base : undefined;
    const nw = diffSelRange(root, "data-dn");
    if (nw) return buildFileRef({ path, start: nw.min, end: nw.max, rev, text: nw.text });
    const od = diffSelRange(root, "data-dl");
    if (od) return buildFileRef({ path, text: od.text });
    return null;
  };
  React.useEffect(() => {
    let raf = 0;
    const onSel = (): void => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setSelRef(computeSelRef()); }); };
    document.addEventListener("selectionchange", onSel);
    onSel();
    return () => { document.removeEventListener("selectionchange", onSel); if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.relPath, props.base, diffSt.status, diffSt.file]);

  const copyRef = (text: string): void => {
    copyRefText(text);
    setRefCopied(true);
    window.clearTimeout(refCopyTimer.current);
    refCopyTimer.current = window.setTimeout(() => setRefCopied(false), 1200);
  };

  // ---- Click → ref: a single click on a diff line (cell OR gutter)
  // resolves to that line's ref, shown in the head row. The new side wins
  // (its lines exist in the worktree / at the rev); an old-side line
  // anchors on its own text instead (the numbers belong to the base
  // revision). Interactive targets resolve to nothing (their own click
  // behavior wins).
  const resolveClickRef = (e: { clientX: number; clientY: number; target: unknown }): string | null => {
    const root = bodyRef.current;
    const target = e.target instanceof Element ? e.target : null;
    const path = props.relPath;
    if (!root || !path || !target || diffSt.status !== "diff") return null;
    if (target.closest("a,button,input,textarea,select,svg,iframe,[contenteditable]")) return null;
    const rev = isRev ? props.base : undefined;
    const cell = target.closest<HTMLElement>(".dswFiles_diffCell[data-dl],.dswFiles_diffCell[data-dn],.dswFiles_diffNo[data-dl],.dswFiles_diffNo[data-dn]");
    if (!cell) return null;
    const dn = Number(cell.getAttribute("data-dn"));
    const dl = Number(cell.getAttribute("data-dl"));
    let text = "";
    if (cell.classList.contains("dswFiles_diffCell")) {
      text = (cell.textContent || "").trim();
      const mk = cell.querySelector(".dswFiles_diffMark");
      const mt = mk ? (mk.textContent || "") : "";
      if (mt && text.startsWith(mt)) text = text.slice(mt.length).trim();
    }
    if (Number.isFinite(dn) && dn >= 1) {
      // A click is no selection → no text: the line's number ref.
      return buildFileRef({ path, start: dn, rev });
    }
    if (Number.isFinite(dl) && dl >= 1) {
      if (!text) return null; // deleted line with no text: nothing to anchor
      return buildFileRef({ path, text });
    }
    return null;
  };
  // Click (no drag) bookkeeping: a primary mousedown/mouseup pair that
  // travels ≤4 px is a click; anything longer is a drag-selection, which
  // computeSelRef owns. The head row's own buttons swallow their clicks.
  const downAt = React.useRef<{ x: number; y: number } | null>(null);
  const onBodyMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 0) downAt.current = { x: e.clientX, y: e.clientY };
  };
  const onBodyMouseUp = (e: React.MouseEvent): void => {
    const d = downAt.current;
    downAt.current = null;
    if (e.button !== 0 || !d) return;
    if (Math.abs(e.clientX - d.x) > 4 || Math.abs(e.clientY - d.y) > 4) return; // a drag
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.closest(".dswFiles_paneHead")) return; // the head row's buttons
    setClickRef(resolveClickRef(e));
  };
  // A ref is only valid for the content it was resolved against: switch the
  // file or the commit base and the clicked line no longer points at the
  // same thing.
  React.useEffect(() => { setClickRef(null); }, [props.relPath, props.base]);

  // ---- The head row: the file's ref surface. At rest it shows the file's
  // path — dim directory, full-ink name. A click or selection on diff text
  // morphs it into the EXACT pasteable ref token (monospace, ellipsized,
  // full text in the tooltip), with actions beside it: COPY the token,
  // INSERT it into the chat draft, and ↗ the Open-in-Files handoff (always,
  // at rest or not — plain viewing belongs to the official Files tab).
  // The row is user-select:none — a drag starting in it and running into
  // the diff text would mix anchors the ref resolvers reject.
  const activeRef = selRef ?? clickRef;
  const headPath = props.relPath;
  const headParts = headPath ? pathPartsOf(headPath) : null;
  const headRow = props.name
    ? <div className="dswFiles_paneHead">
        {activeRef
          ? <span className="dswFiles_paneHeadToken" title={activeRef} aria-label={activeRef}>{activeRef}</span>
          : headParts
            ? <span className="dswFiles_paneHeadPath" title={headPath || undefined}>
                <span className="dswFiles_pathDirectory">{headParts.directory}</span><span className="dswFiles_pathName">{headParts.name}</span>
              </span>
            : null}
        <span className="dswFiles_paneHeadBtns">
          {activeRef
            ? <button type="button" className="dswFiles_headBtn"
                title={t("files.refCopy")} aria-label={t("files.refCopy")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => copyRef(activeRef)}>
                {refCopied ? Icon("IconCheckOutline16", { size: 14 }, "✓") : Icon("IconCopyOutline16", { size: 14 }, "⧉")}
              </button>
            : null}
          {/* Open in Files: hand THIS file to the official file viewer.
              The relPath is workspace-relative. Degrades away without host
              tab actions (pre-0.1.5 surface). */}
          {props.openInFiles && props.relPath
            ? <button type="button" className="dswFiles_headBtn"
                title={t("files.openInFiles")} aria-label={t("files.openInFiles")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.openInFiles!(props.relPath || "")}>
                <span aria-hidden="true">↗</span>
              </button>
            : null}
          {activeRef && props.inputActions
            ? <AddToChatBtn refText={activeRef} useInput={props.useInput ?? null} inputActions={props.inputActions} t={t}
                className="dswFiles_headBtn" iconOnly />
            : null}
        </span>
      </div>
    : null;

  // While the nav is hidden, its state-pair RESTORE control lives here (the
  // top row is the still-visible region). The hide control lives in the nav's
  // own header.
  const navRestore = props.navCollapsed
    ? <div className="dswFiles_paneToggle" role="group">
        <button
          type="button"
          className="dswFiles_navToggle"
          onClick={props.onToggleNav}
          aria-label={t("files.restoreNav")}
          title={t("files.restoreNav")}
          aria-expanded="false"
          aria-controls={props.navId}
        >
          <NavChevron dir="left" size={14} />
        </button>
      </div>
    : null;

  // The conflict note is about the WORKTREE file, suppressed while a past
  // commit is selected (the pane shows that commit's patch, not the
  // conflicted worktree text).
  const conflictNote = !isRev && props.status && props.status.base === "conflict"
    ? <div className="dswFiles_previewNote">{t("files.conflictNote")}</div>
    : null;

  const body = !props.relPath
    ? <div className="dswFiles_previewEmpty">{t("files.previewEmpty")}</div>
    : diffSt.status === "diff"
      ? (diffSt.file
          ? <DiffView model={diffSt.file} truncated={diffSt.truncated} t={t} baseLabel={isRev ? t("files.diffAtRev") + " " + props.base : null} binary={diffSt.binary || null} />
          : <div className="dswFiles_previewNote">{t("files.noChanges")}</div>)
      : diffSt.status === "none"
        ? <div className="dswFiles_previewNote">{t("files.noChanges")}</div>
        : diffSt.status === "error"
          ? <div className="dswFiles_error">{t("files.diffError") + (diffSt.error ? " — " + diffSt.error : "")}</div>
          : <div className="dswFiles_previewEmpty">{t("files.diffLoading")}</div>;

  return <div
    ref={bodyRef}
    className="dswFiles_previewBody"
    style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 0" }}
    onMouseDown={onBodyMouseDown}
    onMouseUp={onBodyMouseUp}
  >
    {navRestore}
    {headRow}
    {conflictNote}
    {body}
  </div>;
}


// The right column is a dsh tab system: changestab's page (sidebar://changestab)
// is one tab, next to the stock `files` page and its per-file tabs. dsh keys
// each tab body by tab id, and a body unmounts when its tab is hidden
// (keepMounted defaults off), so any tab switch — to a stock file tab and
// back — remounts the body. React state is lost across that remount, so the
// nav column re-fetches its tree — the visible "refresh".
//
// This module-level cache (it survives the remount within one page load, keyed
// by session) restores the fetched nav state synchronously on mount, so the
// tree stays put and only the preview updates. It is dropped when the session
// is gone. A full page reload starts empty (a fresh fetch is correct then).
interface NavCache {
  commitList: VcsCommit[];
  navScroll: number;
  /** The WORKTREE root listing (null while a snapshot is live). */
  rootListing: Listing | null;
}
const navCache = new Map<string, NavCache>();
const navCacheGet = (sessionId: string | null): NavCache | null =>
  sessionId ? (navCache.get(sessionId) ?? null) : null;
const navCacheSet = (sessionId: string | null, patch: Partial<NavCache>): void => {
  if (!sessionId) return;
  const prev = navCache.get(sessionId) ?? { commitList: [], navScroll: 0, rootListing: null };
  navCache.set(sessionId, { ...prev, ...patch });
};
const navCacheDrop = (sessionId: string | null): void => {
  if (sessionId) navCache.delete(sessionId);
};

// The selected change's changed files as a directory-grouped tree:
// intermediate directories become rows of their own (expanded by default),
// files sit at their exact depth. Directories precede files; each group is
// natural-name sorted (file2 before file10).
type GroupNode =
  | { kind: "file"; change: VcsChange }
  | { kind: "dir"; name: string; path: string; children: GroupNode[] };
function groupChangedFiles(changes: VcsChange[]): GroupNode[] {
  type TreeNode = { dirs: Map<string, TreeNode>; files: VcsChange[] };
  const root: TreeNode = { dirs: new Map(), files: [] };
  const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const c of changes) {
    const segs = String(c.path).split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]!;
      let child = node.dirs.get(seg);
      if (!child) { child = { dirs: new Map(), files: [] }; node.dirs.set(seg, child); }
      node = child;
    }
    node.files.push(c);
  }
  const render = (node: TreeNode, prefix: string): GroupNode[] => {
    const out: GroupNode[] = [];
    for (const name of [...node.dirs.keys()].sort((a, b) => byName.compare(a, b))) {
      const child = node.dirs.get(name)!;
      const path = prefix ? prefix + "/" + name : name;
      out.push({ kind: "dir", name, path, children: render(child, path) });
    }
    for (const c of [...node.files].sort((a, b) => byName.compare(pathPartsOf(a.path).name, pathPartsOf(b.path).name))) {
      out.push({ kind: "file", change: c });
    }
    return out;
  };
  return render(root, "");
}

// ---------- The change graph (the jj-log-style tree lines) ----------
// A PURE lane layout over the change list: given the rows in display order
// (newest first, the working-copy row first) and each row's parent change
// ids, it returns per-row, per-lane line segments. A lane is one vertical
// channel; an edge (child → parent) occupies a lane from the child's row
// down to the parent's row. A node sits in the leftmost lane of the edges
// arriving at it, or in the next lane when none arrive. Its first parent
// continues in the node's own lane; further parents open the lowest free
// lanes (a lane an incoming line terminates at is not reusable — its top
// half ends at the node). A parent with no row in the window (elided under
// the fold, or on a not-yet-loaded page) keeps its lane lit to the window's
// bottom edge: the line runs out of the visible area. The all-z root, once
// its page is loaded, IS a row — the oldest commit's line lands on it and
// stops (a parentless node), terminating the tree at a visible floor.
export const WORKTREE_KEY = "~worktree~";
// The change log's first page (the worktree listing's vcs block) carries the
// host's first MAX_COMMITS rows; scroll auto-load fetches further pages of
// this size from the `log` endpoint and appends them below.
export const LOG_PAGE_SIZE = 50;
export type LogPage = { commits: VcsCommit[] };
export type GraphNode = { key: string; parents: string[] };
export type GraphCell = {
  vT: boolean; // vertical segment: row top → node level
  vB: boolean; // vertical segment: node level → row bottom
  h: "" | "L" | "R" | "B"; // horizontal arm at the node level (left / right / full)
  node: boolean; // this lane carries the row's bullet
};
export type GraphRow = { key: string; cells: GraphCell[] };
export function layoutChangeGraph(nodes: GraphNode[]): { rows: GraphRow[]; lanes: number } {
  // lane → the key the in-flight edge in that lane is heading to.
  let edges: (string | null)[] = [];
  let lanes = 0;
  const rows: GraphRow[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const inc: number[] = [];
    edges.forEach((to, l) => { if (to === node.key) inc.push(l); });
    const nodeLane = inc.length > 0 ? Math.min(...inc) : lanes;
    const hasParent = node.parents.length > 0;
    // The floor is the last row; it is a true floor only when it is parentless
    // (jj's root). A still-in-flight edge there — a parent outside the loaded
    // window — is clipped, not run off the bottom past the root. A non-root last
    // row (root not yet loaded) keeps its line running out to the next page.
    const isFloor = i === nodes.length - 1 && !hasParent;
    const used = new Set<number>(inc); // incoming lanes end at the node
    if (hasParent) used.add(nodeLane); // the first parent continues here
    const outgoing: number[] = [];
    if (hasParent) {
      outgoing.push(nodeLane);
      for (let j = 1; j < node.parents.length; j++) {
        let l = 0;
        while (used.has(l)) l++;
        used.add(l);
        outgoing.push(l);
      }
    }
    const extra = inc.concat(outgoing).filter((l) => l !== nodeLane);
    const lo = extra.reduce((m, l) => Math.min(m, l), nodeLane);
    const hi = extra.reduce((m, l) => Math.max(m, l), nodeLane);
    const width = Math.max(lanes, nodeLane + 1, ...outgoing.map((l) => l + 1));
    const nextEdges: (string | null)[] = edges.slice();
    while (nextEdges.length < width) nextEdges.push(null);
    const cells: GraphCell[] = [];
    for (let l = 0; l < width; l++) {
      const isNode = l === nodeLane;
      const isInc = !isNode && inc.includes(l);
      const isOut = !isNode && outgoing.includes(l);
      const pass = !isNode && !isInc && !isOut && edges[l] !== null;
      const vT = isNode ? inc.length > 0 : isInc || pass;
      const vB = (pass && !isFloor) || (isNode && hasParent) || isOut;
      let h: GraphCell["h"] = "";
      if (l > lo && l < hi) h = "B";
      else if (l === hi && hi !== nodeLane) h = "L";
      else if (l === lo && lo !== nodeLane) h = "R";
      else if (isNode) h = hi > nodeLane && lo < nodeLane ? "B" : hi > nodeLane ? "R" : lo < nodeLane ? "L" : "";
      cells.push({ vT, vB, h, node: isNode });
      if (isInc) nextEdges[l] = null; // the edge ends at the node
      if (isNode && hasParent) nextEdges[l] = node.parents[0]!;
      else if (isOut) nextEdges[l] = node.parents[outgoing.indexOf(l)]!;
    }
    rows.push({ key: node.key, cells });
    lanes = width;
    edges = nextEdges;
  }
  return { rows, lanes };
}

interface FilesViewProps {
  t?: TFunc;
  listDirectory: (relPath: string, signal: AbortSignal, showHidden: boolean, force: boolean, rev: string | null) => Promise<Listing>;
  sessionId: string | null;
  fetchDiff: (relPath: string, base: string, signal: AbortSignal, opts?: { noBinary?: boolean }) => Promise<DiffResponse>;
  /** One page of the change log beyond the first (the scroll auto-load):
      `offset` rows back, `limit` rows. A short/empty page is the end.
      Optional — a minimal profile (or old host) without the `log` endpoint
      simply never loads past the first page. */
  fetchLogPage?: (offset: number, limit: number, signal: AbortSignal) => Promise<LogPage>;
  /** The live-update heartbeat: the host's stat gate over the root listing
      (the open file's content is the diff, which the fresh listing's VCS
      block refreshes). */
  tick: (dirs: string[], openFile: string | null, openMtime: number | null, deep: boolean, showHidden: boolean, signal: AbortSignal) => Promise<TickResponse>;
  /**
   * Session standard kit (composer): the live-draft selector and the public
   * draft write path, passed through for the section-ref "add to chat"
   * action. Optional — the slot renderer provides them for session-scoped
   * entries, but a test harness or minimal profile may not.
   */
  useInput?: ((sel: (s: { draft: string }) => string) => string) | null;
  inputActions?: { setDraft(text: string): void } | null;
  /** The right-column tab's HOST actions (dsh 0.1.5+): the "Open in Files"
      handoff (openResource → the official file viewer's tab for one file)
      and the non-VCS empty state's openTab("files") (→ the official file
      browser). Absent on the pre-0.1.5 conversation surface, where the
      handoffs degrade away (the copy/add-to-chat affordances remain). */
  tabActions?: {
    openTab(kind: string, options?: { params?: unknown }): void;
    openResource(address: string, options?: { params?: unknown }): void;
  } | null;
  /** An open from OUTSIDE the list (a file resource redirected into the
      right-column page tab): the workspace-relative file to select (the
      navigation generation is its revision). null = none pending. */
  openRequest?: { path: string; line?: number; revision: number } | null;
}
function FilesView(props: FilesViewProps) {
  const t = props.t || ((k: string) => k);
  const listDirectory = props.listDirectory;
  const sessionId = props.sessionId;
  const tabActions = props.tabActions ?? null;
  // The "Open in Files" handoff: the official file viewer's resource address
  // for this session's file (the destination for plain viewing). The relPath
  // is workspace-relative (the session host resolves it).
  const openInFiles = tabActions && sessionId
    ? (path: string) => { tabActions.openResource(sessionFileAddress(sessionId, path)); }
    : null;
  const navId = "dswFiles_nav" + (sessionId ? "_" + sessionId : "");
  const [saved] = React.useState<SavedState | null>(() => loadState(sessionId));
  const savedRev = saved && typeof saved.rev === "string" && /^[0-9a-z]{6,40}$/.test(saved.rev)
    ? saved.rev : null;
  // The worktree's root listing: ALWAYS the change tree's source — the VCS
  // block (commit list, head, worktree changes) is the worktree's in every
  // response, worktree or snapshot. Seeded from the module nav cache so a
  // remount from the resource-frame redirect restores the tree synchronously.
  // Selecting a reviewed change never touches it — that is what keeps the
  // tree from unmounting/flashing on every selection.
  const [worktreeListing, setWorktreeListing] = React.useState<Listing | null>(
    () => navCacheGet(sessionId)?.rootListing ?? null);
  const [rootErr, setRootErr] = React.useState<string | null>(null);
  // The selected change's SNAPSHOT listing (the host's synthesized file tree
  // at that revision; its changed files ride in `commitChanges`). null =
  // worktree mode or a fetch in flight. Carries its rev so a selection
  // change invalidates it in place (only the file pane re-loads).
  const [snapshot, setSnapshot] = React.useState<{ rev: string; listing: Listing } | null>(null);
  const [snapshotErr, setSnapshotErr] = React.useState<string | null>(null);
  // Latched dead session (BUG-008): a session-not-found from any browse call
  // kills the view until the user reloads (a fresh session may have come up).
  const [sessionGone, setSessionGone] = React.useState(false);
  // The selected changed file (workspace relPath), or null.
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  const [navW, setNavW] = React.useState<number | null>(() =>
    saved && typeof saved.navW === "number" && saved.navW >= 220 && saved.navW <= 2000
      ? Math.round(saved.navW) : null);
  const [collapsed, setCollapsed] = React.useState<boolean>(() => saved ? saved.collapsed : false);
  // The change-log pane's height (px) in the split nav; null = the CSS
  // default (240px). Persisted like navW.
  const [treeH, setTreeH] = React.useState<number | null>(() =>
    saved && typeof saved.treeH === "number" && saved.treeH >= 96 && saved.treeH <= 2000
      ? Math.round(saved.treeH) : null);
  // The reviewed change (null = the working copy). The commit list comes
  // from the root listing's VCS block, which is absent for a non-VCS
  // workspace (and while the first listing is still in flight).
  const [revSel, setRevSel] = React.useState<string | null>(savedRev);
  // The commit list from the last listing that carried one (both worktree
  // and snapshot responses include the worktree jj block). Seeded from the
  // module nav cache so a remount from the resource-frame redirect restores
  // the tree synchronously (no re-fetch).
  const [commitList, setCommitList] = React.useState<VcsCommit[]>(
    () => navCacheGet(sessionId)?.commitList ?? []);
  // The directories the user COLLAPSED in the selected change's file tree
  // (everything else starts expanded).
  const [foldedDirs, setFoldedDirs] = React.useState<Set<string>>(new Set());
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const navScrollRef = React.useRef<HTMLDivElement | null>(null);
  const logPaneRef = React.useRef<HTMLDivElement | null>(null);
  const seqRef = React.useRef(0);
  const forceRef = React.useRef(false);
  const pendingSelRef = React.useRef<string | null>(saved ? saved.selected : null);
  const pathBoxRef = React.useRef<HTMLDivElement | null>(null);
  const pathTextRef = React.useRef<HTMLSpanElement | null>(null);
  // The change log's scroll auto-load: `extraCommits` are the pages fetched
  // beyond the first (which the worktree listing's vcs block carries). A
  // fresh listing resets them (the history may have changed), tracked by the
  // page-0 signature below. `logExhausted` stops fetching once a page comes
  // back short (or the host has no `log` endpoint / the fetch failed).
  const [extraCommits, setExtraCommits] = React.useState<VcsCommit[]>([]);
  const [logLoading, setLogLoading] = React.useState(false);
  const [logExhausted, setLogExhausted] = React.useState(false);
  const loadInFlightRef = React.useRef(false); // guards against overlapping loads
  const loadMoreRef = React.useRef<() => void>(() => {}); // the scroll listener's stable handle

  // The tree's source: the worktree listing, or — only while the worktree
  // fetch is still in flight on a saved-rev mount — the snapshot's VCS block
  // (it carries the SAME worktree status; the snapshot's file tree is the
  // only difference, and the file pane reads the snapshot directly).
  const refListing = worktreeListing ?? (snapshot ? snapshot.listing : null);
  const vcsInfo = refListing && refListing.vcs && refListing.vcs.ok === true ? refListing.vcs : null;
  const commits = vcsInfo && Array.isArray(vcsInfo.commits) ? vcsInfo.commits : [];
  // The first page's identity: head id + newest commit id + page length. A
  // change means a fresh listing replaced page 0 (the history moved), so the
  // appended pages must be dropped and re-fetched from the new top.
  const page0Sig = vcsInfo
    ? (vcsInfo.head ? (vcsInfo.head.changeId || vcsInfo.head.id) : "") + "|" + (commits[0] ? (commits[0].commitId || commits[0].id) : "") + "|" + commits.length
    : "";
  const revLive = revSel && (commitList.some((c) => c.id === revSel) || extraCommits.some((c) => c.id === revSel)) ? revSel : null;
  const snapshotMode = revLive !== null;
  // The selected change's own changed files, from the SNAPSHOT listing —
  // the worktree's listing carries the worktree's changes, never the
  // reviewed change's.
  const commitChanges = snapshot && snapshot.rev === revLive && Array.isArray(snapshot.listing.commitChanges)
    ? snapshot.listing.commitChanges : null;
  const activeChanges = snapshotMode ? commitChanges : (vcsInfo ? vcsInfo.changes ?? null : null);
  const rootPath = refListing && typeof refListing.root === "string" ? refListing.root : null;
  const noteCommits = (listing: Listing | null) => {
    if (listing && listing.vcs && listing.vcs.ok === true && Array.isArray(listing.vcs.commits)) {
      setCommitList(listing.vcs.commits);
    }
  };

  // A fresh listing that replaces page 0 (the history moved) drops the
  // appended pages and resets the load state. A short first page (fewer than
  // LOG_PAGE_SIZE rows) means there is nothing further to load. An unchanged
  // refresh leaves page0Sig alone, so the loaded tail survives it.
  React.useEffect(() => {
    setExtraCommits([]);
    setLogLoading(false);
    loadInFlightRef.current = false;
    setLogExhausted(commits.length < LOG_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page0Sig]);
  // The stable load handle the scroll listener calls. Reassigned each render
  // so the closure always reads the current state.
  loadMoreRef.current = () => {
    if (loadInFlightRef.current || logExhausted) return;
    const fetch = props.fetchLogPage;
    if (!fetch) { setLogExhausted(true); return; } // host without the `log` endpoint
    const offset = commits.length + extraCommits.length;
    loadInFlightRef.current = true;
    setLogLoading(true);
    fetch(offset, LOG_PAGE_SIZE, new AbortController().signal)
      .then((page) => {
        setExtraCommits((prev) => prev.concat(page.commits));
        if (page.commits.length < LOG_PAGE_SIZE) setLogExhausted(true); // short page = the end
      })
      .catch(() => { setLogExhausted(true); }) // a failed page stops (no retry loop)
      .finally(() => { loadInFlightRef.current = false; setLogLoading(false); });
  };

  // The WORKTREE listing is the change tree's source and is fetched exactly
  // once per mount (never on a selection change — that is the whole point of
  // the two-listing split): the nav is the change tree, and the worktree's
  // changed files come from its VCS block, so there is no per-directory fetch.
  React.useEffect(() => {
    if (sessionGone || worktreeListing !== null || rootErr !== null) return;
    const force = forceRef.current;
    if (force) forceRef.current = false;
    const seq = ++seqRef.current;
    const c = new AbortController();
    // Transport guard: a request that never settles (a dead keep-alive
    // socket, a proxy that swallows it) would leave "Loading…" as the only
    // visible state forever. Surface it after 30 s.
    const stuckTimer = window.setTimeout(() => {
      if (seqRef.current === seq) setRootErr(t("files.fetchStuck"));
    }, 30000);
    listDirectory(ROOT_PATH, c.signal, false, force, null).then((listing) => {
      if (seqRef.current !== seq) return;
      noteCommits(listing);
      setWorktreeListing(listing);
      setRootErr(null);
    }).catch((e) => {
      if (c.signal.aborted || seqRef.current !== seq) return;
      // A dead session latches the flag (the pane swaps to the retrying
      // notice; the sessionGone retry effect decides when it turns
      // terminal) rather than leaking the raw "session-not-found: no live
      // session for <uuid>" string.
      if (isSessionGone(e)) { setSessionGone(true); return; }
      setRootErr(rpcErrorText(e, t));
    });
    return () => { c.abort(); window.clearTimeout(stuckTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGone, worktreeListing, rootErr]);

  // The SELECTED change's snapshot listing: its synthesized file tree + the
  // change's own changed files (`commitChanges`). Fetched per reviewed
  // change and invalidated in place on a selection change — the change tree
  // (worktreeListing) is untouched, so selecting a change only re-loads the
  // file pane, never unmounts the log.
  const snapshotRevRef = React.useRef<string | null>(null);
  // Bumped by the ⟳ reload: snapshot/snapshotErr are deliberately OUT of
  // the snapshot effect's deps (below), so the reload's setSnapshot(null)
  // no longer re-arms the fetch — the nonce does.
  const [snapshotNonce, setSnapshotNonce] = React.useState(0);
  React.useEffect(() => {
    if (sessionGone || !revLive) {
      snapshotRevRef.current = null;
      if (snapshot || snapshotErr) { setSnapshot(null); setSnapshotErr(null); }
      return;
    }
    if (snapshotRevRef.current === revLive) return; // fetched or in flight
    snapshotRevRef.current = revLive;
    setSnapshot(null);
    setSnapshotErr(null);
    const seq = ++seqRef.current;
    const c = new AbortController();
    const stuckTimer = window.setTimeout(() => {
      if (seqRef.current === seq) setSnapshotErr(t("files.fetchStuck"));
    }, 30000);
    listDirectory(ROOT_PATH, c.signal, false, false, revLive).then((listing) => {
      if (seqRef.current !== seq) return;
      setSnapshot({ rev: revLive, listing });
    }).catch((e) => {
      if (c.signal.aborted || seqRef.current !== seq) return;
      if (isSessionGone(e)) { setSessionGone(true); return; }
      setSnapshotErr(rpcErrorText(e, t));
    });
    return () => { c.abort(); window.clearTimeout(stuckTimer); };
    // snapshot/snapshotErr are deliberately NOT deps: the in-effect reset
    // (setSnapshot(null) when a selection starts loading) would otherwise
    // re-run this effect, and that re-run's cleanup would abort the fetch
    // it just started; the ref guard above then blocks the re-fetch and
    // the pane sits on "Loading…" forever. Selection and reload changes
    // ride revLive and snapshotNonce instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGone, revLive, snapshotNonce]);

  // Keep the module nav cache in sync so a remount from the resource-frame
  // redirect restores the change list (and the worktree tree) synchronously.
  // Only the WORKTREE listing is cached — it always is; the snapshot's
  // synthesized tree is a separate state and never feeds this cache.
  React.useEffect(() => {
    const patch: Partial<NavCache> = { commitList };
    if (worktreeListing) patch.rootListing = worktreeListing;
    navCacheSet(sessionId, patch);
  }, [sessionId, commitList, worktreeListing]);
  // A dead session leaves stale state behind: drop the cache so a fresh
  // session that reuses the id starts clean.
  React.useEffect(() => {
    if (sessionGone) navCacheDrop(sessionId);
  }, [sessionId, sessionGone]);

  // session-not-found is usually a restarted server, which cold-resolves the
  // session by id within seconds — so before the latch turns terminal (the
  // red notice), re-fetch the worktree listing on a 1.5s / 3s / 6s backoff.
  // A success restores the listing and clears the flag; the tick and
  // snapshot effects resume on their own. Exhaustion falls through to the
  // terminal notice (the ⟳ button re-arms this whole cycle manually).
  const [goneRetries, setGoneRetries] = React.useState(0);
  React.useEffect(() => {
    if (!sessionGone) { setGoneRetries(0); return; }
    if (goneRetries >= GONE_RETRY_MAX) return; // exhausted → terminal notice
    const seq = ++seqRef.current;
    const c = new AbortController();
    const timer = window.setTimeout(() => {
      listDirectory(ROOT_PATH, c.signal, false, true, null).then((listing) => {
        if (seqRef.current !== seq) return;
        noteCommits(listing);
        setWorktreeListing(listing);
        snapshotRevRef.current = null;
        setSnapshot(null);
        setSnapshotErr(null);
        setSessionGone(false);
      }).catch(() => {
        if (c.signal.aborted || seqRef.current !== seq) return;
        setGoneRetries((n) => n + 1); // next attempt, or terminal
      });
    }, goneRetryDelay(goneRetries));
    return () => { c.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGone, goneRetries]);

  // An open from OUTSIDE the list (a file resource redirected into the
  // right-column page): route it through the pending selection; the apply
  // effect below validates it against the change's own file set.
  const openReq = props.openRequest || null;
  React.useEffect(() => {
    if (!openReq) return;
    pendingSelRef.current = openReq.path;
    setSelectedFile((cur) => (cur === openReq.path ? cur : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReq]);

  // Apply the pending selection (a restored one, or a redirected open) once
  // the change's file set is known: the path must be one of the selected
  // change's files. A path that isn't (a stale save, an open that has
  // drifted) is dropped silently — latching it would flash a failed ref on
  // every reload.
  React.useEffect(() => {
    const pend = pendingSelRef.current;
    if (!pend) return;
    if (!activeChanges) return; // the root listing is still in flight
    if (!activeChanges.some((f) => f.path === pend)) { pendingSelRef.current = null; return; }
    pendingSelRef.current = null;
    setSelectedFile(pend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreeListing, snapshot, revLive, openReq]);

  // A reviewed-change switch: the SELECTED FILE is parked (it belongs to the
  // other change's file set) and re-applied by the pendingSel effect once
  // the new change's snapshot lands. The change tree itself is left alone —
  // its source (the worktree listing) never re-fetches on a selection
  // change; only the snapshot's file pane loads, in place.
  const lastRevRef = React.useRef(revLive);
  React.useEffect(() => {
    if (lastRevRef.current === revLive) return;
    lastRevRef.current = revLive;
    if (selectedFile) { pendingSelRef.current = selectedFile; setSelectedFile(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revLive]);

  // Live update: one tick POST every 5 s asks the host "did anything I show
  // change?". The host gates its expensive reads behind an fs.stat check, so
  // a quiet cycle costs zero VCS spawns; a real change comes back as the new
  // WORKTREE listing. The tick never stops in snapshot mode: the change tree
  // is still live (the working copy's "Editing" row and pill rollups track
  // the worktree even while a commit is open) — only the reviewed change's
  // file pane is immutable, and the tick doesn't touch it.
  const tickReadyRef = React.useRef(false);
  tickReadyRef.current = worktreeListing !== null;
  const tickSeqRef = React.useRef(0);
  const tickCountRef = React.useRef(0);
  React.useEffect(() => {
    if (sessionGone) return;
    const DEEP_EVERY = 3; // 5 s × 3 = 15 s for tree-membership to be seen
    const iv = setInterval(() => {
      const seq = ++tickSeqRef.current;
      if (!tickReadyRef.current) return;
      const c = new AbortController();
      const deep = ++tickCountRef.current % DEEP_EVERY === 0;
      props.tick([ROOT_PATH], null, null, deep, false, c.signal).then((v) => {
        if (seq !== tickSeqRef.current || c.signal.aborted) return;
        if (!v || v.list === "same") return;
        const l = v.list.listings[0];
        if (!l || typeof l !== "object" || "error" in l) return; // keep the last good listing
        noteCommits(l as Listing);
        setWorktreeListing(l as Listing);
      }).catch((e) => {
        if (seq !== tickSeqRef.current || c.signal.aborted) return;
        if (isSessionGone(e)) setSessionGone(true);
      });
    }, 5000);
    return () => { tickSeqRef.current++; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionGone]);

  React.useEffect(() => {
    if (pendingSelRef.current) return; // never clobber a pending restored selection
    saveState(sessionId, selectedFile, navW, revSel, collapsed, treeH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, navW, revSel, collapsed, treeH]);

  // The effect applies the divider position to --filez-nav. A null width
  // REMOVES the variable — the CSS then lays out the nav at its 340px
  // default (not "unset", which would drop it to the 220px min and make the
  // first drag jump by 120px). The variable is read back on drag start, so
  // the restore is exact for whatever width was last applied.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (typeof navW === "number") el.style.setProperty("--filez-nav", navW + "px");
    else el.style.removeProperty("--filez-nav");
  }, [navW]);

  // The header's clip mask (the dsh files treatment): the root path ellipses
  // at the right edge when it no longer fits, and the data attribute drives
  // the CSS mask. Measured on every reflow (a ResizeObserver on both the
  // box and the text: the text can grow under a stable box).
  React.useEffect(() => {
    const box = pathBoxRef.current, text = pathTextRef.current;
    if (!box || !text) return;
    const measure = () => {
      box.dataset.filesPathClipped = text.scrollWidth > box.clientWidth ? "true" : "false";
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(text);
    return () => ro.disconnect();
  }, [rootPath]);

  // Divider drag: pointer capture, rAF-coalesced updates, the width clamps
  // between the nav column's min (220px) and the value that leaves the
  // preview pane its 320px min. The nav column is rightmost, so dragging
  // the divider LEFT grows it (startX - latestX).
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current, divider = e.currentTarget;
    if (!body || !divider || e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("dswFiles_dividerActive");
    const startX = e.clientX;
    const parsed = parseFloat(getComputedStyle(body).getPropertyValue("--filez-nav"));
    const startW = isFinite(parsed) && parsed >= 220 ? parsed : 340;
    const minW = 220;
    const maxW = Math.max(minW, body.clientWidth - 16 * 2 - 6 - 320);
    const clamp = (x: number) => Math.max(minW, Math.min(maxW, x));
    let latestX = startX, raf = 0;
    const onMove = (ev: PointerEvent) => {
      latestX = ev.clientX;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        body.style.setProperty("--filez-nav", Math.round(clamp(startW + (startX - latestX))) + "px");
      });
    };
    const finish = (ev: PointerEvent) => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      try { divider.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      divider.classList.remove("dswFiles_dividerActive");
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", finish);
      divider.removeEventListener("pointercancel", finish);
      setNavW(Math.round(clamp(startW + (startX - ev.clientX))));
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", finish);
    divider.addEventListener("pointercancel", finish);
  };

  // The nav's horizontal divider drag (the change-log ↔ file-list split):
  // the same pointer-capture pattern as the vertical one, moving the log
  // pane's height between 96px and the value that leaves the file pane its
  // 96px min. The pane's height is written directly (no re-render per
  // pointermove) and committed to state on release (→ persisted).
  const startTreeDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const pane = logPaneRef.current, divider = e.currentTarget;
    if (!pane || !divider || e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("dswFiles_dividerActive");
    const startY = e.clientY;
    const startH = pane.getBoundingClientRect().height;
    const panesH = pane.parentElement ? pane.parentElement.clientHeight : 600;
    const minH = 96;
    const maxH = Math.max(minH, panesH - minH - 6);
    const clamp = (x: number) => Math.max(minH, Math.min(maxH, x));
    let latestY = startY, raf = 0;
    const onMove = (ev: PointerEvent) => {
      latestY = ev.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        pane.style.height = Math.round(clamp(startH + (latestY - startY))) + "px";
      });
    };
    const finish = (ev: PointerEvent) => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      try { divider.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
      divider.classList.remove("dswFiles_dividerActive");
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", finish);
      divider.removeEventListener("pointercancel", finish);
      pane.style.height = "";
      setTreeH(Math.round(clamp(startH + (ev.clientY - startY))));
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", finish);
    divider.addEventListener("pointercancel", finish);
  };

  const selStatus = selectedFile && activeChanges ? activeChanges.find((e) => e.path === selectedFile) || null : null;

  // The change tree nav: the working-copy "Editing" row
  // on top (the host's head + its worktree changes), a linear stack of
  // commits below (newest first; the host caps the list at 50, the log pane
  // scrolls the rest). Selecting a row drives the snapshot-mode machinery
  // (revSel → the list endpoint's rev): the root listing becomes that
  // change's snapshot, its changed files group under the row, and the diff
  // pane reviews against the change. The selected change's file list sits
  // below its row, directory-grouped and expanded by default.
  const shownCommits = commits.concat(extraCommits);
  const changeFiles: VcsChange[] | null = snapshotMode
    ? commitChanges
    : (vcsInfo ? (vcsInfo.changes ?? []) : null);
  // The ref pills: the jj CLI's bookmark rendering (name + dim @remote, the
  // sync sigil — `*` unsynced local (warn), `??` conflicted (error) — in its
  // own colored span), workspace names in the success tone, the +N fold.
  // A tracked remote's ahead/behind counts join the tooltip.
  const pillsEl = (refs: { bookmarks?: string[]; tags?: string[]; workspaces?: string[]; tracking?: VcsTracking[] }) => {
    const list = refPillList(refs, CHANGE_TREE_PILL_CAP);
    const more = refPillCount(refs) - list.length;
    return [
      ...list.map((p) => {
        const trk = p.kind === "bookmark" && p.remote
          ? (refs.tracking ?? []).find((x) => x.name === p.name && x.remote === p.remote)
          : undefined;
        const title = p.name + (p.remote ? "@" + p.remote : "")
          + (trk ? " — " + t("files.ahead") + " " + trk.ahead + ", " + t("files.behind") + " " + trk.behind : "");
        return (
          <span key={p.kind + "-" + p.name + (p.remote ?? "")}
            className={"dswFiles_changePill" + (p.kind === "tag" ? " dswFiles_changePillTag" : "") + (p.kind === "workspace" ? " dswFiles_changePillWs" : "")}
            title={title}>
            {p.name}
            {p.remote ? <span className="dswFiles_changePillRemote">{"@" + p.remote}</span> : null}
            {p.sigil ? <span className={"dswFiles_changePillSigil" + (p.sigil === "??" ? " dswFiles_changePillSigilConflict" : "")}>{p.sigil}</span> : null}
          </span>
        );
      }),
      more > 0 ? <span key="more" className="dswFiles_changePill dswFiles_changePillMore">+{more}</span> : null,
    ];
  };
  // The composer's draft write path (the diff head row's "add to chat").
  // Absent without inputActions — a read-only profile keeps the view fully
  // readable, just not chat-writable.
  const inputActions = props.inputActions ?? null;
  // The change graph: the working copy as the first node, the visible
  // commits after it. The worktree node's parents: on jj, the head's parent
  // change ids (the host supplies them); on git, the HEAD commit — row 0.
  // The layout elides parents that have no row in the window yet (the line
  // runs out of the bottom edge, like jj's graph under the fold); the all-z
  // root, once its page is loaded, becomes a row and the line lands on it.
  const graph = vcsInfo
    ? layoutChangeGraph([
        {
          key: WORKTREE_KEY,
          parents: vcsInfo.backend === "jj"
            ? (vcsInfo.head ? vcsInfo.head.parents ?? [] : [])
            : (commits.length > 0 ? [commits[0]!.id] : []),
        },
        // Rows key on the COMMIT id (git: `id` is already the sha): a
        // divergent jj change has several commits sharing one change id,
        // and each needs its own graph node + React key. The parent column
        // carries commit ids too, so the edges join cleanly.
        ...shownCommits.map((c) => ({ key: c.commitId || c.id, parents: c.parents ?? [] })),
      ])
    : null;
  // One graph lane cell: the line segments (CSS-drawn, font-independent)
  // plus the node's bullet — which replaces the old glyph slot in the line.
  const laneCell = (cell: GraphCell, l: number, nodeEl: React.ReactElement) => (
    <span key={l} className="dswFiles_lane">
      {(cell.vT || cell.vB) ? <i className={"dswFiles_laneV" + (cell.vT ? " dswFiles_vT" : "") + (cell.vB ? " dswFiles_vB" : "")} /> : null}
      {cell.h !== "" ? <i className={"dswFiles_laneH dswFiles_h" + cell.h} /> : null}
      {cell.node ? <span className="dswFiles_laneNode">{nodeEl}</span> : null}
    </span>
  );

  // One row of the selected change's file tree (recursive: directories
  // nest, files are leaves). A directory's row is its toggle; the rows keep
  // the change-file contract (data-files-change-file) so chip opens and the
  // tests can address them.
  const toggleFileDir = (path: string) => {
    setFoldedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const renderFileNode = (node: GroupNode): React.ReactNode => {
    if (node.kind === "file") {
      const c = node.change;
      const sel = selectedFile === c.path;
      return <li key={"f" + c.path} className="dswFiles_fileItem" data-files-change-file={c.path}>
        <button
          type="button"
          className={"dswFiles_changeFileRow" + (sel ? " dswFiles_changeFileRowSelected" : "")}
          aria-current={sel ? "true" : undefined}
          onClick={() => { pendingSelRef.current = null; setSelectedFile(c.path); }}
          title={c.oldPath ? c.oldPath + " → " + c.path : c.path}
        >
          <span className={"dswFiles_badge dswFiles_badge" + c.status} aria-hidden="true">{c.status}</span>
          <span className="dswFiles_changeFileName">{pathPartsOf(c.path).name}</span>
        </button>
      </li>;
    }
    const open = !foldedDirs.has(node.path);
    return <li key={"d" + node.path} className="dswFiles_fileItem" data-files-change-dir={node.path}>
      <button
        type="button"
        className="dswFiles_changeDirRow"
        aria-expanded={open}
        onClick={() => toggleFileDir(node.path)}
        title={node.path}
      >
        {Icon(open ? "IconFolderOpenRegular" : "IconFolderCloseRegular", { className: "dswFiles_rowIcon" }, open ? "▣" : "▢")}
        <span className="dswFiles_changeDirName">{node.name}</span>
      </button>
      {open ? <ul className="dswFiles_changeFilesLevel">{node.children.map(renderFileNode)}</ul> : null}
    </li>;
  };

  // Every row — the working copy first, then the commits — renders through
  // this one map, so the two can't drift. The worktree entry is synthesized
  // from the head block: id = the worktree's change id (jj) / HEAD's sha
  // (git), "Editing" in the when slot (it has no author date — it is
  // happening now), the head's pills, and the description under the same
  // (empty) / (no description set) conventions as the commits.
  const wtEmpty = (vcsInfo?.changes ?? []).length === 0;
  const descOf = (empty: boolean, description: string): string =>
    empty
      ? (description ? t("files.emptyCommit") + " " + description : t("files.emptyCommit"))
      : (description || t("files.noDescription"));
  // key = the graph/React identity (the COMMIT id — a divergent change has
  // several rows sharing the change id); data = the selection identity (the
  // CHANGE id — data-files-change, the snapshot fetch, the agent ref token;
  // on a divergent change both rows select the same change, as jj does).
  type TreeRow = {
    key: string; data: string; id: string; idPrefix?: string; idRest?: string;
    pills: { bookmarks?: string[]; tags?: string[]; workspaces?: string[]; tracking?: VcsTracking[] };
    when: string; desc: string; hidden?: boolean; divergent?: boolean; conflict?: boolean; offset?: number;
    selected: boolean; select: () => void; title: string; glyph: string;
  };
  const treeRows: TreeRow[] = [];
  if (vcsInfo) {
    const h = vcsInfo.head;
    const id = h ? (h.changeId || h.id) : "";
    if (id) treeRows.push({
      key: WORKTREE_KEY, data: "worktree", id, idPrefix: h!.idPrefix, idRest: h!.idRest,
      pills: h!, when: t("files.editing"), desc: descOf(wtEmpty, h!.description ?? ""),
      hidden: h!.hidden, divergent: h!.divergent, offset: h!.offset,
      selected: revLive === null, select: () => setRevSel(null),
      title: t("files.worktreeRow") + " — " + id,
      // jj's log shows the working-copy node as @ (git has no such node).
      glyph: vcsInfo.backend === "git" ? "○" : "@",
    });
    for (const c of shownCommits) treeRows.push({
      key: c.commitId || c.id, data: c.id, id: c.id, idPrefix: c.idPrefix, idRest: c.idRest,
      // The root's empty description renders blank (not the "(empty)" marker):
      // it is the log's floor, not a real empty change, so the marker is noise.
      pills: c, when: c.root ? t("files.rootCommit") : whenOf(c.date, t), desc: c.root ? "" : descOf(!!c.empty, c.description),
      hidden: c.hidden, divergent: c.divergent, conflict: c.conflict, offset: c.offset,
      selected: revLive === c.id, select: () => setRevSel(c.id),
      title: c.root ? t("files.rootCommit") + " — " + c.id : [c.author, c.date].filter(Boolean).join(" · "),
      // Host-supplied jj glyph; git rows and stale listings fall back to ○.
      glyph: c.glyph || "○",
    });
  }
  // --filez-lanes (the lane count) drives the rows' content indent, clearing
  // the lane column.
  const changeTreeEl = vcsInfo && graph ? <div
      className="dswFiles_changeTree"
      role="listbox"
      aria-label={t("files.changeTree")}
      style={{ "--filez-lanes": String(graph.lanes) } as React.CSSProperties}
    >
      {treeRows.map((r, i) => (
        <button
          key={r.key}
          type="button"
          role="option"
          aria-selected={r.selected}
          className={"dswFiles_changeRow" + (r.selected ? " dswFiles_changeRowSelected" : "")}
          data-files-change={r.data}
          onClick={r.select}
          title={r.title}
        >
          <span className="dswFiles_rowLanes" aria-hidden="true">
            {(graph.rows[i] ? graph.rows[i].cells : []).map((cell, l) =>
              laneCell(cell, l, changeGlyph(r.glyph)))}
          </span>
          <span className="dswFiles_rowContent">
            <span className="dswFiles_changeLine">
              {/* jj renders the change id as the significant (unique)
                  prefix, highlighted, + the rest — the host supplies the
                  split; git rows (no stable-prefix concept) render the
                  plain short sha. */}
              <span className="dswFiles_changeId" title={r.id + (r.hidden || r.divergent ? "/" + (r.offset ?? 0) : "")}>
                {r.idPrefix
                  ? <><span className="dswFiles_changeIdSig">{r.idPrefix}</span><span className="dswFiles_changeIdRest">{r.idRest}</span></>
                  : r.id}
                {/* jj's change offset: a hidden or divergent change id
                    renders as `xyz/N` (N = the commit's position within the
                    change, newest = 0) — bold, like the CLI. */}
                {(r.hidden || r.divergent) && r.offset !== undefined
                  ? <span className="dswFiles_changeIdOff">{("/" + r.offset)}</span>
                  : null}
              </span>
              {pillsEl(r.pills)}
              <span className="dswFiles_changeWhen">{r.when}</span>
              {/* The CLI's commit labels (format_commit_labels): (hidden)
                  takes precedence over (divergent); (conflict) stacks. */}
              {r.hidden
                ? <span className="dswFiles_changeLabel dswFiles_changeLabelHidden">{t("files.hidden")}</span>
                : r.divergent
                  ? <span className="dswFiles_changeLabel dswFiles_changeLabelDivergent">{t("files.divergent")}</span>
                  : null}
              {r.conflict
                ? <span className="dswFiles_changeLabel dswFiles_changeLabelConflict">{t("files.conflictLabel")}</span>
                : null}
            </span>
            <span className="dswFiles_changeDesc">{r.desc}</span>
          </span>
        </button>
      ))}
      {logLoading
        ? <div className="dswFiles_logLoading" role="status">{t("files.loadingOlder")}</div>
        : null}
    </div>
    : null;

  // The selected change's changed files — its own pane below the movable
  // divider (directory-grouped, expanded by default). An empty set is a
  // state, not an error; a failing snapshot fetch is a NOTE, not an error
  // page (the tree beside it is still live).
  const filesListEl = vcsInfo
    ? (changeFiles && changeFiles.length > 0
      ? <ul className="dswFiles_changeFiles" role="list">
          {groupChangedFiles(changeFiles).map(renderFileNode)}
        </ul>
      : snapshotMode && commitChanges === null
        ? (snapshotErr
          ? <div className="dswFiles_note dswFiles_noteErr" data-files-snapshot-error>{snapshotErr}</div>
          : <div className="dswFiles_changeFilesLoading" data-files-change-files-loading>{t("files.loading")}</div>)
        : changeFiles && changeFiles.length === 0
          ? <div className="dswFiles_changeFilesEmpty" data-files-change-files-empty>{t("files.noFilesChanged")}</div>
          : null)
    : null;

  // The reload button clears the root listing and the latched dead-session
  // flag so a retry can re-resolve the session (a fresh one may have come up).
  const reload = () => {
    forceRef.current = true;
    setSessionGone(false);
    setWorktreeListing(null);
    setRootErr(null);
    snapshotRevRef.current = null;
    setSnapshot(null);
    setSnapshotErr(null);
    setSnapshotNonce((n) => n + 1);
  };

  // The nav column's header: the root path row (dim directory, full-ink
  // name), reload, and the nav-collapse HIDE control (the state pair's
  // RESTORE half lives in the diff pane, which is the still-visible region
  // then).
  const pathParts = rootPath ? pathPartsOf(rootPath) : null;
  const navHeader = <div className="dswFiles_header">
      <div className="dswFiles_path" data-files-path title={rootPath || undefined} ref={pathBoxRef}>
        <span className="dswFiles_pathText" ref={pathTextRef}>
          {pathParts
            ? <><span className="dswFiles_pathDirectory">{pathParts.directory}</span><span className="dswFiles_pathName">{pathParts.name}</span></>
            : <span className="dswFiles_pathDirectory">{t("view.files")}</span>}
        </span>
      </div>
      <button type="button" className="dswFiles_tool" onClick={reload} aria-label={t("files.reload")} title={t("files.reload")}>
        {Icon("IconRefreshOutline16", { size: 15 }, "⟳")}
      </button>
      <button
        type="button"
        className="dswFiles_navToggle"
        onClick={() => setCollapsed(true)}
        aria-label={t("files.hideNav")}
        title={t("files.hideNav")}
        aria-expanded="true"
        aria-controls={navId}
      >
        <NavChevron dir="right" size={14} />
      </button>
    </div>;

  const browsePane = sessionGone
    ? <div className="dswFiles_browsePane" id={navId}>
        {navHeader}
        {goneRetries < GONE_RETRY_MAX
          ? <div className="dswFiles_note" data-files-row="sessionRetrying">{t("files.sessionRetrying")}</div>
          : <div className="dswFiles_error">{t("files.sessionGone")}</div>}
      </div>
    : <div className="dswFiles_browsePane" id={navId}>
        {navHeader}
        {rootErr || !refListing
          ? <div className="dswFiles_tree" ref={navScrollRef}>
              {rootErr
                ? <div className="dswFiles_note dswFiles_noteErr" data-files-row="error">{rootErr}</div>
                : <div className="dswFiles_note" data-files-row="loading">{t("files.loading")}</div>}
            </div>
          : !vcsInfo
            ? <div className="dswFiles_tree" ref={navScrollRef}>
                {/* Non-VCS workspace: the change tree (the pivot's core)
                    has nothing to show — a single pane, no split. Wait for
                    the first listing so the note doesn't flash during the
                    load; the handoff opens the OFFICIAL file viewer (the
                    destination for plain browsing). Absent without the
                    right-column tab actions (pre-0.1.5 conversation
                    surface). */}
                <div className="dswFiles_noVcs" data-files-no-vcs>
                  <span className="dswFiles_noVcsText">{t("files.noVcs")}</span>
                  <span className="dswFiles_noVcsHint">{t("files.noVcsHint")}</span>
                  {tabActions
                    ? <button type="button" className="dswFiles_noVcsBtn" data-files-open-files-tab onClick={() => tabActions.openTab("files")}>{t("files.noVcsBtn")}</button>
                    : null}
                </div>
              </div>
            : <div className="dswFiles_panes">
                {/* The change log: its own scroll region at the top, its
                    height the user-controlled treeH (null = the 240px CSS
                    default). The tree never unmounts when a change is
                    selected — only the file pane below re-loads. */}
                <div
                  className="dswFiles_logPane"
                  ref={logPaneRef}
                  style={typeof treeH === "number" ? { height: treeH + "px" } : undefined}
                >
                  <div className="dswFiles_tree" ref={navScrollRef}>
                    {changeTreeEl}
                  </div>
                </div>
                <div
                  className="dswFiles_hDivider"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("files.resizeTree")}
                  onPointerDown={startTreeDrag}
                  onDoubleClick={() => setTreeH(null)}
                />
                {/* The changed files: fill the rest of the nav column. */}
                <div className="dswFiles_filesPane">
                  <div className="dswFiles_filesPaneHead" data-files-files-pane-head>
                    {t("files.changedFiles")}{changeFiles ? " · " + String(changeFiles.length) : ""}
                  </div>
                  <div className="dswFiles_filesScroll">{filesListEl}</div>
                </div>
              </div>}
      </div>;

  // The collapsed preference takes effect only while a file is viewed (or one
  // is still pending apply, so a restored session hides from the first render
  // without a flash): with nothing to show in the diff pane, the nav column
  // is the only way to pick a file, so it stays expanded.
  const navHidden = collapsed && (selectedFile !== null || pendingSelRef.current !== null);

  // Restore the nav column's scroll position and keep tracking it. Re-runs
  // when the nav column appears or disappears so the listener re-attaches to
  // the freshly rendered scroll element; while hidden the ref is null and
  // this is a no-op.
  React.useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const cached = navCacheGet(sessionId)?.navScroll ?? 0;
    if (cached > 0) el.scrollTop = cached;
    const onScroll = () => {
      navCacheSet(sessionId, { navScroll: el.scrollTop });
      // The scroll auto-load: within 48px of the bottom, fetch the next page
      // of the change log (a no-op once exhausted / a load is in flight).
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) loadMoreRef.current();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // The scroll element remounts when the pane structure switches (loading
    // note → split panes → non-VCS note), so the listener must re-attach.
  }, [sessionId, navHidden, refListing === null, vcsInfo === null]);

  return <div className="dswFiles_root">
    <div className={"dswFiles_body" + (navHidden ? " dswFiles_bodyNavHidden" : "")} ref={bodyRef}>
      <div className="dswFiles_previewPane" role="region" aria-label={t("view.changestab")} aria-live="polite">
        <PreviewPane
          name={selectedFile ? pathPartsOf(selectedFile).name : null}
          relPath={selectedFile}
          status={selStatus}
          base={revLive || "worktree"}
          fetchDiff={props.fetchDiff}
          t={t}
          useInput={props.useInput ?? null}
          inputActions={props.inputActions ?? null}
          openInFiles={openInFiles}
          navCollapsed={navHidden}
          onToggleNav={() => setCollapsed(!collapsed)}
          navId={navId}
        />
      </div>
      {navHidden ? null : <div
        className="dswFiles_divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startDrag}
        onDoubleClick={() => setNavW(null)}
      />}
      {navHidden ? null : browsePane}
    </div>
  </div>;
}

// ── Right column: a sibling of the stock file browser ──────────────────────
// changestab registers its OWN tab kind (`changestab`) NEXT TO the stock builtin
// `files` page (dsh-client-ui-sidebar-files) and its `text` file viewer
// (dsh-client-ui-sidebar-documentpreview). The registry's shadowing is per
// KIND — one kind holds at most one in-force extension — so two
// implementations coexist only under distinct kinds. The stock stack stays
// fully intact: its guide capsule, its tree, and its one-tab-per-file opens
// (`dsh-resource://file/…` claimed by the stock viewer on the fallback
// band). Both guide capsules show, and both page tabs can be open at once.
//
// changestab is a PAGE type: no patterns, no claims. A file open (a chat file
// chip, a "Files changed" row, the stock tree) routes to the stock viewer,
// NOT here. Capturing those opens is a possible follow-up option: re-register
// this type with patterns: ["dsh-resource://file/**"] (the extension band
// outranks the stock fallback viewer) and the TRANSIENT FRAME below takes
// over — it re-opens the page with {path, line} navigation params (the page
// tab dedupes within its pane, so the single view is revealed and navigated)
// and then closes itself.
//
// defaultSeed resolves the column's first page to the SOLE guide entry, or
// the guide page when there are several: with the stock `files` entry
// present, a fresh pane seeds on the guide, where both capsules sit.
const CHANGESTAB_TAB_ID = "changestab";
const CHANGESTAB_KIND = "changestab";   // its own kind — a sibling of the stock "files", not a shadow
const FILE_ADDRESS_PREFIX = "dsh-resource://file/";

interface ParsedFileAddress {
  scope: "session";
  sessionId: string;
  path: string;
}
// Read a file address back into its parts. Only the SESSION-scoped shape is
// usable here — the right column is per-session, so an `absolute` address is
// not one this type can browse. Segments are decoded, mirroring how the
// address was built; a malformed address is simply not this type's.
function parseFileAddress(address: string): ParsedFileAddress | null {
  if (!address.startsWith(FILE_ADDRESS_PREFIX)) return null;
  try {
    const end = address.search(/[?#]/);
    const parts = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split("/");
    if (parts[0] !== "session") return null;
    const id = parts[1];
    const segments = parts.slice(2);
    if (!id || segments.length === 0) return null;
    return { scope: "session", sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join("/") };
  } catch { return null; }
}
function fileAddressBasename(address: string): string {
  const name = address.slice(address.lastIndexOf("/") + 1);
  if (name === "") return address;
  try { return decodeURIComponent(name); } catch { return name; }
}

// The tab information hook the right-column slot framework binds: the live
// record of the tab this body occurrence draws.
interface RightTabRecord {
  contentId: string;
  title: string;
  navigation: { address: string; params: unknown; revision: number };
  signal: AbortSignal;
  actions: {
    openTab(kind: string, options?: { params?: unknown }): void;
    openResource(address: string, options?: { params?: unknown }): void;
    close(): void;
  };
}
type UseTabInfo = () => { tab: RightTabRecord };

// One <use> of the mounted sprite per visible glyph (see mountIconSprite);
// currentColor still cascades through the <use>, so the glyph follows the
// chip's ink.
const ChangestabGlyph: React.ComponentType<{ size?: number; className?: string }> = (props) => {
  const size = props.size || 16;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={props.className} aria-hidden="true">
      <use href="#changestab-branches" />
      <use href="#changestab-knife" />
    </svg>
  );
};

// The Changes tab's chip: the brand glyph beside the title (the stock files
// chip's shape — the host wraps the slot's children in its title span).
function ChangestabTitle({ useTabInfo }: { useTabInfo: UseTabInfo }) {
  const { tab } = useTabInfo();
  return (
    <>
      <ChangestabGlyph size={16} className="dswFiles_tabTitleIcon" />
      {tab.title}
    </>
  );
}

interface RightPaneBodyProps {
  useTabInfo: UseTabInfo;
  sessionId: string | null;
  listDirectory: (relPath: string, signal: AbortSignal, showHidden: boolean, force: boolean, rev: string | null) => Promise<Listing>;
  fetchDiff: (relPath: string, base: string, signal: AbortSignal, opts?: { noBinary?: boolean }) => Promise<DiffResponse>;
  fetchLogPage?: (offset: number, limit: number, signal: AbortSignal) => Promise<LogPage>;
  tick: (dirs: string[], openFile: string | null, openMtime: number | null, deep: boolean, showHidden: boolean, signal: AbortSignal) => Promise<TickResponse>;
  t: TFunc;
  // The composer's input face, standard props of this slot (the framework
  // passes them alongside the inject result): the draft read (so the append
  // lands after the existing text) and setDraft (the insert action).
  useInput?: ((sel: (s: { draft: string }) => string) => string) | null;
  inputActions?: { setDraft(text: string): void } | null;
}

// One tab of the `changestab` type. The page (`sidebar://changestab`) IS the
// single changestab view: an openTab navigation with {path, line} params lands
// here. A resource address — only reachable when this type CLAIMS them (the
// capture option, see the section note) — is the transient frame: it
// redirects into the page and closes itself, rendering nothing meanwhile.
function RightPaneBody(props: RightPaneBodyProps) {
  const { tab } = props.useTabInfo();
  const file = parseFileAddress(tab.navigation.address);
  // Redirect only a resource open of THIS session's files: the page's face is
  // bound to the slot's session, and a cross-session address would read the
  // wrong workspace (chat chips carry their own session's files, so the
  // mismatch is not expected to occur).
  const redirectKey = file !== null && file.sessionId === props.sessionId ? tab.navigation.revision : null;
  const redirectedRef = React.useRef<number | null>(null);
  const params = (tab.navigation.params && typeof tab.navigation.params === "object"
    ? tab.navigation.params : null) as { path?: unknown; line?: unknown } | null;
  const openRequest = React.useMemo(() => {
    if (redirectKey !== null) {
      // The resource frame: derive the open from the resource address itself
      // (the page's params carry the same value after the redirect). Rendering
      // the view here — restored from the nav cache — keeps the pane from
      // flashing blank while the redirect settles.
      const line = params && typeof params.line === "number" ? params.line : undefined;
      return { path: file!.path, ...(line !== undefined ? { line } : {}), revision: tab.navigation.revision };
    }
    if (!params || typeof params.path !== "string") return null;
    return { path: params.path, ...(typeof params.line === "number" ? { line: params.line } : {}), revision: tab.navigation.revision };
  }, [redirectKey, file, params, tab.navigation.revision]);
  React.useEffect(() => {
    if (redirectKey === null || redirectedRef.current === redirectKey) return;
    redirectedRef.current = redirectKey;
    const line = params && typeof params.line === "number" ? params.line : undefined;
    tab.actions.openTab(CHANGESTAB_KIND, { params: { path: file!.path, ...(line !== undefined ? { line } : {}) } });
    tab.actions.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectKey]);
  return <FilesView
    sessionId={props.sessionId}
    listDirectory={props.listDirectory}
    fetchDiff={props.fetchDiff}
    fetchLogPage={props.fetchLogPage}
    tick={props.tick}
    t={props.t}
    useInput={props.useInput ?? null}
    inputActions={props.inputActions ?? null}
    tabActions={tab.actions}
    openRequest={openRequest}
  />;
}

// A minimal structural view of the cordis client context. The real types
// live in @deepseek-ai/dsh-client-runtime, which the web shell resolves at
// runtime (not a changestab build dependency).
interface ChangestabLocale {
  register(ns: string, dicts: Record<string, Record<string, string>>): void;
  bind(ns: string): TFunc;
}
interface ChangestabConnection {
  rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> };
}
interface ChangestabSlots {
  inject(name: string, cb: () => unknown): void;
  register(meta: Record<string, unknown>, component: unknown): void;
}
interface ChangestabSidebarRightTabs {
  register(def: Record<string, unknown>): () => void;
}
interface ChangestabContext {
  effect(execute: () => unknown, label?: string): void;
  locale: ChangestabLocale;
  connection: ChangestabConnection;
  slots: ChangestabSlots;
  /** The right column's tab-type registry (dsh 0.1.5+). Present: the column
      is the Files surface and changestab mounts only its right-column page
      (the conversation Files tab is not registered). Absent on a host
      without the column's tab system: the conversation tab alone remains. */
  sidebarRightTabs?: ChangestabSidebarRightTabs;
}

function apply(ctx: ChangestabContext): void {
  injectCss();
  mountIconSprite();
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-files: dictionaries");
  const t = ctx.locale.bind(NS);
  const connection = ctx.connection;
  // The browse face, bound to one session id: every RPC payload carries it,
  // and the host containment-checks every path against that session's
  // workspace. The conversation tab (pre-0.1.5 hosts) and the right-column
  // page (0.1.5+ hosts) share it — exactly one of the two is mounted.
  const browseFace = (sessionId: string | null) => ({
    sessionId,
    listDirectory: (relPath: string, signal: AbortSignal, showHidden: boolean, force: boolean, rev: string | null) =>
      connection.rpc.call(BROWSE_CHANNEL, "list", { sessionId, relPath, showHidden, force: force === true, ...(rev ? { rev } : {}) }, signal)
        .then((v) => unwrap<Listing>(v)),
    fetchDiff: (relPath: string, base: string, signal: AbortSignal, opts?: { noBinary?: boolean }) =>
      connection.rpc.call(BROWSE_CHANNEL, "diff", { sessionId, relPath, base, ...(opts && opts.noBinary ? { noBinary: true } : {}) }, signal)
        .then((v) => unwrap<DiffResponse>(v)),
    // The change log's scroll auto-load: one page beyond the first. A short
    // or empty page (or a host without the endpoint) ends the log.
    fetchLogPage: (offset: number, limit: number, signal: AbortSignal) =>
      connection.rpc.call(BROWSE_CHANNEL, "log", { sessionId, offset, limit }, signal)
        .then((v) => unwrap<LogPage>(v)),
    // The live-update heartbeat (the host's stat gate; deep skips it). The
    // open file is the diff, refreshed by the fresh listing's VCS block, so
    // no per-file content epoch is requested.
    tick: (dirs: string[], openFile: string | null, openMtime: number | null, deep: boolean, showHidden: boolean, signal: AbortSignal) =>
      connection.rpc.call(BROWSE_CHANNEL, "tick", { sessionId, dirs, showHidden, deep,
        ...(openFile ? { openFile, ...(openMtime !== null ? { openMtime } : {}) } : {}) }, signal)
        .then((v) => unwrap<TickResponse>(v)),
    t,
  });
  // The conversation Files tab — the surface on hosts without the right
  // column (pre-0.1.5). On 0.1.5+ the column is the Files surface (below),
  // so the tab stays unregistered and only one Files view exists.
  if (!ctx.sidebarRightTabs) {
    ctx.slots.inject("conversation.view", () => ctx.slots.register({
      name: "conversation.view",
      id: "files",
      order: 20,
      locale: NS,
      label: () => t("view.files"),
      inject: (sessionId: string | null) => browseFace(sessionId),
    }, FilesView));
  }
  // The right-column sibling type (see the section note above): register the
  // type, then the keyed body that serves every tab of the kind.
  if (ctx.sidebarRightTabs) {
    ctx.effect(() => ctx.sidebarRightTabs!.register({
      id: CHANGESTAB_TAB_ID,
      kind: CHANGESTAB_KIND,
      // A PAGE type: no patterns, no canOpen — the stock file viewer keeps
      // every dsh-resource://file/… open (see the section note for the
      // capture option). No priority either: the default extension band is
      // the documented position of an out-of-product type, and there is no
      // builtin on this kind to outrank.
      title: (address: string) => parseFileAddress(address) ? fileAddressBasename(address) : t("view.changestab"),
      guide: [{
        order: 10,
        title: () => t("files.guideTitle"),
        description: () => t("files.guideDescription"),
        icon: ChangestabGlyph,
      }],
    }), "ui-files: right column type");
    ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
      name: "sidebar.right.pane.tab",
      key: CHANGESTAB_TAB_ID,
      locale: NS,
      inject: (sessionId: string | null) => browseFace(sessionId),
    }, RightPaneBody)), "ui-files: right column body");
    ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
      name: "sidebar.right.pane.tab.title",
      key: CHANGESTAB_TAB_ID,
    }, ChangestabTitle)), "ui-files: right column tab title");
  }
}

export const inject: string[] = ["slots", "locale", "connection", "sidebarRightTabs"];
export const name = "changestab";
export { apply };
// Test-only seam. The cordis loader ignores it (it reads apply/inject/name
// only). This export exposes the pure preview helpers so
// test/client.test.mjs can unit-test them.
export const __test = { groupChangedFiles, typeLabel, formatBytes, loadState, saveState, parseDiff, displayRows, gapAfter, glyphTone, changeGlyph, refPillList, refPillCount, whenOf, navCacheSet, navCacheGet, navCacheDrop, DiffView, unifiedCells, unifiedPairs, intraLineDiff, intraTokens, realPathOf, unwrap, isSessionGone, rpcErrorText, buildFileRef, mentionOf, diffSelRange, REF_TEXT_MAX, parseFileAddress, fileAddressBasename, diffLayoutNarrow, commitRefToChat, sessionFileAddress, RightPaneBody, PreviewPane, pathPartsOf, layoutChangeGraph, WORKTREE_KEY, GONE_RETRY_MAX, goneRetryDelay };

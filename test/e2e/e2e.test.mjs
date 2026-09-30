// test/e2e/e2e.test.mjs, end-to-end journeys against a sandboxed dsh instance
// driven by a real headless browser (playwright-core + a playwright chromium).
//
// Scope: the Changes view journeys J1, J1.2, J8, J19, J20, J21, J22, J23, J24 (each
// defined by its section header below). On 0.1.5+ the Files view is the dsh RIGHT
// PANE (the conversation area has no Files tab), so openSession opens that pane via
// the host's own expand button. changestab registers its OWN "changestab" tab kind
// alongside the stock "files" page (sibling mode), so the pane seeds on the guide
// page and clickFilesTab picks the Changes capsule.
// The workspace picker and the send-a-message session flow are dsh's own UI;
// here they are automation helpers, not code under test.
//
// Isolation: a scratch DSH_HOME (copy of the real web profile + settings.yaml,
// empty session store), a free port (--port 0), fresh fixtures. The dsh child
// and the scratch tree are removed on exit. The real DSH_HOME and any running
// GUI are never touched.
//
// Cost: the released UI only builds a session's conversation pane (with the
// view tabs) once a turn exists, so each workspace under test costs one small
// "hello" agent turn on the model route in settings.yaml.
//
// Prereqs: dsh and jj on PATH; a playwright chromium (~/.cache/ms-playwright,
// newest build) or E2E_CHROME=/path/to/chrome; changestab dist/ built (npm test).
//
// Run: npm run e2e  -- intentionally separate from npm test (it needs a
// browser, a live model route, and the dsh CLI; the unit suites stay hermetic).

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DSH_BIN = process.env.E2E_DSH || "dsh";

// BRITTLE, on purpose: pinned to the dsh build this e2e was written against.
// openSession() drives dsh's OWN UI (the workspace picker's hashed CSS-module
// classes, the "Add workspace"/"Send message" button labels) -- that is not a
// stable contract. When dsh is bumped this check fails on purpose: rework the
// selectors against the new UI first, then bump DSH_VERSION.
// Re-verified for 0.1.7-rc.2: .ZuhsRW_crumbEditZone (directory picker) and
// .uV2eYG_input (composer) keep their hashes; the dialog "Open" button needs
// exact: true (a new "Open right sidebar" toggle shares the name prefix);
// and the right pane's OPEN state is now RESTORED across a full reload
// (ensurePaneOpen waits for either outcome).
// Re-verified for 0.2.0-rc.1: zero selector changes — both hashed classes
// (they live in lazy chunks, not the main bundle) and every role/data-attr
// selector still resolve; the host also gained a plugin peerDependency
// gate (see the dsh-image-settings skip in boot logs).
// Re-verified for 0.2.0-rc.2: both hashed classes
// (.ZuhsRW_crumbEditZone, .uV2eYG_input) and the Add workspace / Send
// message labels still resolve in the published build; no selector changes.
const DSH_VERSION = "0.2.0-rc.2";
function checkDshVersion() {
  const actual = execFileSync(DSH_BIN, ["--version"], { encoding: "utf8" }).trim();
  assert.equal(actual, DSH_VERSION, `dsh version changed (${actual} != ${DSH_VERSION}): the e2e session-opening selectors ride on dsh's own UI and need reworking -- re-verify against the new build, then bump DSH_VERSION.`);
}
const OUT_DIR = join(REPO_ROOT, "test", "e2e", "out");
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64");

let assertions = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); assertions++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); assertions++; };
const match = (s, re, msg) => { assert.match(String(s), re, msg); assertions++; };

// ── environment ────────────────────────────────────────────────────────────

function makeScratchHome(root) {
  const real = process.env.DSH_HOME || join(process.env.HOME, ".dsh");
  const home = join(root, "home");
  mkdirSync(join(home, "profiles"), { recursive: true });
  cpSync(join(real, "profiles", "web"), join(home, "profiles", "web"), { recursive: true });
  // The profile's node_modules hold the project workspaces it links in.
  // Copied symlinks break (relative targets), and package.json declares the
  // exact link: targets, so re-link each one absolutely.
  const nm = join(home, "profiles", "web", "node_modules");
  const deps = JSON.parse(readFileSync(join(home, "profiles", "web", "package.json"), "utf8")).dependencies ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== "string" || !spec.startsWith("link:")) continue;
    const link = join(nm, name);
    rmSync(link, { force: true });
    symlinkSync(spec.slice("link:".length), link, "dir");
  }
  if (existsSync(join(real, "settings.yaml"))) {
    cpSync(join(real, "settings.yaml"), join(home, "settings.yaml"));
  }
  return home;
}

function makeFixtures(root) {
  const fx = { root: join(root, "fixtures") };
  // F-JJ: one commit with CONTENT (base.txt — so a commit row can be
  // selected into commit mode with a real file list + diff) + a dirty
  // worktree (described "base") with 4 unadded files, incl. a nested dir
  // (the grouping) and a 2 MB random binary.
  fx.fj = join(fx.root, "fj");
  mkdirSync(join(fx.fj, "sub"), { recursive: true });
  execFileSync("jj", ["git", "init"], { cwd: fx.fj });
  // Written BEFORE `jj new`: it lands in the FIRST (undescribed) change,
  // which the `jj new -m base` step leaves behind as the one commit row.
  writeFileSync(join(fx.fj, "base.txt"), "the base\n");
  execFileSync("jj", ["new", "-m", "base"], { cwd: fx.fj });
  writeFileSync(join(fx.fj, "a.txt"), "one\ntwo\n");
  writeFileSync(join(fx.fj, "sub", "nested.txt"), "x");
  writeFileSync(join(fx.fj, "pic.png"), PNG_1X1);
  writeFileSync(join(fx.fj, "big.bin"), randomBytes(2_000_000));
  // F-PLAIN: no VCS at all (J1.2).
  fx.plain = join(fx.root, "plain");
  mkdirSync(fx.plain, { recursive: true });
  writeFileSync(join(fx.plain, "hi.txt"), "hi\n");
  // F-JJ-20: J20's own fresh jj session — a FIRST mount of the Files view
  // (no nav cache, no earlier journey on the page), the exact case where a
  // dead tick interval stays dead. Kept separate from fj so J20's disk
  // mutations (a.txt edit, fresh.txt) can't disturb the pinned fj journeys.
  fx.fj20 = join(fx.root, "fj20");
  mkdirSync(fx.fj20, { recursive: true });
  execFileSync("jj", ["git", "init"], { cwd: fx.fj20 });
  execFileSync("jj", ["new", "-m", "base"], { cwd: fx.fj20 });
  writeFileSync(join(fx.fj20, "a.txt"), "one\ntwo\n");
  // F-JJ-FORK: J23's branching — the shape a user actually reported: `base`
  // FORKS into `fork child 1` (the off-path branch, a leaf that never
  // re-enters the worktree's lineage) and `fork child 2` (the worktree side).
  // The working copy sits ON fork child 2. Under the old `ancestors(@-)`
  // revset fork child 1 was pruned entirely (it is no ancestor of @); under
  // jj's own default log scope — `builtin_log() ~ @`, what a plain `jj log`
  // shows — it renders on its own lane next to its sibling. Each change
  // tracks its own file so the snapshot file list has content. Divergence
  // (the /N offsets + (divergent) labels) is deliberately NOT built here: jj
  // auto-hides the commits a divergence would need, so that rendering is
  // unit-tested.
  fx.fjf = join(fx.root, "fjf");
  mkdirSync(fx.fjf, { recursive: true });
  execFileSync("jj", ["git", "init"], { cwd: fx.fjf });
  writeFileSync(join(fx.fjf, "base.txt"), "the base\n");
  execFileSync("jj", ["file", "track", "base.txt"], { cwd: fx.fjf });
  execFileSync("jj", ["describe", "-r", "@", "-m", "base"], { cwd: fx.fjf });
  execFileSync("jj", ["bookmark", "create", "base"], { cwd: fx.fjf });
  // The off-path branch: a child of base, no descendants on the worktree path.
  execFileSync("jj", ["new", "-m", "fork child 1"], { cwd: fx.fjf });
  writeFileSync(join(fx.fjf, "c1.txt"), "child one\n");
  execFileSync("jj", ["file", "track", "c1.txt"], { cwd: fx.fjf });
  execFileSync("jj", ["bookmark", "create", "c1"], { cwd: fx.fjf });
  // The worktree side: the other child of base; the working copy stays here.
  execFileSync("jj", ["new", "-r", "base", "-m", "fork child 2"], { cwd: fx.fjf });
  writeFileSync(join(fx.fjf, "c2.txt"), "child two\n");
  execFileSync("jj", ["file", "track", "c2.txt"], { cwd: fx.fjf });
  execFileSync("jj", ["bookmark", "create", "c2"], { cwd: fx.fjf });
  // F-JJ-LOG: J24's pagination — a jj repo with MORE than one page of commits
  // (54 real + the root = 55 rows), so the first page (the host's 50) leaves
  // 5 to auto-load on scroll (4 commits + the root, the log's floor).
  // `jj commit` (not `jj new`) keeps @ a fresh worktree, so the visible log
  // (the `~ @` revset) is exactly log-c1..log-c54 + the root, newest first.
  // Each commit modifies f.txt so it is a REAL (non-empty) change — an empty
  // commit's description renders with an `(empty)` prefix, which would break
  // the plain-description assertions.
  fx.fjlog = join(fx.root, "fjlog");
  mkdirSync(fx.fjlog, { recursive: true });
  execFileSync("jj", ["git", "init"], { cwd: fx.fjlog });
  for (let i = 1; i <= 54; i++) {
    writeFileSync(join(fx.fjlog, "f.txt"), "line " + i + "\n");
    execFileSync("jj", ["commit", "-m", "log-c" + i], { cwd: fx.fjlog });
  }
  return fx;
}

function bootDsh(home) {
  return new Promise((res, rej) => {
    const child = spawn(DSH_BIN, ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"], {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rej(new Error("dsh boot timeout:\n" + log.join("").slice(-3000)));
    }, 90_000);
    const stop = () => {
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => clearTimeout(killer));
    };
    child.stdout.on("data", (d) => {
      log.push(d.toString());
      process.stdout.write(d.toString());
      // 0.1.5 prints the browser URL with a one-time-auth token; the token
      // exchanges for a persistent signed cookie on first load, and a fresh
      // context (no cookie) re-uses the same token, so keep the FULL url.
      const m = d.toString().match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\S+)/);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        res({ port: Number(m[1].match(/:(\d+)/)[1]), url: m[1], stop });
      }
    });
    child.stderr.on("data", (d) => {
      log.push(d.toString());
      process.stderr.write(d.toString());
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rej(new Error(`failed to start ${DSH_BIN}: ${e.message}`));
    });
  });
}

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const cache = join(process.env.HOME, ".cache", "ms-playwright");
  if (existsSync(cache)) {
    const dirs = readdirSync(cache)
      .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
      .sort();
    for (let i = dirs.length - 1; i >= 0; i--) {
      const p = join(cache, dirs[i], "chrome-linux64", "chrome");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("no chromium found: run `npx playwright install chromium` or set E2E_CHROME");
}

// ── browser driver ─────────────────────────────────────────────────────────

// One fresh context = one clean landing state, so every workspace opens the
// same "Choose workspace" hero flow regardless of what earlier sessions did.
async function openSession(browser, { url, workspace }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const session = { context, page, errors: [], pageErrors: [] };
  page.on("pageerror", (e) => session.pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") session.errors.push(m.text()); });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    // "Add workspace" is present on both the initial landing and post-session heroes,
    // whereas "Choose workspace" only appears when no workspace is yet selected.
    await page.getByRole("button", { name: "Add workspace" }).click({ timeout: 15_000 });
    const dialog = page.locator('[class*="_dialog_"]').first();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    // The picker's Miller-columns navigation is slow to script; its crumb-bar
    // path editor jumps straight to an absolute path.
    await dialog.locator(".ZuhsRW_crumbEditZone").click();
    const input = dialog.locator("input").last();
    await input.waitFor({ state: "visible", timeout: 5000 });
    await input.fill(workspace);
    await input.press("Enter");
    await page.waitForTimeout(1200);
    // exact: 0.1.7 added an "Open right sidebar" toggle whose accessible name
    // starts with "Open"; a substring match resolves to both.
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.waitForTimeout(3000);
    // A session only gets its conversation pane (with the view tabs) once a
    // turn exists; send one. This is the one real model call per workspace.
    // 0.1.5: the composer is a contenteditable div (not a textarea) and the
    // conversation view tabs (Chat / Trajectory) mount after the first turn.
    const ta = page.locator(".uV2eYG_input").last();
    await ta.waitFor({ state: "visible", timeout: 15_000 });
    await ta.click();
    await ta.pressSequentially("hello");
    await page.getByRole("button", { name: "Send message" }).click();
    // 0.1.5: the Files surface is the dsh RIGHT PANE, not a conversation tab
    // (the conversation area no longer registers a Files tab). The first turn
    // builds the conversation pane; the right pane is collapsed and is opened
    // by the host's own expand button in the conversation header corner.
    // Sibling mode: the pane seeds on the GUIDE page (the stock "files" entry
    // and changestab's), so clickFilesTab clicks the Changes capsule after the
    // expand. Poll (evaluate, not waitForFunction) to dodge the arg/options
    // positional trap.
    console.log(`openSession(${workspace.split("/").pop()}): hello sent, waiting for the conversation + right-pane expand button`);
    const t0 = Date.now();
    for (;;) {
      const ready = await page.evaluate(() => {
        const exp = document.querySelector('[data-sidebar-right-expand]');
        const conv = document.querySelector('[role="tablist"]');
        return !!conv && !!exp; // conversation built + pane collapsed
      }).catch(() => false);
      if (ready) break;
      if (Date.now() - t0 > 180_000) throw new Error("timeout waiting for the conversation + right-pane expand button");
      await page.waitForTimeout(500);
    }
    await page.locator('[data-sidebar-right-expand]').click();
  } catch (e) {
    // Capture the page state before closing the context, so a failure here
    // (driving dsh's own UI) is diagnosable after the scratch tree is gone.
    try {
      mkdirSync(OUT_DIR, { recursive: true });
      await page.screenshot({ path: join(OUT_DIR, `openSession-failure-${workspace.split("/").pop()}.png`) });
    } catch { /* the screenshot is best-effort */ }
    await context.close().catch(() => {});
    throw new Error(`openSession(${workspace}): ${e.message}`);
  }
  return session;
}

// 0.1.5+: there is no conversation Files tab — openSession opened the right
// pane. Sibling mode: the pane seeds on the guide page (two entries), so open
// the Changes capsule (the guide buttons carry the contributing kind as
// data-sidebar-right-guide-entry); if a host ever seeds the page directly
// (the capsule absent), the root is already up.
async function clickFilesTab(page) {
  const cap = page.locator('[data-sidebar-right-guide-entry="changestab"]');
  if (await cap.count()) {
    await cap.first().click();
  } else {
    // A page tab is already open (the guide page is gone): activate the
    // changestab PAGE TAB in the tab bar. The data-sidebar-right-tab span is
    // a ZERO-SIZE title-registration marker (clicking it hits whatever is
    // visually there); the clickable node is the dockkit tab (role=tab)
    // whose title span carries the exact tab label ("Changes" since 0.2.0).
    const tab = page.locator('[data-dockkit-tab]', {
      has: page.locator('[data-dockkit-tab-title]', { hasText: /^Changes$/ }),
    });
    if (await tab.count()) await tab.first().click();
  }
  await page.locator(".dswFiles_root").waitFor({ state: "visible", timeout: 20_000 });
}

// The Files view's stable, ours-namespace selectors.
function ui(page) {
  const root = () => page.locator(".dswFiles_root");
  // The selected change's changed-file list (0.2.0): file leaves are
  // li[data-files-change-file] — the only rows the view renders.
  const fileRow = (path) => root().locator(`li[data-files-change-file="${path}"] .dswFiles_changeFileRow`);
  const previewText = async () => (await root().locator(".dswFiles_previewPane").innerText().catch(() => "")) ?? "";
  const until = async (fn, what, ms = 15_000) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn()) return;
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for: ${what}`);
      await page.waitForTimeout(250);
    }
  };
  // 0.1.5 DROPPED the right pane's open state on a full reload (the host's
  // sidebar rebooted collapsed), so a reload had to click the host's expand
  // control. 0.1.7 RESTORES the pane (open, with its active tab), so after a
  // reload the Files view may simply come back and the expand control — which
  // only exists while the pane is collapsed — never renders. Wait for EITHER
  // outcome; click the control only in the old-behavior case.
  const ensurePaneOpen = async () => {
    const t0 = Date.now();
    for (;;) {
      if ((await root().count()) === 1) return; // restored open (or already open)
      const expand = page.locator('[data-sidebar-right-expand]');
      if ((await expand.count()) > 0) await expand.click();
      if (Date.now() - t0 > 30_000) throw new Error("timeout waiting for the Files view after reload");
      await page.waitForTimeout(500);
    }
  };
  return { page, root, fileRow, previewText, until, ensurePaneOpen };
}

function checkConsole(session, label) {
  const ours = session.errors.filter((t) => /filez|changestab|dswFiles/i.test(t));
  // A dsh host bug (dsh BUG-028), not changestab's: a full page reload re-runs
  // the client bundles' slot registration against a slot registry that
  // survives the reload, and dsh-client-ui-tool's keyed "read_image" toolview
  // entry throws. Filter the EXACT message (J19's reload step trips it) so a
  // fix upstream shows up here as a new, unfiltered page error.
  const dshReloadNoise = session.pageErrors.filter((t) =>
    t.includes('keyed slot "tool.call.toolview" already has an entry for key "read_image"'));
  const hostBugs = session.pageErrors.filter((t) =>
    !t.includes('keyed slot "tool.call.toolview" already has an entry for key "read_image"'));
  ok(hostBugs.length === 0, `no uncaught page errors (${label})\n` + hostBugs.join("\n").slice(0, 800));
  if (dshReloadNoise.length > 0) console.log(`e2e: ${label}: ${dshReloadNoise.length} dsh reload-registration page error(s) ignored (host bug, filtered)`);
  ok(ours.length === 0, `no changestab console errors (${label})\n` + ours.join("\n").slice(0, 800));
  const benign = session.errors.length - ours.length;
  if (benign > 0) console.log(`e2e: ${label}: ${benign} benign console error(s) ignored`);
}

// ── journeys (the journey section headers below) ───────────────────────────────────────

// J1: first look -- the change tree, the grouped changed-file list
// (directories expanded by default), the empty diff preview.
async function j1_firstLook(u) {
  const tree = u.root().locator(".dswFiles_changeTree");
  await u.until(async () => (await tree.count()) > 0, "change tree");
  const wt = u.root().locator('[data-files-change="worktree"]');
  const wtText = (await wt.innerText()).replace(/\n/g, " ");
  ok(wtText.includes("Editing"), `worktree row is labeled "Editing", got: ${wtText}`);
  ok(!((await wt.locator(".dswFiles_changeId").innerText()) || "").includes("@"), `the worktree id stays a bare change id, got: ${wtText}`);
  // The row renders through the commit rows' code: the jj change id
  // (two-tone) + "Editing" + the description — no aggregate decoration.
  eq(await wt.locator(".dswFiles_changeIdSig").count(), 1, "the worktree row shows the change id with its jj significant prefix");
  // The node character is jj's own working-copy glyph (@, the CLI's
  // builtin_log_node), styled as the wc tone.
  eq(await wt.locator(".dswFiles_changeGlyph_wc").count(), 1, "the worktree node character is jj's @ glyph");
  eq(await wt.locator(".dswFiles_changeGlyph_wc").innerText(), "@", "the worktree node renders the @ character");
  const firstCommit = u.root().locator('[data-files-change]:not([data-files-change="worktree"])').first();
  eq(await firstCommit.locator(".dswFiles_changeGlyph_normal").count(), 1, "a plain commit row carries jj's ○ node character");
  match(wtText, /Editing base/, `worktree row = id + "Editing" + the fixture's "base" description, got: ${wtText}`);
  // The changed-file list groups by directory: `sub` is a dir row (expanded
  // by default) BEFORE the root files, and `nested.txt` sits under it.
  const subDir = u.root().locator('li[data-files-change-dir="sub"]');
  eq(await subDir.count(), 1, "the sub dir row renders");
  eq(await subDir.locator("button.dswFiles_changeDirRow").getAttribute("aria-expanded"), "true", "directories start expanded");
  eq(await subDir.locator('li[data-files-change-file="sub/nested.txt"]').count(), 1, "nested.txt grouped under sub");
  // The dir row follows the stock file browser's pattern: the host's folder
  // icon (a real SVG — a missing icon name degrades to a box text glyph) and
  // no disclosure chevron.
  const dirBtn = subDir.locator("button.dswFiles_changeDirRow");
  eq(await dirBtn.locator("> svg").count(), 1, "the dir row renders the host folder SVG (icon name resolved, not the text fallback)");
  ok(!/[▢▣]/.test((await dirBtn.innerText()) || ""), "no box-glyph fallback in the dir row");
  const top = u.root().locator("ul.dswFiles_changeFiles > li");
  const topOrder = await top.evaluateAll((els) => els.map((e) => e.getAttribute("data-files-change-dir") || e.getAttribute("data-files-change-file")));
  eq(topOrder.join(","), "sub,a.txt,big.bin,pic.png", "root level: the dir first, then the files natural-sorted, got: " + topOrder.join(","));
  eq(await u.root().locator('li[data-files-change-file="a.txt"] .dswFiles_badgeU').count(), 1, "a.txt carries the U (unadded) badge");
  // The split panes: the change log (top, its own scroll region) over the
  // changed-file list (bottom), with the movable divider between.
  eq(await u.root().locator(".dswFiles_hDivider").count(), 1, "the log/files divider renders");
  match((await u.root().locator(".dswFiles_filesPaneHead").innerText()), /Changed files · 4/, "the files pane caption counts the selected change's files");
  // The graph: every row carries its lane column to the left of the text.
  eq(await tree.locator(".dswFiles_rowLanes").count(), 3, "worktree + commit + root rows each carry the lane column");
  // jj's two-tone id: the significant prefix highlighted, the rest dim —
  // the displayed id is the shortest(8) form (8..12 chars), the prefix is
  // its leading slice.
  const commitRow = tree.locator('button[data-files-change]:not([data-files-change="worktree"])').first();
  eq(await commitRow.locator(".dswFiles_changeIdSig").count(), 1, "the commit id carries the highlighted prefix span");
  const idText = ((await commitRow.locator(".dswFiles_changeId").innerText()) || "").trim();
  const sigText = ((await commitRow.locator(".dswFiles_changeIdSig").innerText()) || "").trim();
  ok(idText.length >= 8 && idText.length <= 12, "jj's shortest(8) id form is 8..12 chars, got: " + idText);
  ok(sigText.length >= 1 && sigText.length <= idText.length && idText.startsWith(sigText), "the highlighted prefix is the id's leading slice");
  const fullId = ((await commitRow.locator(".dswFiles_changeId").getAttribute("title")) || "").trim();
  eq(fullId.length, 12, "the title carries the full 12-char change id");
  ok(fullId.startsWith(idText), "the displayed shortest(8) form is the full id's leading slice");
  // The 0.1.x listing surface is gone: no footer bar, no browse tree.
  eq(await u.root().locator(".dswFiles_footerBar").count(), 0, "no footer bar (listing removed)");
  // The preview starts empty (diff-only).
  ok((await u.previewText()).includes("Select a changed file to view its diff"), "preview starts with the empty-diff note");
}

// J8: click → ref in the head row. A single click on a diff line morphs the
// head row into the EXACT pasteable token (no selection → no text), and the
// copy button puts that very string on the clipboard. A drag-selection
// supersedes the click ref — the selection ref carries the selected text.
// The insert commits the ref into the composer draft (exactly, deduped).
async function j8_clickRef(u) {
  const root = u.root();
  await u.fileRow("a.txt").click();
  await u.until(async () => (await root.locator(".dswFiles_diff").count()) === 1, "a.txt diff rendered");
  // At rest: the path (dim dir + name), no token, no copy button; the
  // Open-in-Files handoff IS present (plain viewing belongs to that tab).
  await u.until(async () => (await root.locator(".dswFiles_paneHeadPath").count()) === 1, "head row at rest");
  eq((await root.locator(".dswFiles_paneHeadPath").innerText()).trim(), "a.txt", "at rest shows the workspace-relative path");
  eq(await root.locator(".dswFiles_paneHeadToken").count(), 0, "no ref token at rest");
  eq(await root.locator(".dswFiles_paneHeadBtns button[aria-label='Copy ref']").count(), 0, "no copy button at rest");
  eq(await root.locator(".dswFiles_paneHeadBtns button[aria-label='Open in Files']").count(), 1, "the ↗ Open-in-Files handoff renders at rest");
  // Click line 1 of the diff (a new file: every line is an add, data-dn =
  // the worktree line number).
  const cell = root.locator('.dswFiles_diffCell[data-dn="1"]');
  await u.until(async () => (await cell.count()) === 1, "the first diff line cell");
  await cell.click();
  await u.until(async () => (await root.locator(".dswFiles_paneHeadToken").count()) === 1, "click on a line → the ref token in the head row");
  const token = await root.locator(".dswFiles_paneHeadToken").getAttribute("title");
  match(token, /^@a\.txt:\d+$/, `the head row shows the exact pasteable line ref, got: ${token}`);
  eq(await root.locator(".dswFiles_paneHeadBtns button[aria-label='Copy ref']").count(), 1, "with a ref the copy button renders");
  eq(await root.locator(".dswFiles_paneHeadBtns button[aria-label='Add ref to chat']").count(), 1, "with a ref the insert button renders");
  // The copy button puts that EXACT string on the clipboard.
  await u.page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(u.page.url()).origin });
  await root.locator(".dswFiles_paneHeadBtns button[aria-label='Copy ref']").click();
  eq(await u.page.evaluate(() => navigator.clipboard.readText()), token, "copy ref → the head row's exact token on the clipboard");
  // A drag-selection across lines 1–2 supersedes the click ref — the
  // selection ref ALWAYS carries the selected text.
  const c1 = await cell.boundingBox();
  const c2 = await root.locator('.dswFiles_diffCell[data-dn="2"]').boundingBox();
  await u.page.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2);
  await u.page.mouse.down();
  await u.page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2, { steps: 4 });
  await u.page.mouse.up();
  await u.until(async () => {
    const tk = await root.locator(".dswFiles_paneHeadToken").getAttribute("title").catch(() => null);
    return tk && tk.includes("-") && tk.includes('"');
  }, "drag → a range token with the selected text supersedes the click ref");
  const range = await root.locator(".dswFiles_paneHeadToken").getAttribute("title");
  match(range, /^@a\.txt:\d+-\d+ "[\s\S]*$/, `the selection ref is a range with the selected text, got: ${range}`);
  // COMMIT: the insert lands the exact ref in the composer, and a repeat
  // click is a no-op (the dedupe).
  await cell.click(); // a fresh click ref (the drag's selection is gone)
  await u.until(async () => {
    const tk = await root.locator(".dswFiles_paneHeadToken").getAttribute("title").catch(() => null);
    return tk === token;
  }, "the click ref is back (no selection → no text)");
  const insertBtn = root.locator(".dswFiles_paneHeadBtns button[aria-label='Add ref to chat']");
  const composer = () => u.page.locator("[data-composer-input]");
  await insertBtn.click();
  await u.until(async () => {
    const txt = await composer().textContent().catch(() => "");
    return (txt || "").includes(token);
  }, "the ref lands in the composer draft");
  eq(await composer().textContent(), token + " ", "the draft is exactly the ref + its trailing space");
  await insertBtn.click();
  await u.page.waitForTimeout(150);
  eq(await composer().textContent(), token + " ", "a repeat insert is a no-op (the dedupe)");
  // Switching the file clears the ref back to the at-rest path.
  await u.fileRow("big.bin").click();
  await u.until(async () => (await root.locator(".dswFiles_paneHeadPath").count()) === 1, "big.bin head row back at rest");
  eq((await root.locator(".dswFiles_paneHeadPath").innerText()).trim(), "big.bin", "file switch → at-rest path, no stale ref");
  eq(await root.locator(".dswFiles_paneHeadToken").count(), 0, "file switch clears the ref token");
}

// J21: commit selection (no list refresh) + Open in Files. The change tree
// is READ-ONLY: selecting a commit swaps only the file pane for that
// commit's changeset while the SAME tree element stays mounted (the old
// behavior re-mounted the whole list — visually jarring). The head row
// hands the viewed file off to the OFFICIAL file viewer.
async function j21_commitSelection(u) {
  const root = u.root();
  const tree = u.root().locator(".dswFiles_changeTree");
  await u.until(async () => (await tree.count()) > 0, "change tree");
  const commitRows = tree.locator('button[data-files-change]:not([data-files-change="worktree"])');
  eq(await commitRows.count(), 2, "the fixture's one commit + the root (the log's floor)");
  const commitRow = commitRows.first();
  const commitId = await commitRow.getAttribute("data-files-change");
  // Selecting the commit must NOT re-render the change list (the old
  // behavior re-fetched the root listing into snapshot mode and the whole
  // tree re-mounted — visually jarring). The SAME tree element must
  // survive the selection.
  const treeHandle = await tree.elementHandle();
  ok(treeHandle, "the change tree element exists before the selection");
  await commitRow.click();
  ok(await u.page.evaluate((el) => el.isConnected, treeHandle),
    "selecting a commit keeps the SAME change tree element MOUNTED (no list refresh)");
  eq(await tree.locator('button[data-files-change="worktree"]').getAttribute("data-files-change"), "worktree", "the worktree row is still the first row");
  // Selecting the commit row SWAPS the file pane for that commit's own
  // changeset: base.txt (the commit's content) and NOT the worktree's U
  // files (they belong to the change above).
  await u.until(async () => (await u.root().locator('li[data-files-change-file="base.txt"]').count()) === 1,
    "the commit's file list (base.txt) replaces the worktree's");
  eq(await u.fileRow("a.txt").count(), 0, "a worktree-only file is not in the commit's list");
  eq(await u.root().locator('li[data-files-change-file="base.txt"] .dswFiles_badgeA').count(), 1, "base.txt is an A (added) in the commit's changeset");
  match((await u.root().locator(".dswFiles_filesPaneHead").innerText()), /Changed files · 1/, "the caption counts the COMMIT's files");
  // Commit mode: the diff is against the commit's parent, and a click ref
  // pins the file AT the commit (the @<commit> part of the token).
  await u.fileRow("base.txt").click();
  await u.until(async () => (await root.locator(".dswFiles_diff").count()) === 1, "base.txt diff rendered (commit mode)");
  await u.until(async () => ((await root.locator(".dswFiles_diff").innerText().catch(() => "")) ?? "").includes("the base"),
    "commit-mode diff shows the committed content");
  const ccell = root.locator('.dswFiles_diffCell[data-dn="1"]');
  await u.until(async () => (await ccell.count()) === 1, "the first commit-mode diff line");
  await ccell.click();
  await u.until(async () => (await root.locator(".dswFiles_paneHeadToken").count()) === 1, "commit-mode click ref");
  const commitToken = await root.locator(".dswFiles_paneHeadToken").getAttribute("title");
  match(commitToken, new RegExp("^@base\\.txt@" + commitId + ":(\\d+)$"),
    "the commit-mode ref pins the file AT the commit, got: " + commitToken);
  // Restore the worktree selection before the file steps.
  await tree.locator('button[data-files-change="worktree"]').click();
  await u.until(async () => (await u.fileRow("a.txt").count()) === 1, "the worktree's file list is back");
  ok(await u.page.evaluate((el) => el.isConnected, treeHandle), "the same change tree element survived the whole commit selection round-trip");
  // Regression (the stuck-Loading report): the SECOND change selection
  // while the first one's snapshot is still loaded (commit → the log's
  // root, whose changeset is empty) used to hang on "Loading…" forever —
  // the fetch effect reset `snapshot`, one of its own deps, before
  // starting the fetch; the reset re-ran the effect, and that re-run's
  // cleanup aborted the just-started fetch while the ref guard blocked
  // the re-fetch. The root's empty changeset must land, and selecting
  // back to the commit must land again.
  await commitRows.nth(1).click();
  await u.until(async () => (await u.root().locator("[data-files-change-files-empty]").count()) === 1,
    "second selection (root, empty changeset) loads — no stuck Loading");
  await commitRow.click();
  await u.until(async () => (await u.root().locator('li[data-files-change-file="base.txt"]').count()) === 1,
    "selecting back to the commit loads its list again");
  // Leave the worktree selected for the Open-in-Files step (a.txt is
  // worktree-only).
  await tree.locator('button[data-files-change="worktree"]').click();
  await u.until(async () => (await u.fileRow("a.txt").count()) === 1, "the worktree's file list is back");
  // Open in Files: the head row's handoff opens the viewed file in the
  // OFFICIAL file viewer (a stock file tab for it in the right column).
  await u.fileRow("a.txt").click();
  await u.until(async () => (await u.root().locator(".dswFiles_paneHeadPath").count()) === 1, "a.txt head row at rest");
  const openBtn = u.root().locator(".dswFiles_paneHeadBtns button[aria-label='Open in Files']");
  eq(await openBtn.count(), 1, "the head row carries the Open-in-Files handoff (↗)");
  await openBtn.click();
  await u.until(async () => {
    const titles = await u.page.locator("[data-dockkit-tab-title]").allTextContents();
    return titles.some((t) => t.trim() === "a.txt");
  }, "a stock file tab for a.txt opens in the right column");
  // Restore the changestab page tab for the journeys that follow (the stock
  // file tab is now the right column's active tab, changestab's body unmounted).
  await clickFilesTab(u.page);
}

// J19: the nav column (the change tree + file list) collapses to give the
// diff the full width. The toggle is a STATE PAIR — exactly one control on
// screen at a time, one per state (the dsh host's right-pane pattern one
// level down): expanded → a HIDE button in the nav's own header; collapsed →
// a RESTORE button in the preview pane's top row. Collapsing unmounts the
// nav pane + divider and the preview goes flush to the pane's right edge.
// The collapsed state persists across a reload.
async function j19_collapse(u) {
  const hideBtn = u.root().locator(".dswFiles_header .dswFiles_navToggle");
  const restoreBtn = u.root().locator(".dswFiles_paneToggle .dswFiles_navToggle");
  // Journey precondition: a file viewed (the head row gives the pane its
  // width claim).
  await u.until(async () => (await u.fileRow("a.txt").count()) === 1, "a.txt listed (worktree changes)");
  await u.fileRow("a.txt").click();
  // Expanded state: the hide control sits in the nav's own header.
  await u.until(async () => (await hideBtn.count()) === 1, "hide control present in the nav header");
  eq(await restoreBtn.count(), 0, "no restore control while the nav is visible");
  eq(await hideBtn.getAttribute("aria-expanded"), "true", "hide control reports the nav expanded");
  eq(await u.root().locator(".dswFiles_browsePane").count(), 1, "nav pane visible initially");
  eq((await u.root().locator(".dswFiles_paneHeadPath").innerText()).trim(), "a.txt", "the viewed file's name rides in the head row");
  await hideBtn.click();
  await u.until(async () => (await u.root().locator(".dswFiles_browsePane").count()) === 0, "nav pane hidden when collapsed");
  eq(await u.root().locator(".dswFiles_divider").count(), 0, "divider hidden when collapsed");
  // Collapsed state: the restore control sits in the preview's top row.
  await u.until(async () => (await restoreBtn.count()) === 1, "restore control present in the preview top row");
  eq(await hideBtn.count(), 0, "no hide control while the nav is hidden");
  eq(await restoreBtn.getAttribute("aria-expanded"), "false", "restore control reports the nav collapsed");
  // The preview took the nav's place flush to the pane's right edge.
  const pb = await u.root().locator(".dswFiles_previewPane").boundingBox();
  const rb = await u.root().boundingBox();
  ok(Math.abs((pb.x + pb.width) - (rb.x + rb.width)) <= 1, "preview pane flush at the pane's right edge when collapsed");
  await restoreBtn.click();
  await u.until(async () => (await u.root().locator(".dswFiles_browsePane").count()) === 1, "nav pane restored");
  // Persistence: collapse, reload, still collapsed (the restored selection
  // keeps the preference in force from the first render).
  await hideBtn.click();
  await u.until(async () => (await u.root().locator(".dswFiles_browsePane").count()) === 0, "collapsed again");
  await u.page.reload({ waitUntil: "domcontentloaded" });
  await u.ensurePaneOpen();
  eq(await u.root().locator(".dswFiles_browsePane").count(), 0, "collapsed state survives reload");
  await u.until(async () => (await restoreBtn.count()) === 1, "restore control back (selection restored)");
  // Leave it expanded for any later journeys.
  await restoreBtn.click();
  await u.until(async () => (await u.root().locator(".dswFiles_browsePane").count()) === 1, "restored for later journeys");
}

// J1.2: a workspace with no VCS -- no change tree, the non-VCS note with
// its hint and the handoff to the official file viewer.
async function j1_2_plain(u) {
  eq(await u.root().locator(".dswFiles_changeTree").count(), 0, "no change tree without a repo");
  await u.until(async () => (await u.root().locator(".dswFiles_noVcs").count()) === 1, "the non-VCS note");
  ok((await u.root().locator(".dswFiles_noVcsText").innerText()).includes("no initialized repository"), "the note names the missing repo");
  ok((await u.root().locator(".dswFiles_noVcsHint").innerText()).length > 0, "the note carries the init hint");
  eq(await u.root().locator("button[data-files-open-files-tab]").count(), 1, "the note offers the Files handoff");
  eq(await u.root().locator(".dswFiles_badge").count(), 0, "no change badges without VCS");
  ok((await u.previewText()).includes("Select a changed file to view its diff"), "preview starts empty");
}

// J20: live file updates, no user action. A file edited on disk refreshes
// the OPEN DIFF (the tick sees the worktree change and bumps the status;
// the preview re-fetches the patch). A brand-new file appears in the
// changed-file list with the unadded (U) badge. Runs on its OWN fresh
// session (a first Files-view mount, empty nav cache) — a remounted view
// would start with cached state and mask a dead first-mount tick interval.
async function j20_liveUpdates(u, ws) {
  await u.fileRow("a.txt").click();
  await u.until(async () => (await u.root().locator(".dswFiles_diff").count()) === 1, "a.txt diff rendered");
  await u.until(async () => ((await u.root().locator(".dswFiles_diff").innerText().catch(() => "")) ?? "").includes("two"), "a.txt diff shows its content");
  // External writer edits the open file. The next tick's worktree gate
  // trips → status bump → patch re-fetch. No click, no reload, no
  // re-selection.
  writeFileSync(join(ws, "a.txt"), "one\ntwo\nthree (edited on disk)\n");
  await u.until(async () => ((await u.root().locator(".dswFiles_diff").innerText().catch(() => "")) ?? "").includes("three (edited on disk)"),
    "the open diff auto-refreshed the live edit", 20_000);
  // A new file shows up in the changed-file list (a worktree add is a
  // worktree change — the tick's deep cycle catches it) and carries U.
  writeFileSync(join(ws, "fresh.txt"), "brand new\n");
  await u.until(async () => (await u.root().locator('li[data-files-change-file="fresh.txt"]').count()) === 1,
    "the new file's row appears in the changed list", 25_000);
  eq(await u.root().locator('li[data-files-change-file="fresh.txt"] .dswFiles_badgeU').count(), 1,
    "fresh.txt carries the U (unadded) badge");
}

// J22: the nav's horizontal divider — the change log (top) and the
// changed-file list (bottom) resize. The drag moves the log pane's height
// directly (no re-render per pointermove); the height commits to the
// persisted view state on release (it survives a reload); a double-click
// restores the 240px default.
async function j22_dividerDrag(u) {
  const root = u.root();
  const divider = root.locator(".dswFiles_hDivider");
  await u.until(async () => (await divider.count()) === 1, "the log/files divider");
  const pane = root.locator(".dswFiles_logPane");
  const before = await pane.boundingBox();
  ok(before && before.height > 0, "the log pane has a starting height");
  // A drag of dy px from wherever the pane currently sits.
  const dragBy = async (dy) => {
    const start = (await pane.boundingBox()).height;
    const hb = await divider.boundingBox();
    await u.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await u.page.mouse.down();
    await u.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + dy, { steps: 5 });
    await u.page.mouse.up();
    await u.until(async () => Math.abs((await pane.boundingBox()).height - (start + dy)) <= 3,
      `the log pane height committed (+${dy}px) after the drag`);
    return start;
  };
  const firstStart = await dragBy(60);
  const after = await pane.boundingBox();
  ok(Math.abs((after.height - firstStart) - 60) <= 3,
    `the drag grew the log pane by ~60px (got +${(after.height - firstStart).toFixed(0)}px)`);
  // Double-click restores the CSS default (240px).
  await divider.dblclick();
  await u.until(async () => Math.abs((await pane.boundingBox()).height - 240) <= 1,
    "double-click → the default log-pane height (240px)");
  // Persistence: drag again, reload, the height survives (the saved treeH).
  const secondStart = await dragBy(40);
  await u.page.reload({ waitUntil: "domcontentloaded" });
  await u.ensurePaneOpen();
  await u.until(async () => (await root.locator(".dswFiles_hDivider").count()) === 1, "the divider back after the reload");
  const restored = await pane.boundingBox();
  ok(Math.abs(restored.height - (secondStart + 40)) <= 2,
    `the dragged height persists across the reload (got ${restored.height.toFixed(0)}px, want ~${secondStart + 40}px)`);
}

// J23: branching — the shape a user reported. `base` FORKS into two
// children: `fork child 1` (the OFF-PATH branch — a leaf that never
// re-enters the worktree's lineage) and `fork child 2` (the worktree side,
// where the working copy sits). The off-path branch is the regression this
// pins: the old host revset `ancestors(@-)` rendered only the worktree's
// ancestry, so a fork child with no descendant back on the path was pruned
// and never showed. The host now uses jj's own default log scope
// (`builtin_log() ~ @` — exactly what a plain `jj log` shows), so the
// off-path branch renders on its own lane. Rows key and select on the
// COMMIT id; a plain branch is NOT divergent, so no
// (divergent)/(hidden) labels or /N offsets render (that path is unit-tested).
async function j23_branching(u) {
  const root = u.root();
  const tree = root.locator(".dswFiles_changeTree");
  await u.until(async () => (await tree.count()) > 0, "change tree");
  const rows = root.locator("button[data-files-change]");
  eq(await rows.count(), 4, "fork: worktree + fork child 1 + base + root");
  const wtText = ((await root.locator('[data-files-change="worktree"]').innerText()) || "").replace(/\n/g, " ");
  ok(wtText.includes("Editing") && wtText.includes("fork child 2"), `worktree row = the worktree-side fork child, got: ${wtText}`);
  // The OFF-PATH branch (fork child 1) — the commit the old revset pruned —
  // renders as a row, and the shared parent (the branch point) is the last row.
  const descs = await rows.evaluateAll((els) => els.map((e) => ((e.querySelector(".dswFiles_changeDesc") || {}).textContent || "")));
  ok(descs.includes("fork child 1"), `the OFF-PATH branch renders as a row (got ${JSON.stringify(descs)})`);
  eq(descs[2], "base", "the branch point (shared parent) is the 3rd row (the root is now the last): " + JSON.stringify(descs));
  eq(descs.length, 4, "the root is the log's final row (4 rows total)");
  // The fork opens a SECOND lane: the off-path branch sits beside the
  // worktree's line. The lane count is the visible proof.
  match(await tree.getAttribute("style") || "", /--filez-lanes:\s*2/, "the off-path branch sits on a separate lane");
  eq(await root.locator(".dswFiles_rowLanes").count(), 4, "every row (incl. the root) carries the lane column");
  // A plain branch is not divergent: no labels, no /N offsets.
  eq(await root.locator(".dswFiles_changeLabel").count(), 0, "no divergent/hidden labels on a plain branch");
  eq(await root.locator(".dswFiles_changeIdOff").count(), 0, "no /N change offset on a non-divergent branch");
  // The fork children's bookmarks render as pills on their rows.
  const pillTexts = await root.locator(".dswFiles_changePill").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  for (const bm of ["base", "c1", "c2"]) ok(pillTexts.includes(bm), `bookmark pill renders: ${bm} (got ${JSON.stringify(pillTexts)})`);
  // Select the OFF-PATH branch by its COMMIT id: the file list switches to
  // that commit's snapshot and its file's diff renders.
  const c1row = rows.filter({ hasText: "fork child 1" });
  await c1row.click();
  await u.until(async () => (await root.locator('li[data-files-change-file="c1.txt"]').count()) === 1, "the off-path branch's snapshot file list");
  await u.fileRow("c1.txt").click();
  await u.until(async () => ((await root.locator(".dswFiles_diff").innerText().catch(() => "")) ?? "").includes("child one"), "the off-path branch's file diff renders");
  // Back to the worktree: the worktree-side change's own file lists again.
  await root.locator('[data-files-change="worktree"]').click();
  await u.until(async () => (await root.locator('li[data-files-change-file="c2.txt"]').count()) === 1, "worktree selection: back to the worktree's changed file");
}

// J24: the change log's scroll auto-load. The fixture has 54 real commits +
// the root (55 rows); the first page carries 50, so scrolling the log's own
// scroll region to the bottom fetches the remaining 5 (4 commits + the root,
// the log's floor) and appends them (no "load less"). A short page exhausts
// the log — scrolling again appends nothing.
async function j24_pagination(u) {
  const root = u.root();
  const rows = root.locator("button[data-files-change]");
  // The first page: the worktree row + the host's first 50 commits.
  await u.until(async () => (await rows.count()) === 51, "first page rendered (worktree + 50 commits)");
  const descsOf = () => rows.evaluateAll((els) => els.map((e) => ((e.querySelector(".dswFiles_changeDesc") || {}).textContent || "")));
  const firstDescs = await descsOf();
  ok(firstDescs.includes("log-c54"), "the newest commit (log-c54) is on the first page");
  ok(!firstDescs.includes("log-c1"), "the oldest commit (log-c1) is beyond page 0 (not yet loaded)");
  // The log's own scroll region: 51 rows overflow the 240px pane, so it
  // scrolls. Drive it to the bottom — within 48px of the end the auto-load
  // fires and appends the next page.
  const scroller = root.locator(".dswFiles_tree").first();
  const scrollable = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 50);
  ok(scrollable, "the log pane overflows (scrollable) with 51 rows: " + JSON.stringify(await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))));
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await u.until(async () => (await rows.count()) === 56, "the next page auto-loads on scroll (worktree + 54 commits + root)");
  const allDescs = await descsOf();
  ok(allDescs.length === 56, "56 rows total after the append");
  ok(allDescs.includes("log-c1"), "the oldest commit (log-c1) loaded after scrolling");
  // The ROOT is the log's floor: it renders as the LAST row with a localized
  // "root" label in the date slot — NOT the root's epoch author date. The
  // "no 1970" check is locale-independent (en "root" / zh "根修订", neither
  // carries the epoch year the bare whenOf would render). (Its data attribute
  // is the root's commit id, not a fixed value, so it is addressed by
  // position.)
  const rootRow = rows.last();
  ok((await rootRow.count()) === 1, "the root row renders (the log's floor)");
  const rootWhen = ((await rootRow.locator(".dswFiles_changeWhen").innerText().catch(() => "")) || "").trim();
  ok(rootWhen.length > 0 && !rootWhen.includes("1970"), "the root row's date slot is a label, not the epoch date: " + JSON.stringify(rootWhen));
  // The root is the log's floor: no line may extend below it. A dangling
  // "parent outside the window" edge is clipped at the floor (see the layout
  // unit test); in this straight-history fixture the floor row is a single
  // lane, so this asserts the rendered floor has no vB segment (a guard against
  // a line regressing back to running off the bottom edge).
  const rootLaneVB = await rootRow.locator(".dswFiles_laneV.dswFiles_vB").count();
  ok(rootLaneVB === 0, "the root row has no line below it (no vB segment): " + rootLaneVB);
  // The appended page was short (5 < 50) → the log is exhausted. Scrolling
  // again appends nothing (no "load less", no duplicate rows).
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await u.page.waitForTimeout(600);
  eq(await rows.count(), 56, "an exhausted log appends nothing further (no re-load)");
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  // Fail loud and cheap (before any boot or model call) if dsh moved on.
  checkDshVersion();
  const root = join(tmpdir(), `changestab-e2e-${randomBytes(4).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  let dsh = null;
  let browser = null;
  try {
    const home = makeScratchHome(root);
    const fx = makeFixtures(root);
    console.log(`e2e: scratch home ${home}`);
    dsh = await bootDsh(home);
    const url = dsh.url;
    console.log(`e2e: dsh web on ${url.replace(/token=[^\s]+/, "token=…")}`);
    browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ["--no-sandbox"] });

    // F-JJ session: J1, J8, J21, J19.
    const a = await openSession(browser, { url, workspace: fx.fj });
    const ua = ui(a.page);
    await clickFilesTab(a.page);
    console.log("e2e: J1 first look (jj workspace)");
    await j1_firstLook(ua);
    console.log("e2e: J8 click → ref in the head row");
    await j8_clickRef(ua);
    console.log("e2e: J21 commit selection (no list refresh) + Open in Files");
    await j21_commitSelection(ua);
    console.log("e2e: J19 nav-pane collapse/expand (state pair)");
    await j19_collapse(ua);
    console.log("e2e: J22 the log/files divider drag + persistence");
    await j22_dividerDrag(ua);
    checkConsole(a, "fj");
    await a.context.close();

    // F-PLAIN session: J1.2.
    const b = await openSession(browser, { url, workspace: fx.plain });
    const ub = ui(b.page);
    await clickFilesTab(b.page);
    console.log("e2e: J1.2 first look (no VCS)");
    await j1_2_plain(ub);
    checkConsole(b, "plain");
    await b.context.close();

    // F-JJ-20 session: J20 on its own FIRST Files-view mount (fresh page +
    // session, empty nav cache) — the fresh-mount live-update path.
    const c = await openSession(browser, { url, workspace: fx.fj20 });
    const uc = ui(c.page);
    await clickFilesTab(c.page);
    console.log("e2e: J20 live file updates (fresh mount, no user action)");
    await j20_liveUpdates(uc, fx.fj20);
    checkConsole(c, "fj20");
    await c.context.close();

    // F-JJ-FORK session: J23 on its own fresh mount (the branch point).
    const d = await openSession(browser, { url, workspace: fx.fjf });
    const ud = ui(d.page);
    await clickFilesTab(d.page);
    console.log("e2e: J23 branching (the branch point, two lanes)");
    await j23_branching(ud);
    checkConsole(d, "fjf");
    await d.context.close();

    // F-JJ-LOG session: J24 on its own fresh mount (the 55-commit log).
    const e = await openSession(browser, { url, workspace: fx.fjlog });
    const ue = ui(e.page);
    await clickFilesTab(e.page);
    console.log("e2e: J24 pagination (scroll auto-load of the change log)");
    await j24_pagination(ue);
    checkConsole(e, "fjlog");
    await e.context.close();

    console.log(`e2e: PASS -- ${assertions} assertions across J1, J1.2, J8, J19, J20, J21, J22, J23, J24`);
  } catch (e) {
    // Best-effort failure screenshot, then clean up and rethrow.
    const pages = browser ? [...browser.contexts().flatMap((c) => c.pages())] : [];
    for (const p of pages) {
      mkdirSync(OUT_DIR, { recursive: true });
      await p.screenshot({ path: join(OUT_DIR, "e2e-failure.png") }).catch(() => {});
    }
    if (pages.length) console.log(`e2e: failure screenshot: ${join(OUT_DIR, "e2e-failure.png")}`);
    console.error(`e2e: FAIL after ${assertions} assertions:`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (dsh) dsh.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

main();

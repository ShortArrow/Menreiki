import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

const CDP_PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
// Builds may be redirected off the repo drive (CARGO_TARGET_DIR); honor it.
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const cliExe = path.join(targetDir, "debug", "menreiki.exe");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");
const dummyPdf = path.join(repoRoot, "test-documents", "dummy-spec.pdf");

let workDir: string;
let packFile: string;
let projectDir: string;
let configPath: string;
let vite: ChildProcess;
let app: ChildProcess;
let browser: Browser;
let page: Page;
// A rule-detected finding on page 1 and the LLM finding injected next to it,
// for the source-chip test.
let regexFinding: { category: string; text: string };
const injectedLlmText = "架空太郎テスト";
const injectedLlmNote = "E2E用の架空の理由";

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/// Drags a box over the page overlay, from (x1, y1) to (x2, y2) in screen
/// pixels. Boxes 4px or smaller are ignored by the viewer.
async function dragBox(x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

/// Turns on the Detect here tool and boxes a blank margin near the page's top-left
/// corner, where neither OCR pass finds any text.
async function detectBlankMargin() {
  await page.getByRole("button", { name: "ここを検出" }).click();
  const overlay = page.locator("svg.overlay");
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  await dragBox(box!.x + 4, box!.y + 4, box!.x + 34, box!.y + 24);
}

/// Turns on the Detect here tool and boxes the first analyzed candidate on the page,
/// with a little padding, so the region OCR reads a known word.
async function detectKnownWord() {
  await page.getByRole("button", { name: "ここを検出" }).click();
  const word = page.locator("svg.overlay rect.finding-rect").first();
  await word.scrollIntoViewIfNeeded();
  const box = await word.boundingBox();
  expect(box).not.toBeNull();
  await dragBox(
    box!.x - 3,
    box!.y - 3,
    box!.x + box!.width + 3,
    box!.y + box!.height + 3,
  );
}

/// Leaves detect mode, so later tests start with plain clicks.
async function leaveDetectMode() {
  await page
    .locator(".viewer-toolbar")
    .getByRole("button", { name: "なし", exact: true })
    .click();
}

/// A localhost port nothing listens on: connecting is refused immediately,
/// instead of hanging until the inference timeout.
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function killTree(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  try {
    execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {
    // already gone
  }
}

test.beforeAll(async () => {
  // A leftover app from an aborted run keeps the CDP port and hands us a
  // stale page; clear it before spawning ours.
  try {
    execSync("taskkill /IM menreiki-desktop.exe /F /T", { stdio: "ignore" });
  } catch {
    // none running
  }
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-e2e-"));
  projectDir = path.join(workDir, "spec.menreiki");
  const cliEnv = { ...process.env, MENREIKI_PDFIUM_PATH: pdfiumDir };
  execFileSync(cliExe, ["import", dummyPdf, "--project", projectDir], {
    env: cliEnv,
  });
  execFileSync(cliExe, ["analyze", projectDir], { env: cliEnv, timeout: 180_000 });

  // Inject an LLM-sourced finding into page 1 so the review list shows an
  // advisory row next to the rule-based ones. Opening the app does not
  // re-analyze (ADR-005), so it survives until a detect-only rerun.
  const pageFindingsPath = path.join(projectDir, "findings", "page-001.json");
  const pageFindings = JSON.parse(readFileSync(pageFindingsPath, "utf-8")) as {
    category: string;
    text: string;
    detector: string;
  }[];
  const regex = pageFindings.find((finding) => finding.detector === "regex");
  if (!regex) throw new Error("page 1 has no regex finding to compare against");
  regexFinding = { category: regex.category, text: regex.text };
  pageFindings.push({
    category: "person",
    text: injectedLlmText,
    rect: { x: 1, y: 1, width: 8, height: 8 },
    detector: "llm",
    note: injectedLlmNote,
  } as (typeof pageFindings)[number]);
  writeFileSync(pageFindingsPath, JSON.stringify(pageFindings, null, 2));

  // Pin the UI language: the app follows the OS otherwise, and every
  // assertion below reads Japanese labels.
  const configDir = path.join(workDir, "config");
  mkdirSync(configDir, { recursive: true });
  configPath = path.join(configDir, "config.toml");
  writeFileSync(configPath, 'ui_language = "ja"\n');
  // An app-wide pack for the removal-confirmation test. Its file name must
  // match its `name` (removal deletes `<name>.mnrkpack.json`), and its only
  // word is fictional and absent from the dummy document, so deleting it and
  // re-detecting leaves the other tests' findings unchanged.
  mkdirSync(path.join(configDir, "packs"), { recursive: true });
  packFile = path.join(configDir, "packs", "e2e-fixture.mnrkpack.json");
  writeFileSync(
    packFile,
    JSON.stringify({
      name: "e2e-fixture",
      displayName: "E2E 架空パック",
      version: "1.0.0",
      rules: [],
      words: [{ category: "organization", text: "蛙沼精機" }],
    }),
  );
  vite = spawn("npm", ["run", "dev"], {
    cwd: path.join(repoRoot, "apps", "desktop"),
    shell: true,
    stdio: "ignore",
  });
  // First-ever transform on this repo's slow filesystem can take minutes
  // when the vite optimize cache is cold; be generous.
  await waitFor(
    async () => (await fetch("http://localhost:1420")).ok,
    "vite dev server",
    180_000,
  );

  app = spawn(appExe, [projectDir], {
    env: {
      ...process.env,
      MENREIKI_PDFIUM_PATH: pdfiumDir,
      MENREIKI_CONFIG_DIR: path.join(workDir, "config"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: "ignore",
  });
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok,
    "WebView2 CDP endpoint",
  );

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  await waitFor(async () => {
    const candidate = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidatePage) => candidatePage.url().includes("localhost:1420"));
    if (!candidate) return false;
    page = candidate;
    return true;
  }, "app page over CDP");

  // Wait for React to actually render before touching the usage notice: when
  // the page is first found by URL the app may not have mounted yet, so a
  // one-shot visibility sample missed the notice and left the modal blocking
  // the whole run. The notice mounts together with the app, so once the side
  // pane exists it is present too; dismiss it if this profile has not.
  await page.locator(".side-pane").waitFor({ timeout: 60_000 });
  const ack = page.getByRole("button", { name: "理解しました" });
  if (await ack.isVisible().catch(() => false)) {
    await ack.click();
  }
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  killTree(app);
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("side-pane sections are laid out without overlap", async () => {
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });

  // Regression: shrunken flex sections used to let their content paint over
  // the next section. Every section must fully contain its content...
  const sections = await page.$$eval(".side-pane > section", (nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    }),
  );
  expect(sections.length).toBeGreaterThan(3);
  for (const section of sections) {
    expect(section.scrollHeight).toBeLessThanOrEqual(section.clientHeight + 1);
  }
  // ...and no two section boxes may overlap vertically.
  const ordered = [...sections].sort((a, b) => a.top - b.top);
  for (let i = 1; i < ordered.length; i++) {
    expect(ordered[i].top).toBeGreaterThanOrEqual(ordered[i - 1].bottom - 1);
  }
});

test("the usage notice is acknowledged and does not reappear", async () => {
  // beforeAll dismissed it; it must stay gone and expose the app underneath.
  await expect(
    page.getByRole("button", { name: "理解しました" }),
  ).toHaveCount(0);
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
});

test("a jump focus never replays on plain page navigation", async () => {
  // Regression: after a right-pane jump, clicking pages in the left list
  // replayed the stale focus (same-position blink and scroll) on every page.
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  await page.locator(".finding-label").first().click();
  await expect(page.locator(".focus-flash")).toBeVisible();

  await page.locator(".page-button").nth(1).click();
  await expect(page.locator(".focus-flash")).toHaveCount(0);
  await page.locator(".page-button").nth(2).click();
  await expect(page.locator(".focus-flash")).toHaveCount(0);
  await page.locator(".page-button").first().click();
  await expect(page.locator(".focus-flash")).toHaveCount(0);
});

test("the entity popover of the last finding row stays operable", async () => {
  // Regression: the findings list is an overflow container; the popover of
  // its last row opened into the clipped area and could not be used.
  const trigger = page
    .locator(".findings-list .entity-menu > button")
    .last();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const menu = page.locator(".entity-popover");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight + 1);
  await page.locator(".menu-backdrop").click();
  await expect(menu).toHaveCount(0);
});

test("the LLM settings read as optional and stay quiet with no server", async () => {
  // A Store certification tester opened this dialog with no local LLM server
  // running, saw the fetch-failure message against the localhost endpoint, and
  // rejected the app as depending on an inaccessible service (10.3.3). The
  // section must present itself as optional, and the automatic model fetch on
  // open must fail silently — the failure text is for user-initiated fetches.
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByText("ローカルLLM（任意・アプリ全体）")).toBeVisible();
  await expect(page.getByText("設定しなくてもすべての機能を使えます")).toBeVisible();
  await expect(
    page.getByText(/候補はありません|個のモデルを検出/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/モデル一覧を取得できませんでした/)).toHaveCount(0);
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(page.getByText("このプロジェクトで使う検出器")).toBeHidden();
});

test("finding rows show their source and mark LLM guesses as advisory", async () => {
  // Must run before any dictionary edit or re-analysis: a detect-only rerun
  // rewrites the findings and drops the injected LLM row.
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  const llmRow = page.locator(".findings-list .finding-row", {
    hasText: injectedLlmText,
  });
  await expect(llmRow).toHaveCount(1);

  const llmChip = llmRow.locator(".source-tag", {
    hasText: /^LLM$/,
  });
  await expect(llmChip).toHaveClass(/\bsource-advisory\b/);
  await expect(llmChip).toHaveAttribute("title", "参考情報（確定ではありません）");
  const note = llmRow.locator(".finding-note");
  await expect(note).toBeVisible();
  await expect(note).toHaveText(injectedLlmNote);

  const exact = (text: string) =>
    new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const regexRow = page
    .locator(".findings-list .finding-row", { hasText: regexFinding.text })
    .filter({
      has: page.locator(".finding-text", { hasText: exact(regexFinding.text) }),
    })
    .filter({
      // The tag text is the translated label, so match the category by the
      // `cat-<id>` class instead.
      has: page.locator(`.category-tag.cat-${regexFinding.category}`),
    });
  await expect(regexRow).toHaveCount(1);
  await expect(
    regexRow.locator(".source-tag", { hasText: /^正規表現$/ }),
  ).toHaveCount(1);
  await expect(regexRow.locator(".source-tag.source-advisory")).toHaveCount(0);
});

test("detect-here on a blank margin hints at the optional VLM when it is off", async () => {
  // The VLM is unconfigured by default, which is a normal state: the region
  // must not be sent to it, and its "not configured" error must not leak
  // (the same shape the Store rejected under 10.3.3).
  await page.locator(".page-button").first().click();
  try {
    await detectBlankMargin();
    await expect(page.locator(".statusbar .status").last()).toContainText(
      "（任意）設定の「ローカルLLM」で VLM を設定すると、OCR で読めない領域も読み取れます。",
      { timeout: 60_000 },
    );
    const statusText = await page.locator(".statusbar").innerText();
    expect(statusText).not.toContain("config.toml");
    expect(statusText).not.toContain("model name is not configured");
    expect(statusText).not.toContain("[inference]");
    expect(statusText).not.toContain("VLMで読み取り中");
    await expect(page.locator(".statusbar .error")).toHaveCount(0);
    await expect(page.locator(".detected-target")).toHaveCount(0);
  } finally {
    await leaveDetectMode();
  }
});

test("detect-here reports a failing configured VLM on the status line", async () => {
  // Settings are re-read on every call, so no restart is needed.
  const port = await closedPort();
  writeFileSync(
    configPath,
    `ui_language = "ja"\n\n[inference]\nbase_url = "http://127.0.0.1:${port}/v1"\nmodel = "e2e-dummy"\n`,
  );
  try {
    await detectBlankMargin();
    const status = page.locator(".statusbar .status").last();
    await expect(status).toContainText(
      "この領域の読み取り中にエラーが発生しました: ",
      { timeout: 60_000 },
    );
    await expect(status).toContainText("VLM: ");
    await expect(page.locator(".statusbar .error")).toHaveCount(0);
    await expect(page.locator(".detected-target")).toHaveCount(0);
  } finally {
    writeFileSync(configPath, 'ui_language = "ja"\n');
    await leaveDetectMode();
  }
});

test("detect-here shows a failed save as an error and offers no target", async () => {
  // A corrupt findings file makes add_manual_finding fail; the box must not
  // look pinned.
  const findingsPath = path.join(projectDir, "findings", "page-001.json");
  const original = readFileSync(findingsPath);
  writeFileSync(findingsPath, "{");
  try {
    await detectKnownWord();
    await expect(page.locator(".statusbar .error")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator(".statusbar .error")).not.toBeEmpty();
    await expect(page.locator(".detected-target")).toHaveCount(0);
  } finally {
    // The final workflow test reads this page's findings.
    writeFileSync(findingsPath, original);
    await leaveDetectMode();
  }
});

test("detect-here on a readable word opens the target bar without errors", async () => {
  try {
    await detectKnownWord();
    await expect(page.locator(".detected-target")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator(".statusbar .error")).toHaveCount(0);
  } finally {
    await leaveDetectMode();
  }
});

// Matches an element whose whole text is `text`, not just a substring.
// Whitespace is normalized the way Playwright normalizes the element's text.
const exactText = (text: string) =>
  new RegExp(`^${text.trim().replace(/\s+/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

// The first candidate row, pinned by its category and exact text (a row's
// identity) so the locator keeps pointing at that one row while decisions and
// filters change around it, and never at a row whose text merely contains it.
async function firstCandidateRow() {
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  const first = page.locator(".findings-list .finding-row").first();
  const text = await first.locator(".finding-text").textContent();
  const category = await first.locator(".category-tag").textContent();
  expect(text).toBeTruthy();
  expect(category).toBeTruthy();
  return page
    .locator(".findings-list .finding-row")
    .filter({
      has: page.locator(".finding-text", { hasText: exactText(text!) }),
    })
    .filter({
      has: page.locator(".category-tag", { hasText: exactText(category!) }),
    });
}

test("a replace decision takes its value right in the candidate row", async () => {
  const row = await firstCandidateRow();
  const replace = row.locator(".decision-btn", { hasText: "置換" });
  const input = row.locator(".finding-replace-input");
  await expect(input).toHaveCount(0);

  // A1: choosing replace opens the value field in place and focuses it.
  await replace.click();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  // A2: the row and the pending rule edit the same value, both ways.
  const ruleInput = page.locator(".section-rules .replace-input");
  await expect(ruleInput).toHaveCount(1);
  await input.fill("共同研究先A");
  await expect(ruleInput).toHaveValue("共同研究先A");
  await ruleInput.fill("共同研究先B");
  await expect(input).toHaveValue("共同研究先B");

  // A3: the row's alignment toggle drives the rule's alignment.
  await row.getByRole("button", { name: "右揃え" }).click();
  await expect(
    page.locator(".section-rules .align-btn.current"),
  ).toHaveAttribute("aria-label", "右揃え");

  // A4: other actions hide the field; replace brings the value back.
  await row.locator(".decision-btn", { hasText: "マスク" }).click();
  await expect(input).toHaveCount(0);
  await replace.click();
  await expect(input).toHaveValue("共同研究先B");
  await replace.click();
  await expect(input).toHaveCount(0);
});

test("an empty replacement is previewed as ■■■ and flagged before export", async () => {
  const row = await firstCandidateRow();
  // Bring the candidate's page into view so its rule preview is drawn.
  await row.locator(".finding-label").click();
  const replace = row.locator(".decision-btn", { hasText: "置換" });
  await replace.click();

  // C1: the pre-export check counts the empty replacement and warns.
  const precheck = page.locator(".precheck");
  await expect(precheck).toHaveClass(/warn/);
  await expect(precheck.getByText(/置換値が空の置換: 1 件/)).toBeVisible();

  // B1: the preview draws what the export will contain, not a placeholder.
  await expect(
    page.locator(".rule-preview").filter({ hasText: "■■■" }).first(),
  ).toBeVisible();
  await expect(
    page.locator(".rule-preview").filter({ hasText: "（仮称）" }),
  ).toHaveCount(0);

  // C2: entering a value clears the warning line.
  await row.locator(".finding-replace-input").fill("共同研究先A");
  await expect(precheck.getByText(/置換値が空の置換/)).toHaveCount(0);

  // Leave no decision behind for the tests that follow.
  await replace.click();
  await expect(row.locator(".finding-replace-input")).toHaveCount(0);
});

test("the undecided-only filter keeps the row being edited", async () => {
  const row = await firstCandidateRow();
  const filter = page.getByLabel("未判断のみ");
  await filter.check();
  try {
    // A6: deciding keeps the row while focus stays inside it.
    await row.locator(".decision-btn", { hasText: "置換" }).click();
    const input = row.locator(".finding-replace-input");
    await expect(input).toBeFocused();
    await row.getByRole("button", { name: "左揃え" }).click();
    await expect(row.getByRole("button", { name: "左揃え" })).toHaveClass(
      /current/,
    );
    // Focus leaving the row lets the filter drop it.
    await page.getByPlaceholder("例: 株式会社アルファ技研").focus();
    await expect(row).toHaveCount(0);
  } finally {
    await filter.uncheck();
  }
  // Clean up: undo the decision so later tests start undecided.
  await row.locator(".decision-btn", { hasText: "置換" }).click();
  await expect(row.locator(".finding-replace-input")).toHaveCount(0);
});

test("ignoring a finding can be undone from the status bar", async () => {
  // Regression: "Ignore" ran without any feedback or way back, so a misclick
  // silently dropped a candidate (and its decision) from the review.
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  const first = page.locator(".findings-list .finding-row").first();
  const text = (await first.locator(".finding-text").innerText()).trim();
  const category = (await first.locator(".category-tag").innerText()).trim();
  // The same text can appear under another category, and another candidate
  // can contain it as a substring; pin both exactly.
  const row = page
    .locator(".findings-list .finding-row")
    .filter({ has: page.locator(".finding-text", { hasText: exactText(text) }) })
    .filter({
      has: page.locator(".category-tag", { hasText: exactText(category) }),
    });
  await expect(row).toHaveCount(1);

  const erase = row.locator(".decision-btn", { hasText: "消去" });
  await erase.click();
  await expect(erase).toHaveClass(/current/);

  await row.getByRole("button", { name: "無視", exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 60_000 });
  await expect(
    page.locator(".statusbar").getByText(text, { exact: false }),
  ).toBeVisible();
  const undo = page.getByRole("button", { name: "元に戻す", exact: true });
  await expect(undo).toBeVisible();

  await undo.click();
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await expect(undo).toHaveCount(0);
  await expect(row.locator(".decision-btn", { hasText: "消去" })).toHaveClass(
    /current/,
  );

  // Back to undecided so the decision does not leak into later tests.
  await row.locator(".decision-btn", { hasText: "消去" }).click();
  await expect(
    row.locator(".decision-btn", { hasText: "消去" }),
  ).not.toHaveClass(/current/);
});

test("removing a detector pack asks for confirmation in the row first", async () => {
  // The pack row's X used to delete the file at once, looking just like the
  // ignored-word X that only changes unsaved state. A stray click silently
  // dropped an app-wide pack from every project with no way back.
  const settings = page.getByRole("button", { name: "設定", exact: true });
  const row = page.locator(".modal .rule-entry", { hasText: "E2E 架空パック" });
  const removeButton = row.getByRole("button", {
    name: "パックを削除",
    exact: true,
  });

  await settings.click();
  await expect(row).toHaveCount(1);

  // Keep: back to the normal row, file untouched.
  await removeButton.click();
  await expect(row).toContainText("元に戻せません");
  await expect(row).toContainText("全プロジェクト");
  await row.getByRole("button", { name: "やめる", exact: true }).click();
  await expect(removeButton).toBeVisible();
  expect(existsSync(packFile)).toBe(true);

  // Closing the dialog while confirming deletes nothing.
  await removeButton.click();
  await expect(
    row.getByRole("button", { name: "削除する", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).click();
  await settings.click();
  await expect(row).toHaveCount(1);
  await expect(removeButton).toBeVisible();
  expect(existsSync(packFile)).toBe(true);

  // Delete: the row and the file are gone.
  await removeButton.click();
  await row.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(existsSync(packFile)).toBe(false);

  // Removal triggers a re-detect; wait until the app is idle again.
  await page.getByRole("button", { name: "閉じる" }).click();
  await expect(
    page.getByRole("button", { name: "検索", exact: true }),
  ).toBeEnabled({ timeout: 120_000 });
});

test("decision buttons expose their pressed state and row name", async () => {
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });

  // Every group carries a name built from its own row's category and text,
  // so a screen reader (or a role query) can tell the rows apart.
  const rows = page.locator(".findings-list .finding-row");
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const group = row.locator(".decision-buttons");
    await expect(group).toHaveAttribute("role", "group");
    const label = (await group.getAttribute("aria-label")) ?? "";
    expect(label).not.toBe("");
    const category = (await row.locator(".category-tag").textContent()) ?? "";
    const text = (await row.locator(".finding-text").textContent()) ?? "";
    expect(label).toContain(category);
    expect(label).toContain(text);
  }

  // The toolbar has its own "マスク"/"消去" buttons, so scope to the row group.
  const row = rows.first();
  await expect(row).not.toHaveClass(/\bdecided\b/);
  const group = row.getByRole("group");
  const buttons = group.getByRole("button");
  await expect(buttons).toHaveCount(4);

  // Targets are at least 24px tall so adjacent choices are hard to mis-hit.
  for (let i = 0; i < 4; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(24);
  }

  await group.getByRole("button", { name: "マスク", exact: true }).click();
  await expect(
    group.getByRole("button", { name: "マスク", pressed: true }),
  ).toHaveCount(1);
  await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(group.locator('button[aria-pressed="false"]')).toHaveCount(3);

  // Pressing the active choice again clears the decision; the run must end
  // undecided because decisions autosave and later tests share the project.
  await group.getByRole("button", { name: "マスク", exact: true }).click();
  await expect(group.locator('button[aria-pressed="false"]')).toHaveCount(4);
  await expect(row).not.toHaveClass(/\bdecided\b/);
});

test("rectangle draw mode and scope expose their pressed state", async () => {
  const toolbar = page.locator(".viewer-toolbar");
  await toolbar.getByRole("button", { name: "消去", exact: true }).click();
  await toolbar.getByRole("button", { name: "このページ", exact: true }).click();

  const modes = toolbar.locator("button.mode");
  // Four draw modes plus the two scope buttons shown for erase.
  await expect(modes).toHaveCount(6);
  await expect(toolbar.locator('button.mode[aria-pressed="true"]')).toHaveCount(2);
  await expect(
    toolbar.getByRole("button", { name: "消去", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.getByRole("button", { name: "このページ", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.getByRole("button", { name: "全ページ", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  for (const name of ["なし", "マスク"]) {
    await expect(
      toolbar.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  }

  // Restore the defaults for the tests that follow.
  await toolbar.getByRole("button", { name: "全ページ", exact: true }).click();
  await toolbar.getByRole("button", { name: "なし", exact: true }).click();
  await expect(
    toolbar.getByRole("button", { name: "なし", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("only the current page button carries aria-current", async () => {
  const pages = page.locator(".page-button");
  await pages.nth(1).click();
  await expect(pages.nth(1)).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".page-button[aria-current]")).toHaveCount(1);

  await pages.first().click();
  await expect(pages.first()).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".page-button[aria-current]")).toHaveCount(1);
});

/// Whether keyboard focus is currently inside the element `locator` names.
async function holdsFocus(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) =>
    element.contains(document.activeElement),
  );
}

async function rootIsInert() {
  return page.evaluate(() =>
    document.getElementById("root")!.hasAttribute("inert"),
  );
}

test("settings keeps keyboard focus inside and Escape peels one layer at a time", async () => {
  const opener = page.getByRole("button", { name: "設定", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAccessibleName("設定");
  expect(await holdsFocus(dialog)).toBe(true);
  expect(await rootIsInert()).toBe(true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await holdsFocus(dialog)).toBe(true);
  }

  // The model list opens even with no LLM server (zero candidates). Escape
  // closes only the list and hands focus back to its toggle.
  const listToggle = page.getByRole("button", { name: "モデル一覧を開く" });
  await listToggle.click();
  await expect(page.locator(".combo-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".combo-popover")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(listToggle).toBeFocused();

  // The next Escape closes the dialog and returns focus to its opener.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await rootIsInert()).toBe(false);
});

test("search, decide, apply, export, and audit pass on the dummy document", async () => {
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });

  // Settings dialog lists the detector groups and persists a selection.
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByText("このプロジェクトで使う検出器")).toBeVisible();
  await expect(
    page.locator(".detector-grid").getByText("date", { exact: true }),
  ).toBeVisible();
  // Each toggle is named by its localized display name and described by a
  // one-line explanation; the bare id stays visible as auxiliary text.
  const aliased = page.getByRole("checkbox", {
    name: "略称定義（〜と称する）",
    exact: true,
  });
  await expect(aliased).toBeVisible();
  await expect(aliased).toHaveAccessibleDescription(/と称する/);
  // A group added on the Rust side without dictionary text falls back to a
  // bare id with no description and no id element; catch that drift without
  // hard-coding the group count.
  const detectorBoxes = page.locator(".detector-grid").getByRole("checkbox");
  const boxCount = await detectorBoxes.count();
  expect(boxCount).toBeGreaterThan(0);
  for (let index = 0; index < boxCount; index++) {
    await expect(detectorBoxes.nth(index)).toHaveAccessibleDescription(/\S/);
  }
  await expect(page.locator(".detector-grid .detector-id")).toHaveCount(
    boxCount,
  );
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("このプロジェクトで使う検出器")).toBeHidden();
  // Saving starts a re-detection, which disables "Settings" in the same
  // update that closes the dialog; focus falls back to Home, not <body>.
  await expect(page.getByRole("button", { name: "← ホーム" })).toBeFocused();
  expect(await rootIsInert()).toBe(false);

  await page.getByPlaceholder("例: 株式会社アルファ技研").fill("株式会社アルファ技研");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText(/\d+ 件見つかりました/)).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "置換ルールに追加" }).click();
  await page.getByPlaceholder("置換後").last().fill("開発会社A");

  await page
    .getByPlaceholder("例: 株式会社アルファ技研")
    .fill("株式会社ベータ電機");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "Entityとして登録" }).click();
  await expect(page.getByText("Entity（1件）")).toBeVisible();
  await expect(page.getByPlaceholder("仮称")).toHaveValue("組織A");

  const applyButton = page.getByRole("button", { name: /適用（\d+ルール）/ });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByText(/適用済み: \d+ 箇所/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "PDF出力" }).click();
  await page.getByRole("button", { name: "すべてのページを出力" }).click();
  await expect(page.getByText(/出力: .+sanitized\.pdf/)).toBeVisible({
    timeout: 60_000,
  });
  // Exporting before auditing nudges toward the audit and highlights it.
  const auditButton = page.getByRole("button", { name: "監査", exact: true });
  await expect(page.locator(".statusbar .status")).toContainText(
    "共有する前に「監査」を実行してください。",
  );
  await expect(auditButton).toHaveClass(/\bprimary\b/);

  await page.getByRole("button", { name: "Markdown出力" }).click();
  await expect(page.getByText(/出力: .+sanitized\.md/)).toBeVisible({
    timeout: 120_000,
  });

  await auditButton.click();
  await expect(page.getByText(/監査: Pass/)).toBeVisible({ timeout: 120_000 });
  await expect(auditButton).not.toHaveClass(/\bprimary\b/);

  // Changing a decision after Apply must mark the renders as stale: the old
  // Pass, summary and output paths are hidden and every output/audit button
  // is disabled until Apply runs again. A replacement-value change leaves the
  // deny terms untouched, so only the applied-input key can catch it.
  const unapplied = page.getByText("未適用の変更があります");
  const exportPdf = page.getByRole("button", { name: "PDF出力" });
  const exportMarkdown = page.getByRole("button", { name: "Markdown出力" });
  const exportImages = page.getByRole("button", { name: "画像出力" });
  const replacement = page.getByPlaceholder("置換後").last();
  await expect(replacement).toHaveValue("開発会社A");
  await expect(unapplied).toHaveCount(0);

  await replacement.fill("開発会社B");
  await expect(unapplied).toBeVisible();
  await expect(page.getByText(/監査: Pass/)).toHaveCount(0);
  await expect(page.getByText(/適用済み:/)).toHaveCount(0);
  await expect(page.getByText(/出力: .+sanitized\.pdf/)).toHaveCount(0);
  for (const button of [exportPdf, exportMarkdown, exportImages, auditButton]) {
    await expect(button).toBeDisabled();
  }

  // Reverting to the applied inputs clears the stale state again.
  await replacement.fill("開発会社A");
  await expect(unapplied).toHaveCount(0);
  await expect(page.getByText(/監査: Pass/)).toBeVisible();
  await expect(auditButton).toBeEnabled();

  // Re-applying clears the stale state and the now-outdated output paths.
  await replacement.fill("開発会社B");
  await expect(unapplied).toBeVisible();
  await applyButton.click();
  await expect(unapplied).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/適用済み: \d+ 箇所/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/出力: .+sanitized\.pdf/)).toHaveCount(0);

  await exportPdf.click();
  await page.getByRole("button", { name: "すべてのページを出力" }).click();
  await expect(page.getByText(/出力: .+sanitized\.pdf/)).toBeVisible({
    timeout: 60_000,
  });
  // Re-exporting after Apply cleared the audit result highlights it again.
  await expect(auditButton).toHaveClass(/\bprimary\b/);
  await auditButton.click();
  await expect(page.getByText(/監査: Pass/)).toBeVisible({ timeout: 120_000 });
  await expect(auditButton).not.toHaveClass(/\bprimary\b/);
});

test("clearing decisions and rules asks first and keeps entities", async () => {
  // Regression: the bulk clear button wiped every decision (hidden "keep"
  // ones too), text rule and region rule on a single click, and autosave
  // made it permanent 0.4s later. It must confirm in an in-app dialog first.
  // Runs last: the main flow leaves one text rule and one entity behind.
  const decisionsPath = path.join(projectDir, "decisions", "decisions.json");
  const readDecisions = () =>
    JSON.parse(readFileSync(decisionsPath, "utf8")) as {
      findings: { action: string }[];
      texts: unknown[];
      regions: unknown[];
      align_overrides: unknown[];
    };
  const rulesList = page.locator(".section-rules .rule-list");
  const clearButton = page.getByRole("button", {
    name: "判断・文字列・矩形ルールを一括解除…",
  });
  const dialog = page.getByRole("dialog");

  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });

  // One "keep" (which the rule list never shows) and one other decision.
  const undecided = page.locator(".findings-list .finding-row:not(.decided)");
  await undecided
    .first()
    .locator(".decision-btn", { hasText: "保持" })
    .click();
  await undecided
    .first()
    .locator(".decision-btn", { hasText: "マスク" })
    .click();

  // One region rule drawn in erase mode.
  const toolbar = page.locator(".viewer-toolbar");
  await toolbar.getByRole("button", { name: "消去", exact: true }).click();
  const overlay = page.locator(".page-stage svg.overlay");
  await expect(overlay).toBeVisible();
  // The page is taller than the scrolling viewer, so drag inside the part of
  // the page that is actually on screen.
  const pageBox = await overlay.boundingBox();
  const wrapBox = await page.locator(".page-stage-wrap").boundingBox();
  expect(pageBox).not.toBeNull();
  expect(wrapBox).not.toBeNull();
  const left = Math.max(pageBox!.x, wrapBox!.x);
  const top = Math.max(pageBox!.y, wrapBox!.y);
  const right = Math.min(pageBox!.x + pageBox!.width, wrapBox!.x + wrapBox!.width);
  const bottom = Math.min(
    pageBox!.y + pageBox!.height,
    wrapBox!.y + wrapBox!.height,
  );
  expect(right - left).toBeGreaterThan(40);
  expect(bottom - top).toBeGreaterThan(40);
  await page.mouse.move(
    left + (right - left) * 0.2,
    top + (bottom - top) * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    left + (right - left) * 0.6,
    top + (bottom - top) * 0.4,
    { steps: 5 },
  );
  await page.mouse.up();
  await toolbar.getByRole("button", { name: "なし", exact: true }).click();

  await waitFor(async () => {
    const saved = readDecisions();
    return (
      saved.regions.length >= 1 &&
      saved.texts.length >= 1 &&
      saved.findings.some((finding) => finding.action === "keep") &&
      saved.findings.some((finding) => finding.action !== "keep")
    );
  }, "decisions.json with a keep, a decision, a text and a region rule");
  const before = readDecisions();
  const keepCount = before.findings.filter((f) => f.action === "keep").length;
  const rulesBefore = await rulesList.innerText();

  // AC1/AC2: a modal dialog with the real counts and the caveats.
  await clearButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText(
    `判断 ${before.findings.length} 種類（うち保持 ${keepCount} 種類）`,
  );
  await expect(dialog).toContainText(`文字列ルール ${before.texts.length} 件`);
  await expect(dialog).toContainText(`矩形ルール ${before.regions.length} 件`);
  await expect(dialog).toContainText("Entity と配置の例外は残ります");
  await expect(dialog).toContainText("元に戻せません");
  expect(await rulesList.innerText()).toBe(rulesBefore);

  // AC3/AC6: cancel, backdrop, Escape and an immediate Enter change nothing.
  const dismissals: [string, () => Promise<void>][] = [
    ["cancel", () => dialog.getByRole("button", { name: "キャンセル" }).click()],
    ["backdrop", () => page.mouse.click(5, 5)],
    ["escape", () => page.keyboard.press("Escape")],
    ["enter", () => page.keyboard.press("Enter")],
  ];
  for (const [label, dismiss] of dismissals) {
    if (label !== "cancel") {
      await clearButton.click();
      await expect(dialog).toBeVisible();
    }
    await dismiss();
    await expect(dialog, label).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(await rulesList.innerText(), label).toBe(rulesBefore);
    expect(readDecisions(), label).toEqual(before);
  }

  // AC4/AC5: confirming clears decisions and rules but keeps the entity.
  await clearButton.click();
  await dialog.getByRole("button", { name: "一括解除する" }).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(1000);
  await waitFor(async () => {
    const saved = readDecisions();
    return (
      saved.findings.length === 0 &&
      saved.texts.length === 0 &&
      saved.regions.length === 0
    );
  }, "decisions.json cleared");
  expect(readDecisions().align_overrides).toEqual(before.align_overrides);
  await expect(page.getByText("Entity（1件）")).toBeVisible();
  await expect(rulesList.locator(".rule-block")).toHaveCount(1);

  // AC7: with only entity rules left, the bulk clear button is gone.
  await expect(clearButton).toHaveCount(0);
});

// Category tags read as the UI language's label, not the internal ID. These
// run after the pipeline test because registering to the dictionary re-runs
// detection.
test("candidate category tags show the translated label", async () => {
  const tags = page.locator(".findings-list .category-tag");
  await expect(tags.getByText("組織名", { exact: true }).first()).toBeVisible();
  await expect(tags.getByText("organization", { exact: true })).toHaveCount(0);
});

test("category filter labels options but keeps the ID as the value", async () => {
  const select = page.locator(".finding-filter select");
  await expect(
    select.locator("option", { hasText: "組織名" }),
  ).toHaveAttribute("value", "organization");
  await select.selectOption("organization");
  const tags = page.locator(".findings-list .category-tag");
  await expect(tags.first()).toBeVisible();
  await expect(tags.filter({ hasNotText: "組織名" })).toHaveCount(0);
  await select.selectOption("all");
});

test("free-text filter matches both the label and the ID", async () => {
  const filter = page.getByPlaceholder("絞り込み（語・分類・p.3）");
  const rows = page.locator(".findings-list .finding-row");
  await filter.fill("組織名");
  await expect(rows.first()).toBeVisible();
  await filter.fill("organization");
  await expect(rows.first()).toBeVisible();
  await filter.fill("");
});

test("exclude tooltip names the translated category", async () => {
  const row = page
    .locator(".findings-list .finding-row")
    .filter({ has: page.getByText("組織名", { exact: true }) })
    .first();
  // The row holds two `.mini` buttons (entity menu and exclude); pick the
  // exclude one by its label.
  const title = await row
    .getByRole("button", { name: "無視", exact: true })
    .getAttribute("title");
  expect(title).toContain("を組織名の検出から除外");
  expect(title).not.toContain("organization");
});

test("a dictionary entry registered as Other is listed as その他", async () => {
  const word = "架空語ゼータ九九";
  await page.getByPlaceholder("例: 株式会社アルファ技研").fill(word);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.locator(".dictionary-register select").selectOption("custom");
  await page
    .getByRole("button", { name: "辞書に登録（以後の解析で自動検出）" })
    .click();
  await expect(page.getByText("登録し、検出候補へ反映しました。")).toBeVisible({
    timeout: 120_000,
  });
  const entry = page
    .locator(".section-dictionary .rule-entry")
    .filter({ hasText: word });
  await expect(entry.locator(".category-tag")).toHaveText("その他");
});

// The LLM features stay off until a model is configured (settings.rs). The
// re-analyze menu used to offer them anyway and answer a click with an
// English backend error plus a fixed Japanese hint to hand-edit config.toml;
// it must lead to the settings dialog instead.
// The export menu shares the `.reanalyze-menu` class, so pin the label.
const reanalyzeButton = () =>
  page.locator(".reanalyze-menu > button", { hasText: "再解析…" });
const reanalyzeItem = (label: string | RegExp) =>
  page.locator(".reanalyze-menu .menu button", { hasText: label });

test("LLM and VLM detection without a model lead to the settings dialog", async () => {
  for (const label of ["LLM検出 — 設定で構成…", "VLM検出 — 設定で構成…"]) {
    await expect(reanalyzeButton()).toBeEnabled({ timeout: 120_000 });
    await reanalyzeButton().click();
    const item = reanalyzeItem(label);
    await expect(item).toBeVisible();
    await item.click();

    await expect(page.getByText("ローカルLLM（任意・アプリ全体）")).toBeVisible();
    await expect(page.locator(".statusbar .error")).toHaveCount(0);
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(page.getByText("ローカルLLM（任意・アプリ全体）")).toBeHidden();
  }
});

test("saving a model restores the regular LLM menu items without reopening", async () => {
  await reanalyzeButton().click();
  await reanalyzeItem("LLM検出 — 設定で構成…").click();
  await page.getByPlaceholder("qwen3（VLM検出は vision モデル）").fill("dummy-model");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("ローカルLLM（任意・アプリ全体）")).toBeHidden();

  // Saving re-runs detection; wait for it before reading the menu again.
  await expect(page.locator(".statusbar .status")).toHaveCount(0, {
    timeout: 120_000,
  });
  await expect(reanalyzeButton()).toBeEnabled({ timeout: 120_000 });
  await reanalyzeButton().click();
  // Only read the labels: clicking would reach out to localhost:11434.
  await expect(reanalyzeItem("LLM検出（テキスト・実験的）")).toBeVisible();
  await expect(reanalyzeItem("VLM検出（ページ画像・実験的）")).toBeVisible();
  await expect(reanalyzeItem(/設定で構成/)).toHaveCount(0);
  await page.locator(".menu-backdrop").click();
});

test("a remote endpoint is explained in Japanese without the backend text", async () => {
  // NotLocal is raised before any connection, so no server is needed.
  writeFileSync(
    path.join(workDir, "config", "config.toml"),
    'ui_language = "ja"\n\n[inference]\nbase_url = "http://example.com/v1"\nmodel = "dummy-model"\n',
  );
  // The review screen reads the config on mount and when settings close.
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByText("ローカルLLM（任意・アプリ全体）")).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).click();

  await reanalyzeButton().click();
  await reanalyzeItem("LLM検出（テキスト・実験的）").click();
  const error = page.locator(".statusbar .error");
  await expect(error).toContainText("このマシン上", { timeout: 30_000 });
  const text = await error.innerText();
  expect(text).toContain("設定 → ローカルLLM（任意・アプリ全体）");
  expect(text).not.toContain("inference endpoint must be");
  expect(text).not.toContain("model name is not configured");
  expect(text).not.toContain("config.toml");
});

// Depends on undecided candidates being left over: the bulk clear test above
// resets every decision and the tests after it leave the decision buttons
// alone. Keep decision-dependent tests out of the rest of this file, after
// this one.
test("bulk apply decides only the shown undecided candidates", async () => {
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  const filterSelect = page.locator(".finding-filter select");
  const rows = page.locator(".findings-list .finding-row");
  const bulk = page.locator(".bulk-apply");
  const modal = page.locator(".bulk-apply-modal");
  const undecidedCount = async () => {
    const text = await page.getByText(/未判断の候補: \d+ 種類/).textContent();
    return Number(/(\d+)/.exec(text ?? "")![1]);
  };

  // 1. The first category with at least two shown rows; no hard-coded name.
  const categories = (
    await filterSelect.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    )
  ).filter((value) => value !== "all");
  let category: string | undefined;
  for (const candidate of categories) {
    await filterSelect.selectOption(candidate);
    if ((await rows.count()) >= 2) {
      category = candidate;
      break;
    }
  }
  expect(category, "a category with two or more rows").toBeDefined();
  const rowCount = await rows.count();

  // 2. Erase the first row, so bulk Mask must leave it alone (AC3).
  const firstRow = rows.first();
  const firstText = await firstRow.locator(".finding-text").textContent();
  await firstRow.getByRole("button", { name: "消去", exact: true }).click();
  await expect(firstRow).toHaveClass(/decided/);

  // 3. Decided rows across every category before the bulk action.
  await filterSelect.selectOption("all");
  const decidedBefore = await page
    .locator(".findings-list .finding-row.decided")
    .count();
  const otherDecidedBefore = decidedBefore - 1;
  await filterSelect.selectOption(category!);
  const before = await undecidedCount();

  const maskButton = bulk.getByRole("button", { name: "マスク", exact: true });
  await expect(bulk).toContainText(`表示中の未判断 ${rowCount - 1} 種類`);

  // 4. Cancel changes nothing (AC4); so does a backdrop click.
  await maskButton.click();
  await expect(modal).toBeVisible();
  await expect(modal.locator(".bulk-apply-target")).toHaveCount(rowCount - 1);
  await modal.getByRole("button", { name: "キャンセル" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".findings-list .finding-row.decided")).toHaveCount(
    1,
  );
  expect(await undecidedCount()).toBe(before);
  await maskButton.click();
  await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(modal).toHaveCount(0);
  expect(await undecidedCount()).toBe(before);

  // 5. Confirm: every shown row is decided, the erased row keeps Erase, and
  // the undecided count drops by the number applied (AC2, AC3, AC9).
  await maskButton.click();
  await modal
    .getByRole("button", { name: `マスクを ${rowCount - 1} 種類に適用` })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".findings-list .finding-row.decided")).toHaveCount(
    rowCount,
  );
  await expect(
    firstRow.locator(".decision-btn.current", { hasText: "消去" }),
  ).toHaveCount(1);
  for (let i = 1; i < rowCount; i++) {
    await expect(
      rows.nth(i).locator(".decision-btn.current", { hasText: "マスク" }),
    ).toHaveCount(1);
  }
  expect(await undecidedCount()).toBe(before - (rowCount - 1));
  await expect(bulk.getByRole("button", { name: "マスク", exact: true })).toBeDisabled();

  // Other categories keep their prior state.
  await filterSelect.selectOption("all");
  await expect(page.locator(".findings-list .finding-row.decided")).toHaveCount(
    otherDecidedBefore + rowCount,
  );

  // Saved after the debounce, keyed by category + text.
  const decisionsPath = path.join(projectDir, "decisions", "decisions.json");
  await waitFor(async () => {
    const saved = JSON.parse(readFileSync(decisionsPath, "utf8")) as {
      findings: { category: string; text: string; action: string }[];
    };
    const ofCategory = saved.findings.filter(
      (entry) => entry.category === category,
    );
    return (
      ofCategory.length === rowCount &&
      ofCategory.filter((entry) => entry.action === "mask").length ===
        rowCount - 1 &&
      ofCategory.some(
        (entry) => entry.text === firstText && entry.action === "erase",
      )
    );
  }, "bulk decisions saved to decisions.json");
});

test("deleting a merged entity asks first and can be undone", async () => {
  // Regression guard for one-click loss of hand-made merges: an entity with
  // two or more spellings asks before it goes, and the deletion can be undone
  // back to the same id, alias and spelling order. Counts are relative
  // because the previous test leaves an entity behind.
  const cards = page.locator(".section-entity .entity-card");
  const before = await cards.count();

  await page
    .getByPlaceholder("例: 株式会社アルファ技研")
    .fill("株式会社アルファ技研");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText(/\d+ 件見つかりました/)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Entityとして登録" }).click();
  await expect(cards).toHaveCount(before + 1);
  const card = cards.nth(before);
  const alias = await card.getByPlaceholder("仮称").inputValue();
  expect(alias).not.toBe("");

  // Merge a second spelling through a candidate row's entity menu.
  const row = page
    .locator(".findings-list .finding-row")
    .filter({ hasNotText: /株式会社(アルファ技研|ベータ電機)/ })
    .first();
  await row.scrollIntoViewIfNeeded();
  const second = (await row.locator(".finding-text").innerText()).trim();
  await row.locator(".entity-menu > button").click();
  await page
    .locator(".entity-popover")
    .getByRole("button", { name: `→ ${alias}`, exact: true })
    .click();
  const chips = card.locator(".variant-chip .chip-text");
  await expect(chips).toHaveText(["株式会社アルファ技研", second]);

  // First attempt: the in-app confirmation appears; cancelling keeps it all.
  await card.getByRole("button", { name: "削除", exact: true }).click();
  const confirm = card.locator(".entity-delete-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(alias);
  await expect(confirm).toContainText("2件");
  await card.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(cards).toHaveCount(before + 1);
  await expect(page.locator(".undo-bar")).toHaveCount(0);

  // Reads the persisted entity with this alias (or null) from entities.json.
  const entitiesFile = path.join(projectDir, "entities", "entities.json");
  const savedEntity = () => {
    const saved: { id: string; alias: string; variants: string[] }[] =
      JSON.parse(readFileSync(entitiesFile, "utf8"));
    const match = saved.find((entity) => entity.alias === alias);
    return match ? { id: match.id, variants: match.variants } : null;
  };
  await expect
    .poll(() => savedEntity()?.variants ?? null, { timeout: 10_000 })
    .toEqual(["株式会社アルファ技研", second]);
  const savedId = savedEntity()!.id;

  // Second attempt: confirm, and the card is gone.
  await card.getByRole("button", { name: "削除", exact: true }).click();
  await card.getByRole("button", { name: "削除を確定", exact: true }).click();
  await expect(cards).toHaveCount(before);
  await expect(page.locator(".undo-bar")).toBeVisible();
  // The deletion itself is autosaved, so the restore below is observable on
  // disk rather than a debounce that never wrote the removal.
  await expect.poll(savedEntity, { timeout: 10_000 }).toBeNull();

  // Undo restores the same entity, in place, with the same spelling order.
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(cards).toHaveCount(before + 1);
  await expect(page.locator(".undo-bar")).toHaveCount(0);
  const restored = cards.nth(before);
  await expect(restored.getByPlaceholder("仮称")).toHaveValue(alias);
  await expect(restored.locator(".variant-chip .chip-text")).toHaveText([
    "株式会社アルファ技研",
    second,
  ]);

  // The autosave writes the restored entity back under the same id.
  await expect
    .poll(savedEntity, { timeout: 10_000 })
    .toEqual({ id: savedId, variants: ["株式会社アルファ技研", second] });
});

test("clicking a region rect reveals its rule; deletion is undoable from the pane", async () => {
  // Regression: in "none" mode one click on a region rect deleted the rule —
  // all-pages rules included — with no notice or undo, and because regions
  // painted over findings, it also swallowed clicks on candidates inside it.
  const savedRegions = () => {
    try {
      const saved = JSON.parse(
        readFileSync(
          path.join(projectDir, "decisions", "decisions.json"),
          "utf8",
        ),
      ) as { regions: unknown[] };
      return saved.regions;
    } catch {
      return null;
    }
  };
  const regionEntries = page.locator(".rule-entry.region");
  const before = await regionEntries.count();

  // Focus an analyzer candidate so its rect is on screen and identifiable.
  await page.locator(".finding-label").first().click();
  const target = page.locator(".finding-rect.highlight").first();
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const margin = 16;

  async function drawAllPagesErase(x: number, y: number, w: number, h: number) {
    const toolbar = page.locator(".viewer-toolbar");
    await toolbar.getByRole("button", { name: "消去", exact: true }).click();
    await toolbar.getByRole("button", { name: "全ページ", exact: true }).click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + w / 2, y + h / 2);
    await page.mouse.move(x + w, y + h);
    await page.mouse.up();
    await toolbar.getByRole("button", { name: "なし", exact: true }).click();
  }

  // An all-pages erase rule covering the candidate with some room around it.
  await drawAllPagesErase(
    box.x - margin,
    box.y - margin,
    box.width + margin * 2,
    box.height + margin * 2,
  );
  await expect(regionEntries).toHaveCount(before + 1);
  const added = regionEntries.nth(before);

  // AC1/AC2: clicking the region away from the candidate keeps the rule and
  // reveals its entry in the right pane.
  await page.mouse.click(box.x - margin + 4, box.y - margin + 4);
  await expect(added).toHaveClass(/reveal-flash/);
  await expect(added).toBeInViewport();
  await expect(regionEntries).toHaveCount(before + 1);
  await waitFor(
    async () => savedRegions()?.length === before + 1,
    "autosaved region rule",
    10_000,
  );

  // AC3: the candidate inside the region still receives its click.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".finding-row.reveal-flash")).toHaveCount(1);
  await expect(regionEntries).toHaveCount(before + 1);

  // AC4: a second rule; delete it from the pane, then undo.
  await drawAllPagesErase(
    box.x - margin * 2,
    box.y + box.height + margin * 2,
    60,
    30,
  );
  await expect(regionEntries).toHaveCount(before + 2);
  const second = regionEntries.nth(before + 1);
  const savedSecond = await waitFor(
    async () => savedRegions()?.length === before + 2,
    "autosaved second rule",
    10_000,
  ).then(() => savedRegions()![before + 1]);
  await second.getByRole("button", { name: "削除", exact: true }).click();
  await expect(regionEntries).toHaveCount(before + 1);
  const undoBar = page.locator(".undo-bar");
  await expect(undoBar).toContainText("領域ルールを1件削除しました");
  const undo = undoBar.getByRole("button", { name: "元に戻す" });
  await undo.click();
  await expect(undo).toHaveCount(0);
  await expect(regionEntries).toHaveCount(before + 2);
  await waitFor(
    async () =>
      JSON.stringify(savedRegions()?.[before + 1]) ===
      JSON.stringify(savedSecond),
    "autosaved restored rule",
    10_000,
  );
});

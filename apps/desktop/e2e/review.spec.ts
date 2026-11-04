import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
let projectDir: string;
let vite: ChildProcess;
let app: ChildProcess;
let browser: Browser;
let page: Page;

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

  // Pin the UI language: the app follows the OS otherwise, and every
  // assertion below reads Japanese labels.
  const configDir = path.join(workDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.toml"), 'ui_language = "ja"\n');
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
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("このプロジェクトで使う検出器")).toBeHidden();

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

  await page.getByRole("button", { name: "Markdown出力" }).click();
  await expect(page.getByText(/出力: .+sanitized\.md/)).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole("button", { name: "監査", exact: true }).click();
  await expect(page.getByText(/監査: Pass/)).toBeVisible({ timeout: 120_000 });
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
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.1, box!.y + box!.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.97, {
    steps: 5,
  });
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

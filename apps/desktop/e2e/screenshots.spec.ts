import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

// Store/README screenshot capture over the same harness as review.spec.ts.
// Not part of the regular suite: run explicitly with
//   $env:SCREENSHOTS = "1"; npx playwright test screenshots
// Images land in out/screenshots/ (1440x920 window, above the Store's
// 1366x768 minimum).

const CDP_PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const cliExe = path.join(targetDir, "debug", "menreiki.exe");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");
const dummyPdf = path.join(repoRoot, "test-documents", "dummy-spec.pdf");
const outDir = path.join(repoRoot, "out", "screenshots");

let workDir: string;
let vite: ChildProcess;
let app: ChildProcess;
let browser: Browser;
let page: Page;

const enabled = process.env.SCREENSHOTS === "1";

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
  timeoutMs = 180_000,
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
  if (!enabled) return;
  try {
    execSync("taskkill /IM menreiki-desktop.exe /F /T", { stdio: "ignore" });
  } catch {
    // none running
  }
  mkdirSync(outDir, { recursive: true });
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-shots-"));
  const projectDir = path.join(workDir, "spec.menreiki");
  const cliEnv = { ...process.env, MENREIKI_PDFIUM_PATH: pdfiumDir };
  execFileSync(cliExe, ["import", dummyPdf, "--project", projectDir], {
    env: cliEnv,
  });
  execFileSync(cliExe, ["analyze", projectDir], {
    env: cliEnv,
    timeout: 180_000,
  });

  vite = spawn("npm", ["run", "dev"], {
    cwd: path.join(repoRoot, "apps", "desktop"),
    shell: true,
    stdio: "ignore",
  });
  await waitFor(
    async () => (await fetch("http://localhost:1420")).ok,
    "vite dev server",
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

  await page.locator(".side-pane").waitFor({ timeout: 60_000 });
  const ack = page.getByRole("button", { name: "理解しました" });
  if (await ack.isVisible().catch(() => false)) {
    await ack.click();
  }
});

test.afterAll(async () => {
  if (!enabled) return;
  await browser?.close().catch(() => {});
  killTree(app);
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("capture store and readme screenshots", async () => {
  test.skip(!enabled, "set SCREENSHOTS=1 to capture");

  // The WebView2 profile is shared with regular dev use, so persisted pane
  // widths and toggles leak in; reset to the default layout for the shots.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".side-pane").waitFor({ timeout: 60_000 });
  const ack = page.getByRole("button", { name: "理解しました" });
  if (await ack.isVisible().catch(() => false)) {
    await ack.click();
  }

  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  // Let thumbnails and the page image settle before the first shot.
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: path.join(outDir, "01-review.png") });

  // A replacement rule with its before/after occurrence crops open.
  await page
    .getByPlaceholder("例: 株式会社アルファ技研")
    .fill("株式会社アルファ技研");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText(/\d+ 件見つかりました/)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "置換ルールに追加" }).click();
  await page.getByPlaceholder("置換後").last().fill("開発会社A");
  const ruleBlock = page.locator(".rule-block").last();
  await ruleBlock.locator(".rule-entry button.mini").first().click();
  await page.waitForTimeout(2_500);
  await ruleBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "02-rule-preview.png") });

  // Applied result with the before/after gallery.
  const applyButton = page.getByRole("button", { name: /適用（\d+ルール）/ });
  await applyButton.click();
  await expect(page.getByText(/適用済み: \d+ 箇所/)).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);
  await page
    .getByText(/適用済み: \d+ 箇所/)
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: path.join(outDir, "03-applied.png") });

  // The plain-diagram help page.
  await page.getByRole("button", { name: "ヘルプ（各要素の対応関係とデータの流れ）" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "04-help.png") });
});

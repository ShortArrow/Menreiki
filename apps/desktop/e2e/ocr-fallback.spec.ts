import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

// Reproduces a Windows without the Japanese OCR language pack (QUALITY §3):
// the debug build's MENREIKI_TEST_FORCE_OCR_FALLBACK=1 makes the "ja"
// engine fail, so the app falls back to the profile languages. The GUI must
// say so — a banner above the candidates that survives a detect-only rerun,
// and an audit that reads "Pass with warnings" rather than a plain "Pass".
// The analysis runs from the GUI's own button: a CLI-analyzed project would
// never pass through the desktop backend's engine selection.

const CDP_PORT = 9336;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
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
  try {
    execSync("taskkill /IM menreiki-desktop.exe /F /T", { stdio: "ignore" });
  } catch {
    // none running
  }
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-e2e-fallback-"));
  projectDir = path.join(workDir, "spec.menreiki");
  // Import only: the analysis must go through the GUI.
  execFileSync(cliExe, ["import", dummyPdf, "--project", projectDir], {
    env: { ...process.env, MENREIKI_PDFIUM_PATH: pdfiumDir },
  });

  // Pin the UI language (ADR-018): the assertions read Japanese labels.
  const configDir = path.join(workDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.toml"), 'ui_language = "ja"\n');
  vite = spawn("npm", ["run", "dev"], {
    cwd: path.join(repoRoot, "apps", "desktop"),
    shell: true,
    stdio: "ignore",
  });
  await waitFor(
    async () => (await fetch("http://localhost:1420")).ok,
    "vite dev server",
    180_000,
  );

  app = spawn(appExe, [projectDir], {
    env: {
      ...process.env,
      MENREIKI_PDFIUM_PATH: pdfiumDir,
      MENREIKI_CONFIG_DIR: configDir,
      MENREIKI_TEST_FORCE_OCR_FALLBACK: "1",
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
  await browser?.close().catch(() => {});
  killTree(app);
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("a fallback OCR run is flagged in the review pane and the audit", async () => {
  const banner = page.getByTestId("ocr-fallback-warning");
  await expect(banner).toHaveCount(0);

  // Given an imported, not yet analyzed project, when the GUI analyzes it...
  await page.getByRole("button", { name: /^解析を(実行|再開)$/ }).click();
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 180_000,
  });
  const reanalyze = page.getByRole("button", { name: "再解析…" });
  await expect(reanalyze).toBeEnabled({ timeout: 180_000 });

  // ...then the fallback banner sits above the candidates.
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("OCR言語パック");

  // A detect-only rerun reports no OCR status and must not clear it.
  await reanalyze.click();
  await page.getByRole("button", { name: "検出のみ" }).click();
  await expect(reanalyze).toBeEnabled({ timeout: 120_000 });
  await expect(banner).toBeVisible();

  // Decide one candidate, apply, export, and audit.
  await page
    .locator(".decision-buttons")
    .first()
    .getByRole("button", { name: "マスク" })
    .click();
  const applyButton = page.getByRole("button", { name: /適用（\d+ルール）/ });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByText(/適用済み: \d+ 箇所/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(banner).toBeVisible();

  await page.getByRole("button", { name: "PDF出力" }).click();
  await page.getByRole("button", { name: "すべてのページを出力" }).click();
  await expect(page.getByText(/出力: .+sanitized\.pdf/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "監査", exact: true }).click();
  await expect(page.getByText(/監査: Pass with warnings/)).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator(".audit.warn")).toBeVisible();
  await expect(page.locator(".audit.pass")).toHaveCount(0);
  await expect(page.getByTestId("audit-ocr-fallback-warning")).toBeVisible();
  await expect(banner).toBeVisible();
});

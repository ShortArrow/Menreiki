import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

const CDP_PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliExe = path.join(repoRoot, "target", "debug", "menreiki.exe");
const appExe = path.join(repoRoot, "target", "debug", "menreiki-desktop.exe");
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
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-e2e-"));
  projectDir = path.join(workDir, "spec.menreiki");
  const cliEnv = { ...process.env, MENREIKI_PDFIUM_PATH: pdfiumDir };
  execFileSync(cliExe, ["import", dummyPdf, "--project", projectDir], {
    env: cliEnv,
  });
  execFileSync(cliExe, ["analyze", projectDir], { env: cliEnv, timeout: 180_000 });

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
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  killTree(app);
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("search, decide, apply, export, and audit pass on the dummy document", async () => {
  await expect(page.getByText(/検出候補（\d+件）/)).toBeVisible({
    timeout: 30_000,
  });

  await page.getByPlaceholder("例: 株式会社アルファ技研").fill("株式会社アルファ技研");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText(/\d+ 件見つかりました/)).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "置換ルールに追加" }).click();
  await page.getByPlaceholder("置換後").last().fill("開発会社A");

  const applyButton = page.getByRole("button", { name: /適用（\d+ルール）/ });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByText(/適用済み: \d+ 箇所/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "PDF出力" }).click();
  await expect(page.getByText(/出力: .+sanitized\.pdf/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "監査", exact: true }).click();
  await expect(page.getByText(/監査: Pass/)).toBeVisible({ timeout: 120_000 });
});

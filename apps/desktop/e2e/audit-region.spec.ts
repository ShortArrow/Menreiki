import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

// UC-02: a reviewer who only erases a fixed area with a rectangle and then
// audits must read, in Japanese, that the audit had nothing to check and that
// the rectangle areas need a visual check — never the backend's English
// "no deny terms". This uses its own project: review.spec.ts shares one
// project across its tests and decisions are saved automatically.

const CDP_PORT = 9336;
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
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-audit-region-"));
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

test("auditing a rectangle-only edit explains that nothing was checked", async () => {
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });

  const toolbar = page.locator(".viewer-toolbar");
  await toolbar.getByRole("button", { name: "消去", exact: true }).click();
  await toolbar.getByRole("button", { name: "全ページ", exact: true }).click();

  const overlay = page.locator(".page-stage svg.overlay");
  await overlay.waitFor({ timeout: 60_000 });
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  // A footer-like band well above the 4px minimum the viewer accepts.
  const left = box!.x + box!.width * 0.1;
  const top = box!.y + box!.height * 0.9;
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(left + box!.width * 0.5, top + 40, { steps: 5 });
  await page.mouse.up();

  const applyButton = page.getByRole("button", { name: /適用（\d+ルール）/ });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByText(/適用済み: \d+ 箇所/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "監査", exact: true }).click();
  const error = page.locator(".statusbar .error");
  await expect(error).toHaveText(
    "監査で照合する語がありません。テキストの置換・マスクを決定していないため、再OCRで照合する対象がありません。矩形で消去・マスクした領域は監査では確認されません。出力画像を目で確認してください。",
    { timeout: 60_000 },
  );
  await expect(page.getByText("no deny terms", { exact: false })).toHaveCount(0);
});

import { spawn, execSync, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

// The embedded sample is what makes the app testable with no external file
// (store certification 10.3.3). Unlike review.spec.ts this launches the app
// with NO project argument, so it lands on the home screen, and needs no CLI
// import/analyze — the sample project is baked into the binary.

const CDP_PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");

let workDir: string;
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
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-sample-"));

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

  // No project argument: the app opens on the home screen.
  app = spawn(appExe, [], {
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

  // The home screen and the first-run notice mount together; dismiss the
  // notice if this profile has not acknowledged it.
  await page.getByRole("button", { name: /サンプルを開いて試す/ }).waitFor({
    timeout: 60_000,
  });
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

test("the embedded sample opens into review with detections", async () => {
  // Certification path: no document to import, one click to primary
  // functionality. The button carries an English line so a non-Japanese
  // certification tester finds it without reading the submission notes.
  const sampleButton = page.getByRole("button", {
    name: /サンプルを開いて試す/,
  });
  await expect(sampleButton).toContainText("Try the built-in sample");
  await sampleButton.click();

  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
  // The sample was analyzed at build time, so candidates are present without
  // running OCR here.
  await expect(page.locator(".finding-label").first()).toBeVisible();
  // It is a 3-page document, so page navigation is exercisable.
  expect(await page.locator(".page-button").count()).toBeGreaterThanOrEqual(3);
});

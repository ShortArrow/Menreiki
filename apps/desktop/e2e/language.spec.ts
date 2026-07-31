import { spawn, execSync, ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium, Browser, Page } from "@playwright/test";

// A Store certification tester runs an English Windows install, so the UI they
// see must be English end to end. This launches with ui_language = "en" and
// asserts the home screen, the first-run notice, and the settings dialog all
// render in English with no Japanese left in them.

const CDP_PORT = 9335;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");

// Full-width punctuation counts too: a hard-coded 「）」 or 「・」 in JSX
// survives translation and shows up mid-sentence in the English UI.
const JAPANESE = /[ぁ-んァ-ヶ一-龠（）、。・「」]/;

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
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-lang-"));
  const configDir = path.join(workDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.toml"), 'ui_language = "en"\n');

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

  app = spawn(appExe, [], {
    env: {
      ...process.env,
      MENREIKI_PDFIUM_PATH: pdfiumDir,
      MENREIKI_CONFIG_DIR: configDir,
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

  await page
    .getByRole("button", { name: /Try the built-in sample/ })
    .waitFor({ timeout: 60_000 });
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  killTree(app);
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("the first-run notice and home screen render in English", async () => {
  // The notice is a one-time localStorage flag, and the WebView2 profile is
  // shared with the other specs, so clear it to see what a first launch shows.
  await page.evaluate(() =>
    localStorage.removeItem("menreiki.acknowledged.v1"),
  );
  await page.reload();
  await page
    .getByRole("button", { name: /Try the built-in sample/ })
    .waitFor({ timeout: 60_000 });

  const ack = page.getByRole("button", { name: "I understand" });
  await expect(ack).toBeVisible();
  await expect(page.getByText("Before you start")).toBeVisible();
  await ack.click();

  await expect(
    page.getByRole("button", { name: /Import a document/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Everything runs on this device.", { exact: false }),
  ).toBeVisible();

  const homeText = (await page.locator(".home").innerText()) ?? "";
  expect(homeText).not.toMatch(JAPANESE);
});

test("the review screen and settings dialog render in English", async () => {
  await page.getByRole("button", { name: /Try the built-in sample/ }).click();
  await expect(page.getByText(/Candidates \(\d+ kinds/)).toBeVisible({
    timeout: 120_000,
  });

  // The document data on this screen is Japanese by design, so the blanket
  // no-Japanese check cannot run here; pin the composed heading instead
  // (its closing paren was once a hard-coded full-width one).
  const heading = await page.locator(".findings-section h2").innerText();
  expect(heading).toMatch(/^Candidates \(\d+ kinds.*\)$/);
  expect(heading).not.toMatch(JAPANESE);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Detectors used in this project")).toBeVisible();
  await expect(page.getByText("Local LLM (optional, app-wide)")).toBeVisible();

  // The language picker keeps its own labels bilingual on purpose; the rest
  // of the dialog must not fall back to Japanese.
  const dialogText = await page.locator(".modal-body").innerText();
  const withoutPicker = dialogText
    .replace("Language / 言語", "")
    .replace("Auto / 自動", "")
    .replace("日本語", "");
  expect(withoutPicker).not.toMatch(JAPANESE);

  await page.getByRole("button", { name: "Close" }).click();
});

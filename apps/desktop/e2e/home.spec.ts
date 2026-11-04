import { spawn, execSync, ChildProcess } from "node:child_process";
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

// The home screen is the first thing a new user (or a Store tester) sees, so
// help and the display language must both be reachable from it without
// opening a project. This launches against a throwaway config directory and
// checks that switching the language there updates the UI at once and writes
// only `ui_language`, and that help opens and returns to the home screen.

const CDP_PORT = 9336;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");

const INITIAL_CONFIG = [
  'theme = "dark"',
  'ui_language = "en"',
  "",
  "[inference]",
  'base_url = "http://127.0.0.1:8080/v1"',
  'model = "home-spec-model"',
  "",
].join("\n");

let workDir: string;
let configPath: string;
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
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-home-"));
  const configDir = path.join(workDir, "config");
  mkdirSync(configDir, { recursive: true });
  configPath = path.join(configDir, "config.toml");
  writeFileSync(configPath, INITIAL_CONFIG);

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

  // The first-run notice would sit over the home screen; it has its own spec.
  const ack = page.getByRole("button", { name: "I understand" });
  if (await ack.isVisible().catch(() => false)) await ack.click();
});

test.afterAll(async () => {
  await browser?.close().catch(() => {});
  killTree(app);
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("help opens from the home screen and returns to it", async () => {
  await page.getByRole("button", { name: "Help", exact: true }).click();

  const help = page.locator(".help-view");
  await expect(help).toBeVisible();
  const back = help.getByRole("button", { name: /Back/ });
  await expect(back).toBeVisible();
  // Opened from home, so the button must not promise a return to the review.
  await expect(back).not.toHaveText(/review/i);

  await back.click();
  await expect(help).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Import a document/ }),
  ).toBeVisible();
});

test("the home language picker switches the UI and saves only ui_language", async () => {
  const picker = page.locator(".home select");
  await expect(picker).toBeEnabled();
  // The stored preference, not the resolved language.
  await expect(picker).toHaveValue("en");
  await expect(picker).toHaveAttribute("aria-label", "Language / 言語");

  await picker.selectOption("ja");

  await expect(
    page.getByRole("button", { name: /文書を取り込む/ }),
  ).toBeVisible();
  await expect(page.locator(".home select")).toHaveAttribute(
    "aria-label",
    "言語 / Language",
  );

  await waitFor(
    async () => /ui_language = "ja"/.test(readFileSync(configPath, "utf8")),
    "ui_language to be saved",
    10_000,
  );
  const saved = readFileSync(configPath, "utf8");
  expect(saved).toMatch(/theme = "dark"/);
  expect(saved).toMatch(/base_url = "http:\/\/127\.0\.0\.1:8080\/v1"/);
  expect(saved).toMatch(/model = "home-spec-model"/);

  // Help follows the language just chosen.
  await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
  await expect(page.locator(".help-view")).toBeVisible();
  await expect(
    page.locator(".help-view").getByRole("button", { name: /戻る/ }),
  ).toBeVisible();
  await page
    .locator(".help-view")
    .getByRole("button", { name: /戻る/ })
    .click();
  await expect(page.locator(".help-view")).toHaveCount(0);

  // The settings dialog in a project sees the same preference.
  await page.getByRole("button", { name: /サンプルを開いて試す/ }).click();
  await page
    .getByRole("button", { name: "設定", exact: true })
    .click({ timeout: 120_000 });
  await expect(
    page.locator(".modal-body select[aria-label='言語 / Language']"),
  ).toHaveValue("ja");
});

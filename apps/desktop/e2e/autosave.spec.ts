import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
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

// Autosave of review decisions and entities (issue #14): failures must be
// visible, and leaving for home must write what is pending first. Each test
// leaves the review screen, and reopening a project from home needs a native
// dialog, so the app is relaunched per test while import/analyze runs once.

const CDP_PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
// Builds may be redirected off the repo drive (CARGO_TARGET_DIR); honor it.
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const cliExe = path.join(targetDir, "debug", "menreiki.exe");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");
const dummyPdf = path.join(repoRoot, "test-documents", "dummy-spec.pdf");

const FIRST_TERM = "株式会社アルファ技研";
const SECOND_TERM = "株式会社ベータ電機";
const THIRD_TERM = "田中太郎";
const HOME_IMPORT = "文書を取り込む（PDF / PNG / JPEG）";
const SAVE_FAILED = "保存に失敗しました";
const DISCARD_AND_HOME = "保存せずにホームへ戻る";

let workDir: string;
let projectDir: string;
let decisionsFile: string;
let entitiesFile: string;
let vite: ChildProcess;
let app: ChildProcess | undefined;
let browser: Browser | undefined;
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

function killStrayApps() {
  try {
    execSync("taskkill /IM menreiki-desktop.exe /F /T", { stdio: "ignore" });
  } catch {
    // none running
  }
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function savedTexts(): string[] {
  if (!existsSync(decisionsFile)) return [];
  return (readJson(decisionsFile).texts ?? []).map(
    (rule: { text: string }) => rule.text,
  );
}

async function addTextRule(term: string, replacement: string) {
  await page.getByPlaceholder("例: 株式会社アルファ技研").fill(term);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText(/\d+ 件見つかりました/)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "置換ルールに追加" }).click();
  await page.getByPlaceholder("置換後").last().fill(replacement);
}

/// Saves once and makes `decisions.json` read-only: the file may not exist
/// before the first save, and chmod needs it to.
async function makeDecisionsReadOnly() {
  await addTextRule(FIRST_TERM, "開発会社A");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible({
    timeout: 10_000,
  });
  await waitFor(async () => savedTexts().includes(FIRST_TERM), "first save");
  chmodSync(decisionsFile, 0o444);
}

test.beforeAll(async () => {
  killStrayApps();
  workDir = mkdtempSync(path.join(tmpdir(), "menreiki-e2e-autosave-"));
  projectDir = path.join(workDir, "spec.menreiki");
  decisionsFile = path.join(projectDir, "decisions", "decisions.json");
  entitiesFile = path.join(projectDir, "entities", "entities.json");
  const cliEnv = { ...process.env, MENREIKI_PDFIUM_PATH: pdfiumDir };
  execFileSync(cliExe, ["import", dummyPdf, "--project", projectDir], {
    env: cliEnv,
  });
  execFileSync(cliExe, ["analyze", projectDir], { env: cliEnv, timeout: 180_000 });

  // Pin the UI language: every assertion below reads Japanese labels.
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
});

test.beforeEach(async () => {
  // Every test starts from a project without saved decisions or entities.
  rmSync(decisionsFile, { force: true });
  rmSync(entitiesFile, { force: true });
  killStrayApps();

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
  const connected = await chromium.connectOverCDP(
    `http://127.0.0.1:${CDP_PORT}`,
  );
  browser = connected;
  await waitFor(async () => {
    const candidate = connected
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
  await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
    timeout: 120_000,
  });
});

test.afterEach(async () => {
  if (existsSync(decisionsFile)) chmodSync(decisionsFile, 0o666);
  await browser?.close().catch(() => {});
  browser = undefined;
  killTree(app);
  app = undefined;
});

test.afterAll(async () => {
  killTree(vite);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test("AC1/AC2: a failed save is shown and cleared by the next good save", async () => {
  await makeDecisionsReadOnly();

  await addTextRule(SECOND_TERM, "製造会社B");
  const failed = page.locator('[data-save-state="failed"]');
  await expect(failed).toBeVisible({ timeout: 10_000 });
  await expect(failed).toContainText(SAVE_FAILED);
  // The message carries only the fixed text and the command's error, never
  // the original names or their replacements.
  const message = (await failed.textContent()) ?? "";
  for (const secret of [FIRST_TERM, SECOND_TERM, "開発会社A", "製造会社B"]) {
    expect(message).not.toContain(secret);
  }

  chmodSync(decisionsFile, 0o666);
  await addTextRule(THIRD_TERM, "担当者C");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(SAVE_FAILED)).toBeHidden();
  // Both the rule whose save failed and the one added after recovery.
  const texts = savedTexts();
  expect(texts).toContain(SECOND_TERM);
  expect(texts).toContain(THIRD_TERM);
});

test("AC4: going home right after a change writes the decision first", async () => {
  await addTextRule(FIRST_TERM, "開発会社A");
  await page.getByRole("button", { name: "← ホーム" }).click();
  await expect(page.getByRole("button", { name: HOME_IMPORT })).toBeVisible({
    timeout: 10_000,
  });
  expect(savedTexts()).toContain(FIRST_TERM);
});

test("AC5: going home right after an alias edit writes the entity first", async () => {
  await page.getByPlaceholder("例: 株式会社アルファ技研").fill(SECOND_TERM);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "Entityとして登録" }).click();
  await expect(page.getByText("Entity（1件）")).toBeVisible();
  await page.getByPlaceholder("仮称").fill("製造会社Z");
  await page.getByRole("button", { name: "← ホーム" }).click();
  await expect(page.getByRole("button", { name: HOME_IMPORT })).toBeVisible({
    timeout: 10_000,
  });
  const entities: { alias: string }[] = readJson(entitiesFile);
  expect(entities.map((entity) => entity.alias)).toContain("製造会社Z");
});

test("AC6: a failed write on the way home keeps the reviewer on the screen", async () => {
  await makeDecisionsReadOnly();
  const before = readFileSync(decisionsFile, "utf8");

  await addTextRule(SECOND_TERM, "製造会社B");
  await page.getByRole("button", { name: "← ホーム" }).click();
  await expect(page.locator('[data-save-state="failed"]')).toBeVisible({
    timeout: 10_000,
  });
  const discard = page.getByRole("button", { name: DISCARD_AND_HOME });
  await expect(discard).toBeVisible();
  await expect(page.getByRole("button", { name: HOME_IMPORT })).toBeHidden();

  await discard.click();
  await expect(page.getByRole("button", { name: HOME_IMPORT })).toBeVisible({
    timeout: 10_000,
  });
  expect(readFileSync(decisionsFile, "utf8")).toBe(before);
});

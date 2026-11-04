import { execFileSync, spawn, execSync, ChildProcess } from "node:child_process";
import {
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

// Unreadable decisions/entities files must never be overwritten by the
// review screen's autosave (issue #12). Each describe block runs its own app
// against its own project, since the scenarios rewrite the project's files.

const CDP_PORT = 9333;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, "target");
const cliExe = path.join(targetDir, "debug", "menreiki.exe");
const appExe = path.join(targetDir, "debug", "menreiki-desktop.exe");
const pdfiumDir = path.join(repoRoot, "vendor", "pdfium");
const dummyPdf = path.join(repoRoot, "test-documents", "dummy-spec.pdf");

// Longer than the 400ms autosave debounce, with a wide margin.
const SETTLE_MS = 2000;
const DECISIONS_ERROR = "判断（decisions.json）を読み込めませんでした";
const ENTITIES_ERROR = "Entity（entities.json）を読み込めませんでした";

const TRUNCATED_DECISIONS = Buffer.from(
  '{"findings":[],"texts":[{"text":"株式会社アルファ技研","action":"replace","value":"開発会社A"',
  "utf8",
);
const VALID_DECISIONS = Buffer.from(
  JSON.stringify({
    findings: [],
    texts: [
      {
        text: "株式会社アルファ技研",
        action: "replace",
        value: "開発会社A",
        align: null,
      },
    ],
    regions: [],
    align_overrides: [],
  }),
  "utf8",
);
const TRUNCATED_ENTITIES = Buffer.from('[{"id":"e1","canonical":"株式', "utf8");

interface Session {
  workDir: string;
  projectDir: string;
  vite: ChildProcess;
  app: ChildProcess;
  browser: Browser;
  page: Page;
}

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

function decisionsFile(projectDir: string) {
  return path.join(projectDir, "decisions", "decisions.json");
}

function entitiesFile(projectDir: string) {
  return path.join(projectDir, "entities", "entities.json");
}

function writeState(file: string, bytes: Buffer) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

/// Waits for the review screen to mount and clears the first-run notice.
async function waitForReview(page: Page) {
  await page.locator(".side-pane").waitFor({ timeout: 60_000 });
  const ack = page.getByRole("button", { name: "理解しました" });
  if (await ack.isVisible().catch(() => false)) {
    await ack.click();
  }
}

async function reopen(page: Page) {
  await page.reload();
  await waitForReview(page);
}

/// Imports and analyzes a fresh project, lets `prepare` lay down state files,
/// then launches the app on it.
async function launch(prepare: (projectDir: string) => void): Promise<Session> {
  try {
    execSync("taskkill /IM menreiki-desktop.exe /F /T", { stdio: "ignore" });
  } catch {
    // none running
  }
  const workDir = mkdtempSync(path.join(tmpdir(), "menreiki-e2e-"));
  const projectDir = path.join(workDir, "spec.menreiki");
  const cliEnv = { ...process.env, MENREIKI_PDFIUM_PATH: pdfiumDir };
  execFileSync(cliExe, ["import", dummyPdf, "--project", projectDir], {
    env: cliEnv,
  });
  execFileSync(cliExe, ["analyze", projectDir], { env: cliEnv, timeout: 180_000 });
  prepare(projectDir);

  const configDir = path.join(workDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.toml"), 'ui_language = "ja"\n');
  const vite = spawn("npm", ["run", "dev"], {
    cwd: path.join(repoRoot, "apps", "desktop"),
    shell: true,
    stdio: "ignore",
  });
  await waitFor(
    async () => (await fetch("http://localhost:1420")).ok,
    "vite dev server",
    180_000,
  );

  const app = spawn(appExe, [projectDir], {
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

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  let page: Page | undefined;
  await waitFor(async () => {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("localhost:1420"));
    return page !== undefined;
  }, "app page over CDP");
  await waitForReview(page!);
  return { workDir, projectDir, vite, app, browser, page: page! };
}

async function shutdown(session: Session | undefined) {
  if (!session) return;
  await session.browser.close().catch(() => {});
  killTree(session.app);
  killTree(session.vite);
  rmSync(session.workDir, { recursive: true, force: true });
}

async function addTextRule(page: Page, text: string, value: string) {
  await page.getByPlaceholder("例: 株式会社アルファ技研").fill(text);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText(/\d+ 件見つかりました/)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "置換ルールに追加" }).click();
  await page.getByPlaceholder("置換後").last().fill(value);
}

async function registerEntity(page: Page, text: string) {
  await page.getByPlaceholder("例: 株式会社アルファ技研").fill(text);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "Entityとして登録" }).click();
}

test.describe("unreadable state files", () => {
  let session: Session | undefined;

  test.beforeAll(async () => {
    session = await launch((projectDir) => {
      writeState(decisionsFile(projectDir), TRUNCATED_DECISIONS);
    });
  });

  test.afterAll(async () => {
    await shutdown(session);
  });

  test("truncated decisions show a persistent error and are not overwritten", async () => {
    const { page, projectDir } = session!;
    const loadError = page.locator(".load-error", { hasText: DECISIONS_ERROR });
    await expect(loadError).toBeVisible({ timeout: 30_000 });
    await expect(loadError).toContainText("decisions are not valid:");
    await expect(loadError).toContainText("変更は保存されません");
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(decisionsFile(projectDir))).toEqual(TRUNCATED_DECISIONS);

    // Edits made while the load failed never reach the file (AC3), and the
    // error survives operations that clear the ordinary error (AC6).
    await addTextRule(page, "株式会社アルファ技研", "開発会社B");
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(decisionsFile(projectDir))).toEqual(TRUNCATED_DECISIONS);
    await expect(loadError).toBeVisible();
    await expect(loadError).toContainText("decisions are not valid:");
  });

  test("an empty decisions file is not overwritten", async () => {
    const { page, projectDir } = session!;
    const empty = Buffer.alloc(0);
    writeState(decisionsFile(projectDir), empty);
    await reopen(page);
    const loadError = page.locator(".load-error", { hasText: DECISIONS_ERROR });
    await expect(loadError).toBeVisible({ timeout: 30_000 });
    await expect(loadError).toContainText("decisions are not valid:");
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(decisionsFile(projectDir))).toEqual(empty);
  });

  test("corrupt entities are not overwritten while decisions keep saving", async () => {
    const { page, projectDir } = session!;
    writeState(decisionsFile(projectDir), VALID_DECISIONS);
    writeState(entitiesFile(projectDir), TRUNCATED_ENTITIES);
    await reopen(page);
    const entitiesError = page.locator(".load-error", { hasText: ENTITIES_ERROR });
    await expect(entitiesError).toBeVisible({ timeout: 30_000 });
    await expect(entitiesError).toContainText("entities are not valid:");
    await expect(
      page.locator(".load-error", { hasText: DECISIONS_ERROR }),
    ).toHaveCount(0);
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(entitiesFile(projectDir))).toEqual(TRUNCATED_ENTITIES);

    await registerEntity(page, "株式会社ベータ電機");
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(entitiesFile(projectDir))).toEqual(TRUNCATED_ENTITIES);

    // Decisions loaded fine, so their autosave still runs.
    await addTextRule(page, "株式会社ベータ電機", "開発会社C");
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(decisionsFile(projectDir), "utf8")).toContain("開発会社C");
    await expect(entitiesError).toBeVisible();
  });

  test("reopening after repairing the file resumes normally", async () => {
    const { page, projectDir } = session!;
    writeState(decisionsFile(projectDir), TRUNCATED_DECISIONS);
    rmSync(entitiesFile(projectDir), { force: true });
    await reopen(page);
    await expect(
      page.locator(".load-error", { hasText: DECISIONS_ERROR }),
    ).toBeVisible({ timeout: 30_000 });

    writeState(decisionsFile(projectDir), VALID_DECISIONS);
    await reopen(page);
    await expect(page.getByPlaceholder("置換後").first()).toHaveValue("開発会社A", {
      timeout: 30_000,
    });
    await expect(page.locator(".load-error")).toHaveCount(0);

    await addTextRule(page, "株式会社ベータ電機", "開発会社D");
    await page.waitForTimeout(SETTLE_MS);
    const saved = readFileSync(decisionsFile(projectDir), "utf8");
    expect(saved).toContain("開発会社A");
    expect(saved).toContain("開発会社D");
  });
});

test.describe("missing state files", () => {
  let session: Session | undefined;

  test.beforeAll(async () => {
    session = await launch((projectDir) => {
      rmSync(decisionsFile(projectDir), { force: true });
      rmSync(entitiesFile(projectDir), { force: true });
    });
  });

  test.afterAll(async () => {
    await shutdown(session);
  });

  test("a project without state files starts clean and saves", async () => {
    const { page, projectDir } = session!;
    await expect(page.getByText(/検出候補（\d+種/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator(".load-error")).toHaveCount(0);
    expect(existsSync(decisionsFile(projectDir))).toBe(false);

    await addTextRule(page, "株式会社アルファ技研", "開発会社A");
    await page.waitForTimeout(SETTLE_MS);
    expect(readFileSync(decisionsFile(projectDir), "utf8")).toContain("開発会社A");
    await expect(page.locator(".load-error")).toHaveCount(0);
  });
});

import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VIEWPORT,
  MAX_CONSOLE_ERRORS,
  PLAYWRIGHT_DIR_RELATIVE_PATH,
  PLAYWRIGHT_SCREENSHOTS_DIR_RELATIVE_PATH,
} from "./constants";
import {
  decideNavigationAccess,
  decideRequestAccess,
  type UrlAccessDecision,
} from "./policy";
import type { UrlPolicyConfig } from "./policy-config";

import type { Browser, BrowserContext, Page } from "playwright";

type QueryOptions = {
  selector: string;
  all?: boolean;
  attrs?: string[];
};

type WaitForOptions = {
  selector?: string;
  networkIdle?: boolean;
  timeoutMs?: number;
};

type ScreenshotOptions = {
  selector?: string;
  fullPage?: boolean;
  path?: string;
};

type ComputedStyleOptions = {
  selector: string;
  props: string[];
};

type SnapshotOptions = {
  selector?: string;
  interestingOnly?: boolean;
};

type TypeOptions = {
  selector: string;
  text: string;
  clear?: boolean;
  delayMs?: number;
};

type FillFormField = {
  selector: string;
  value: string;
  clear?: boolean;
};

type FillFormOptions = {
  fields: FillFormField[];
};

type SelectOptionOptions = {
  selector: string;
  value?: string;
  label?: string;
  index?: number;
};

type PressKeyOptions = {
  key: string;
  selector?: string;
};

type DragOptions = {
  sourceSelector: string;
  targetSelector: string;
};

export class PlaywrightPolicyBlockedError extends Error {
  constructor(
    message: string,
    readonly details: {
      requestedUrl: string;
      decision: UrlAccessDecision;
      allowRules: string[];
      denyRules: string[];
      nonRetryable: true;
      policyBlocked: true;
    },
  ) {
    super(message);
    this.name = "PlaywrightPolicyBlockedError";
  }
}

function withDefaultTimeout(timeoutMs?: number): number {
  return timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function getAllowedPlaywrightRootAbsolutePath(): string {
  return path.resolve(process.cwd(), PLAYWRIGHT_DIR_RELATIVE_PATH);
}

function isSubPath(
  candidateAbsolutePath: string,
  rootAbsolutePath: string,
): boolean {
  const relative = path.relative(rootAbsolutePath, candidateAbsolutePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function toSafeAbsoluteScreenshotPath(filePath?: string): string {
  const defaultRelativePath = path.join(
    PLAYWRIGHT_SCREENSHOTS_DIR_RELATIVE_PATH,
    `pi-playwright-${Date.now()}.png`,
  );

  const rawPath = filePath ?? defaultRelativePath;
  const absolutePath = path.resolve(process.cwd(), rawPath);
  const allowedRoot = getAllowedPlaywrightRootAbsolutePath();

  if (!isSubPath(absolutePath, allowedRoot)) {
    throw new Error(
      `Screenshot path is outside allowed directory. Allowed root: ${allowedRoot}`,
    );
  }

  return absolutePath;
}

export class PlaywrightSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private isOpened = false;
  private consoleErrors: Array<{
    timestamp: number;
    type: string;
    text: string;
  }> = [];

  constructor(private readonly getPolicyConfig: () => UrlPolicyConfig) {}

  async ensureStarted(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      return;
    }

    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: DEFAULT_VIEWPORT,
    });

    await this.context.route("**/*", async (route) => {
      const url = route.request().url();
      const decision = decideRequestAccess(url, this.getPolicyConfig());
      if (!decision.allowed) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

    this.page.on("console", (message) => {
      if (message.type() !== "error") {
        return;
      }
      this.pushConsoleError({
        timestamp: Date.now(),
        type: "console",
        text: message.text(),
      });
    });

    this.page.on("pageerror", (error) => {
      this.pushConsoleError({
        timestamp: Date.now(),
        type: "pageerror",
        text: String(error),
      });
    });
  }

  private pushConsoleError(error: {
    timestamp: number;
    type: string;
    text: string;
  }) {
    this.consoleErrors.push(error);
    if (this.consoleErrors.length > MAX_CONSOLE_ERRORS) {
      this.consoleErrors.shift();
    }
  }

  private getPageOrThrow(): Page {
    if (!this.page || this.page.isClosed() || !this.isOpened) {
      throw new Error("No active page. Call playwright_open first.");
    }
    return this.page;
  }

  async open(url: string): Promise<{ finalUrl: string; title: string }> {
    const policyConfig = this.getPolicyConfig();
    const decision = decideNavigationAccess(url, policyConfig);
    if (!decision.allowed) {
      throw new PlaywrightPolicyBlockedError(decision.reason, {
        requestedUrl: url,
        decision,
        allowRules: [...policyConfig.allow],
        denyRules: [...policyConfig.deny],
        nonRetryable: true,
        policyBlocked: true,
      });
    }

    await this.ensureStarted();
    if (!this.page) {
      throw new Error("Failed to initialize Playwright page");
    }

    await this.page.goto(decision.normalizedUrl ?? url, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });

    this.isOpened = true;

    return {
      finalUrl: this.page.url(),
      title: await this.page.title(),
    };
  }

  async query(options: QueryOptions) {
    const page = this.getPageOrThrow();
    const { selector, all = false, attrs = [] } = options;

    if (all) {
      const results = await page.$$eval(
        selector,
        (elements, attributeNames) => {
          return elements.map((element) => {
            const attrsRecord: Record<string, string | null> = {};
            for (const attr of attributeNames as string[]) {
              attrsRecord[attr] = element.getAttribute(attr);
            }
            return {
              text: element.textContent?.trim() ?? "",
              attrs: attrsRecord,
            };
          });
        },
        attrs,
      );

      return {
        exists: results.length > 0,
        count: results.length,
        items: results,
      };
    }

    const locator = page.locator(selector).first();
    const count = await page.locator(selector).count();
    const exists = count > 0;

    if (!exists) {
      return {
        exists,
        count,
        text: "",
        attrs: {},
      };
    }

    const text = (await locator.textContent())?.trim() ?? "";
    const attrsResult: Record<string, string | null> = {};
    for (const attr of attrs) {
      attrsResult[attr] = await locator.getAttribute(attr);
    }

    return {
      exists,
      count,
      text,
      attrs: attrsResult,
    };
  }

  async snapshot(options: SnapshotOptions) {
    const page = this.getPageOrThrow();
    const interestingOnly = options.interestingOnly ?? true;

    if (!options.selector) {
      const tree = await page.accessibility.snapshot({ interestingOnly });
      return {
        interestingOnly,
        selector: null,
        tree,
      };
    }

    const locator = page.locator(options.selector).first();
    const handle = await locator.elementHandle();
    if (!handle) {
      throw new Error(`Snapshot root selector not found: ${options.selector}`);
    }

    const tree = await page.accessibility.snapshot({
      interestingOnly,
      root: handle,
    });

    return {
      interestingOnly,
      selector: options.selector,
      tree,
    };
  }

  async computedStyle(options: ComputedStyleOptions) {
    const page = this.getPageOrThrow();
    const { selector, props } = options;

    const styles = await page.$eval(
      selector,
      (element, propNames) => {
        const computed = window.getComputedStyle(element);
        const result: Record<string, string> = {};
        for (const prop of propNames as string[]) {
          result[prop] = computed.getPropertyValue(prop);
        }
        return result;
      },
      props,
    );

    return {
      selector,
      styles,
    };
  }

  async hover(selector: string): Promise<void> {
    const page = this.getPageOrThrow();
    await page.locator(selector).first().hover();
  }

  async click(selector: string): Promise<void> {
    const page = this.getPageOrThrow();
    await page.locator(selector).first().click();
  }

  async type(options: TypeOptions): Promise<void> {
    const page = this.getPageOrThrow();
    const locator = page.locator(options.selector).first();

    if (options.clear) {
      await locator.fill("");
    }

    await locator.type(options.text, {
      delay: options.delayMs,
    });
  }

  async fillForm(options: FillFormOptions): Promise<void> {
    const page = this.getPageOrThrow();

    for (const field of options.fields) {
      const locator = page.locator(field.selector).first();
      if (field.clear ?? true) {
        await locator.fill("");
      }
      await locator.type(field.value);
    }
  }

  async selectOption(
    options: SelectOptionOptions,
  ): Promise<{ selected: string[] }> {
    const page = this.getPageOrThrow();
    const locator = page.locator(options.selector).first();

    if (options.value !== undefined) {
      const selected = await locator.selectOption({ value: options.value });
      return { selected };
    }

    if (options.label !== undefined) {
      const selected = await locator.selectOption({ label: options.label });
      return { selected };
    }

    if (options.index !== undefined) {
      const selected = await locator.selectOption({ index: options.index });
      return { selected };
    }

    throw new Error("selectOption requires one of: value, label, or index");
  }

  async pressKey(options: PressKeyOptions): Promise<void> {
    const page = this.getPageOrThrow();

    if (options.selector) {
      const locator = page.locator(options.selector).first();
      await locator.focus();
      await locator.press(options.key);
      return;
    }

    await page.keyboard.press(options.key);
  }

  async drag(options: DragOptions): Promise<void> {
    const page = this.getPageOrThrow();
    await page
      .locator(options.sourceSelector)
      .first()
      .dragTo(page.locator(options.targetSelector).first());
  }

  async scrollTo(selector: string): Promise<void> {
    const page = this.getPageOrThrow();
    await page.locator(selector).first().scrollIntoViewIfNeeded();
  }

  async navigateHash(hash: string): Promise<string> {
    const page = this.getPageOrThrow();
    const normalizedHash = hash.startsWith("#") ? hash : `#${hash}`;
    await page.evaluate((nextHash) => {
      window.location.hash = nextHash;
    }, normalizedHash);
    return page.url();
  }

  async screenshot(options: ScreenshotOptions): Promise<{ path: string }> {
    const page = this.getPageOrThrow();
    const targetPath = toSafeAbsoluteScreenshotPath(options.path);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (options.selector) {
      await page
        .locator(options.selector)
        .first()
        .screenshot({ path: targetPath });
    } else {
      await page.screenshot({
        path: targetPath,
        fullPage: options.fullPage ?? false,
      });
    }

    return { path: targetPath };
  }

  async waitFor(options: WaitForOptions): Promise<{ waitedFor: string }> {
    const page = this.getPageOrThrow();
    const timeout = withDefaultTimeout(options.timeoutMs);

    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout });
      return { waitedFor: `selector:${options.selector}` };
    }

    if (options.networkIdle) {
      await page.waitForLoadState("networkidle", { timeout });
      return { waitedFor: "networkIdle" };
    }

    await page.waitForTimeout(timeout);
    return { waitedFor: `timeout:${timeout}` };
  }

  getConsoleErrors() {
    return {
      count: this.consoleErrors.length,
      items: [...this.consoleErrors],
    };
  }

  async dispose(): Promise<void> {
    this.isOpened = false;

    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
    this.page = null;

    if (this.context) {
      await this.context.close();
    }
    this.context = null;

    if (this.browser) {
      await this.browser.close();
    }
    this.browser = null;
  }
}

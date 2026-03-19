import path from "node:path";
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VIEWPORT,
  MAX_CONSOLE_ERRORS,
} from "./constants";
import { decideNavigationAccess, decideRequestAccess } from "./policy";

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

function withDefaultTimeout(timeoutMs?: number): number {
  return timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function toAbsoluteScreenshotPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(process.cwd(), filePath);
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
      const decision = decideRequestAccess(url);
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
    const decision = decideNavigationAccess(url);
    if (!decision.allowed) {
      throw new Error(decision.reason);
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
    const timestamp = Date.now();
    const targetPath = toAbsoluteScreenshotPath(
      options.path ?? `/tmp/pi-playwright-${timestamp}.png`,
    );

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

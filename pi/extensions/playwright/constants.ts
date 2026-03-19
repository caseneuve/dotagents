export const EXTENSION_NAME = "playwright";

export const TOOL_NAMES = {
  open: "playwright_open",
  query: "playwright_query",
  computedStyle: "playwright_computed_style",
  hover: "playwright_hover",
  click: "playwright_click",
  scrollTo: "playwright_scroll_to",
  navigateHash: "playwright_navigate_hash",
  screenshot: "playwright_screenshot",
  waitFor: "playwright_wait_for",
  consoleErrors: "playwright_console_errors",
} as const;

export const COMMAND_NAMES = {
  settings: "playwright-settings",
} as const;

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
export const MAX_CONSOLE_ERRORS = 200;

export const INTERNAL_ALLOWED_PROTOCOLS = new Set(["about:", "data:", "blob:"]);

export const POLICY_DEFAULT_ALLOWED_RULE = "http://localhost:3000";
export const POLICY_FILE_RELATIVE_PATH = ".pi/playwright-policy.json";

export const SETTINGS_ACTIONS = {
  showSummary: "View policy summary",
  addAllowRule: "Add allow rule",
  addDenyRule: "Add deny rule",
  removeAllowRule: "Remove allow rule",
  removeDenyRule: "Remove deny rule",
  saveAndExit: "Save and exit",
  exitWithoutSaving: "Exit without saving",
} as const;

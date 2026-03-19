# playwright extension

Native Playwright tools for Pi.

## Install deps with Bun

```bash
cd pi/extensions/playwright
bun install
bunx playwright install chromium
```

## Current security policy (dev)

Default policy starts as:

- `allow: ["http://localhost:3000"]`
- `deny: []`

Manage policy with `/playwright-settings`.

Notes:

- Rules can be entered as full URL patterns (`https://*.example.com`) or domain/path only (`*.example.com/app`).
- Domain/path input prompts protocol choice (`http`, `https`, or `both`).
- Copy-pasted rules with duplicate protocol prefixes are sanitized.
- Policy is allowlist-only: URLs must match allow rules.
- Deny rules always win over allow rules.

## Tools

- `playwright_open`
- `playwright_query`
- `playwright_computed_style`
- `playwright_hover`
- `playwright_click`
- `playwright_scroll_to`
- `playwright_navigate_hash`
- `playwright_screenshot`
- `playwright_wait_for`
- `playwright_console_errors`

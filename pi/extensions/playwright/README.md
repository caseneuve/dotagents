# playwright extension

Native Playwright tools for Pi.

## Install deps with Bun

```bash
cd pi/extensions/playwright
bun install
bunx playwright install chromium
```

## Current security policy (dev)

Only `http://localhost:3000` is allowed for navigation and network requests.

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

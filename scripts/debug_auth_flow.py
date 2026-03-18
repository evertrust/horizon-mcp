"""Diagnostic script: trace the OIDC auth flow and log cookies/redirects."""

import asyncio
import sys


async def main():
    from playwright.async_api import async_playwright

    url = "https://horizon-demo.evertrust.fr"

    async with async_playwright() as p:
        # Try system Chrome first, fall back to bundled Chromium
        for channel in ("chrome", None):
            try:
                label = "system Chrome" if channel else "bundled Chromium"
                print(f"\n{'='*60}")
                print(f"Launching {label}...")
                browser = await p.chromium.launch(
                    headless=False,
                    channel=channel,
                )
                print(f"  OK  -  using {label}")
                break
            except Exception as exc:
                if channel:
                    print(f"  System Chrome not found, trying bundled Chromium...")
                    continue
                raise

        context = await browser.new_context(ignore_https_errors=False)

        # Track every request/response for redirect chain
        page = await context.new_page()

        def on_request(req):
            print(f"\n  >>> {req.method} {req.url}")

        def on_response(resp):
            status = resp.status
            location = resp.headers.get("location", "")
            set_cookies = resp.headers.get("set-cookie", "")
            print(f"  <<< {status} {resp.url[:80]}")
            if location:
                print(f"      Location: {location[:120]}")
            if set_cookies:
                # Only show cookie names, not values (they're long JWTs)
                for part in set_cookies.split("\n"):
                    name = part.split("=")[0].strip()
                    attrs = [a.strip() for a in part.split(";")[1:] if a.strip()]
                    print(f"      Set-Cookie: {name} ({', '.join(attrs[:4])})")

        page.on("request", on_request)
        page.on("response", on_response)

        print(f"\n{'='*60}")
        print(f"Navigating to {url}...")
        print(f"{'='*60}")

        try:
            await page.goto(url, timeout=30000)
        except Exception as exc:
            print(f"\n  !!! Navigation error: {exc}")

        print(f"\n{'='*60}")
        print(f"Page loaded. Current URL: {page.url}")
        print(f"{'='*60}")

        # Show cookies after initial navigation
        cookies = await context.cookies()
        print(f"\nCookies after initial navigation ({len(cookies)} total):")
        for c in cookies:
            print(f"  {c['name']} = {c['value'][:40]}... "
                  f"(domain={c['domain']}, path={c['path']}, "
                  f"secure={c['secure']}, sameSite={c.get('sameSite', '?')})")

        print(f"\n{'='*60}")
        print("Complete the login in the browser window.")
        print("Watching for cookie changes...")
        print(f"{'='*60}")

        # Poll for PLAY_SESSION changes
        initial_ps = None
        for c in cookies:
            if c["name"] == "PLAY_SESSION":
                initial_ps = c["value"]
                print(f"\n  Initial PLAY_SESSION: {initial_ps[:40]}...")

        if not initial_ps:
            print("\n  No initial PLAY_SESSION cookie found.")

        for i in range(600):  # 5 min
            await asyncio.sleep(0.5)
            current_cookies = await context.cookies()
            for c in current_cookies:
                if c["name"] == "PLAY_SESSION" and c["value"] != initial_ps:
                    print(f"\n  *** PLAY_SESSION CHANGED at {i*0.5:.0f}s!")
                    print(f"      New value: {c['value'][:40]}...")
                    print(f"      Page URL: {page.url}")
                    print(f"\n  All cookies now:")
                    for cc in current_cookies:
                        print(f"    {cc['name']} = {cc['value'][:40]}...")
                    await browser.close()
                    print("\nDone! Auth flow succeeded.")
                    return

            # Log URL changes
            if i > 0 and i % 10 == 0:
                print(f"  [{i*0.5:.0f}s] Still waiting... URL: {page.url[:80]}")

        print("\nTimeout  -  PLAY_SESSION never changed.")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

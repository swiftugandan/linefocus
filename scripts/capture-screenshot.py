#!/usr/bin/env python3
"""Captures site/editor.png from the running app for the marketing page.

Usage: python3 scripts/capture-screenshot.py [url]
Default URL is http://127.0.0.1:8765/ (start it with `npm start`). Set CHROMIUM_PATH to use a specific
Chromium build; otherwise Playwright's own is used."""
import os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
out = Path(__file__).resolve().parent.parent / 'site' / 'editor.png'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    # bypass_csp lets Playwright evaluate its readiness check under the app's strict policy.
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2, color_scheme='light', bypass_csp=True)
    page = context.new_page()
    page.goto(url)
    page.evaluate('() => { indexedDB.deleteDatabase("linefocus"); localStorage.clear(); }')
    page.reload()
    page.wait_for_function('window.linefocus && window.linefocus.ready', timeout=20000)
    page.evaluate('() => window.linefocus.store.transact("Name the example", d => { d.title = "EuroTrough-class collector"; d.designPoint.transversalDeg = 0.2; })')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(out))
    browser.close()
print(f'Wrote {out}')

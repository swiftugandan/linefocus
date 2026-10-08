#!/usr/bin/env python3
"""Open a Linefocus design in the real app and save screenshots you can look at.

    python3 preview.py design.linefocus.json                  # writes design-preview/ next to the file
    python3 preview.py design.linefocus.json --out previews   # choose the folder

It starts the checkout's own development server (found by checkout.mjs), loads the design through the app's file
loader, waits for the design point and every study, and saves:

  * overview.png    the editor: cross-section with traced rays, design panel and design-point results
  * <study>.png     the results dock for acceptance, incidence angle, day and year

Needs Python Playwright (python3 -m pip install playwright). It uses Playwright's Chromium, falls back to an
installed Google Chrome, and CHROMIUM_PATH points it at any other Chromium-based browser.
"""
import argparse, os, pathlib, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('design')
    ap.add_argument('--out')
    args = ap.parse_args()
    design = pathlib.Path(args.design).resolve()
    out = pathlib.Path(args.out) if args.out else design.with_name(design.name.replace('.linefocus.json', '').replace('.json', '') + '-preview')
    out.mkdir(parents=True, exist_ok=True)
    checkout = subprocess.run(['node', str(HERE / 'checkout.mjs')], capture_output=True, text=True, check=True).stdout.strip()
    port = free_port()
    server = subprocess.Popen(['node', 'serve.mjs'], cwd=checkout, env={**os.environ, 'PORT': str(port)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH')
            try:
                browser = p.chromium.launch(executable_path=executable) if executable else p.chromium.launch()
            except Exception:
                browser = p.chromium.launch(channel='chrome')
            # The app's dev server sends a strict Content Security Policy; Playwright's evaluation needs it bypassed.
            page = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2, bypass_csp=True).new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{port}/')
            page.wait_for_function('window.linefocus && window.linefocus.ready', timeout=30000)
            text = design.read_text()
            loaded = page.evaluate("""async text => { const { parseDesign } = await import('/src/core/model.js');
              const app = window.linefocus; app.store.replace(parseDesign(text)); return app.store.design.title; }""", text)
            page.wait_for_function("""() => { const a = window.linefocus; return !a.running && a.result && a.resultRevision === a.store.revision
              && a.annual.result && !a.annual.state.running && a.annual.revision === a.store.revision && a.acceptance.revision === a.store.revision; }""", timeout=180000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(out / 'overview.png'))
            for study in ['acceptance', 'incidence', 'day', 'year']:
                page.click(f'.study[data-study="{study}"]')
                page.wait_for_timeout(250)
                page.locator('#dock').screenshot(path=str(out / f'{study}.png'))
            browser.close()
        print(f'Opened "{loaded}" in Linefocus and wrote previews to {out}/')
        if errors:
            print('The app reported errors:\n  ' + '\n  '.join(errors)); sys.exit(1)
    finally:
        server.terminate()


if __name__ == '__main__':
    main()

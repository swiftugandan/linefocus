#!/usr/bin/env python3
"""End-to-end checks of the Linefocus editor in a real browser.

Usage: python3 tests/browser_test.py
Environment:
  LINEFOCUS_URL  page to test (default http://127.0.0.1:8765/, the dev server from `npm start`)
  CHROMIUM_PATH  Chromium executable to use instead of Playwright's own

Writes test-results/browser-report.json and screenshots, and exits non-zero if any check fails."""
import json, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('LINEFOCUS_URL', 'http://127.0.0.1:8765/')
OUT = Path(__file__).resolve().parent.parent / 'test-results'
OUT.mkdir(exist_ok=True)
results = []


def check(name, ok, detail=None):
    results.append({'check': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or detail is None else f' ({detail})'))


def wait_ready(page):
    page.wait_for_function('window.linefocus && window.linefocus.ready && window.linefocus.result', timeout=20000)


def wait_settled(page):
    page.wait_for_function('!window.linefocus.running && window.linefocus.resultRevision === window.linefocus.store.revision', timeout=20000)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
    # The dev server sends a strict Content Security Policy; Playwright's own evaluation needs it bypassed.
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True, bypass_csp=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)
    page.evaluate('() => { indexedDB.deleteDatabase("linefocus"); localStorage.clear(); }')
    page.reload()
    wait_ready(page)
    wait_settled(page)

    # Every enabled button on every ribbon tab must reach its command when clicked.
    page.evaluate('''() => { const c = window.linefocus.commands; const run = c.run.bind(c); window.__ran = [];
      c.run = id => { window.__ran.push(id); return run(id); }; }''')
    # Commands that open a file picker, start a download or replace the design are clicked elsewhere or skipped.
    skip = {'open', 'save', 'export-csv', 'export-png', 'export-ray-optics', 'new-trough'}
    unrouted = []
    tabs = page.evaluate("() => [...document.querySelectorAll('.tab')].map(t => t.dataset.tab)")
    for tab in tabs:
        page.click(f'.tab[data-tab="{tab}"]')
        for cmd in page.evaluate("() => [...document.querySelectorAll('.ribbon [data-cmd]')].filter(b => !b.disabled).map(b => b.dataset.cmd)"):
            if cmd in skip:
                continue
            before = page.evaluate('() => window.__ran.length')
            page.click(f'.ribbon [data-cmd="{cmd}"]')
            if page.evaluate('() => document.getElementById("dialog").open'):
                page.keyboard.press('Escape')
            if page.evaluate('() => window.__ran.length') == before:
                unrouted.append(f'{tab}:{cmd}')
            # Undo anything the click changed so later checks start from the default design.
            page.evaluate('() => { const s = window.linefocus.store; while (s.canUndo) s.undo(); }')
            if cmd.startswith('toggle-'):
                page.evaluate(f'() => window.linefocus.commands.run("{cmd}")')
    check('every enabled ribbon button runs its command', not unrouted, unrouted)
    page.click('.tab[data-tab="design"]')
    wait_settled(page)

    eff = page.evaluate('() => window.linefocus.result.trace.efficiency')
    check('the default trough traces to a plausible optical efficiency', 0.8 < eff < 0.9, eff)
    check('the results dock shows the design point', page.locator('.dock h3', has_text='Design point').count() == 1)

    # Drag the aperture handle outwards.
    hx, hy = page.evaluate("""() => { const v = window.linefocus.view; const h = v.handles.find(h => h.id === 'aperture');
      const [x, y] = v.toScreen(h.x, h.y); const r = v.canvas.getBoundingClientRect(); return [r.left + x, r.top + y]; }""")
    page.mouse.move(hx, hy); page.mouse.down(); page.mouse.move(hx + 50, hy, steps=10); page.mouse.up()
    wait_settled(page)
    state = page.evaluate('() => ({ w: window.linefocus.store.design.collector.apertureWidth, n: window.linefocus.store.undoStack.length, label: window.linefocus.store.undoLabel })')
    check('dragging the rim widens the aperture as one undo step', state['w'] > 5.77 and state['n'] == 1 and state['label'] == 'Drag aperture width', state)

    # Type a value, then an out-of-range value.
    page.fill('[data-path="collector.focalLength"]', '1.9'); page.keyboard.press('Enter')
    wait_settled(page)
    check('typing a focal length applies it', page.evaluate('() => window.linefocus.store.design.collector.focalLength') == 1.9)
    page.fill('[data-path="collector.focalLength"]', '100'); page.keyboard.press('Enter')
    message = page.locator('.field-error:not([hidden])').first.text_content(timeout=3000)
    check('an out-of-range value is refused with a message', 'Focal length must be' in (message or '') and page.evaluate('() => window.linefocus.store.design.collector.focalLength') == 1.9, message)
    page.keyboard.press('Escape')

    page.locator('#viewport canvas').click(position={'x': 30, 'y': 30})
    page.keyboard.press('Control+z')
    check('undo restores the previous focal length', page.evaluate('() => window.linefocus.store.design.collector.focalLength') == 1.71)

    # Autosave and restore.
    page.wait_for_function("document.getElementById('saveState').textContent === 'Saved on this device'", timeout=5000)
    page.reload(); wait_ready(page)
    check('the design is restored after a reload', abs(page.evaluate('() => window.linefocus.store.design.collector.apertureWidth') - state['w']) < 1e-9)

    # Command palette.
    page.keyboard.press('Control+k'); page.keyboard.type('dark theme'); page.keyboard.press('Enter')
    check('the command palette runs a command', page.evaluate('() => document.documentElement.dataset.theme') == 'dark')
    page.screenshot(path=str(OUT / 'desktop-dark.png'))
    page.keyboard.press('Control+k'); page.keyboard.type('dark theme'); page.keyboard.press('Enter')

    # Download the design and read it back.
    with page.expect_download() as download:
        page.keyboard.press('Control+s')
    saved = json.loads(Path(download.value.path()).read_text())
    check('the downloaded design is a valid Linefocus file', saved.get('format') == 'linefocus.design' and saved.get('version') == 1, download.value.suggested_filename)

    # Ray Optics export.
    with page.expect_download() as ro:
        page.click('.stage-actions [data-cmd="export-ray-optics"]')
    scene = json.loads(Path(ro.value.path()).read_text())
    check('the Ray Optics export is a version 5 scene with a beam and a parabolic mirror', scene.get('version') == 5 and {'Beam', 'ParabolicMirror'} <= {o['type'] for o in scene['objs']})

    page.screenshot(path=str(OUT / 'desktop.png'))
    check('no console or page errors on desktop', not errors, errors)

    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, bypass_csp=True)
    mpage = mobile.new_page()
    merrors = []
    mpage.on('pageerror', lambda e: merrors.append(str(e)))
    mpage.goto(URL); wait_ready(mpage)
    overflow = mpage.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
    check('the phone layout has no horizontal overflow', overflow <= 0, overflow)
    mpage.screenshot(path=str(OUT / 'mobile.png'))
    check('no page errors on a phone', not merrors, merrors)
    browser.close()

(OUT / 'browser-report.json').write_text(json.dumps({'url': URL, 'results': results}, indent=2) + '\n')
failed = [r for r in results if not r['ok']]
print(f"\n{len(results) - len(failed)} of {len(results)} checks passed")
sys.exit(1 if failed else 0)

// Drives the built demo in a real Chrome and checks what jsdom cannot:
//  - Chrome's own accessibility tree, read over the DevTools protocol (roles,
//    names, pressed state, live-region politeness, and what a modal removes)
//  - the live regions' actual contents after real timers
//  - axe-core with colour contrast, which needs real layout, in light and dark
//
// This proves the DOM and ARIA mechanism in a real browser engine. It does not
// prove what JAWS, NVDA, VoiceOver or TalkBack say: none of them is involved.
//
// Needs Chrome installed (set CHROME_PATH to use another binary) and a built
// demo:  npm run demo:build && npm run e2e
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'

const root = join(process.cwd(), 'demo-dist')
assert.ok(existsSync(root), 'demo-dist is missing: run `npm run demo:build` first')

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, path === '/' ? 'index.html' : path)
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
)

const results = []
const check = async (name, run) => {
  try {
    await run()
    results.push([true, name])
  } catch (error) {
    results.push([false, `${name}\n      ${String(error.message).split('\n').join('\n      ')}`])
  }
}

/** The nodes of Chrome's native accessibility tree that are exposed to assistive technology. */
async function axTree(page) {
  const client = await page.context().newCDPSession(page)
  await client.send('Accessibility.enable')
  const { nodes } = await client.send('Accessibility.getFullAXTree')
  await client.detach()
  return nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      role: node.role?.value,
      name: node.name?.value ?? '',
      props: Object.fromEntries((node.properties ?? []).map((p) => [p.name, p.value?.value])),
    }))
}

const axeSource = readFileSync(join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
const region = (page, kind) => page.locator(`[data-call-a11y-region="${kind}"]`)
const history = (page) => page.getByRole('log', { name: /Announcement history/ })

async function open(colorScheme = 'light') {
  const context = await browser.newContext({ colorScheme, viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  await page.getByRole('heading', { name: 'The call' }).waitFor()
  return { page, context, errors }
}

// ---------------------------------------------------------------- behaviour
{
  const { page, context, errors } = await open()

  await check('two live regions exist before anything is said, and Chrome exposes them as polite and assertive', async () => {
    assert.equal(await region(page, 'polite').getAttribute('role'), 'status')
    assert.equal(await region(page, 'assertive').getAttribute('role'), 'alert')
    const tree = await axTree(page)
    assert.ok(tree.some((n) => n.role === 'status' && n.props.live === 'polite'), 'no polite status in the AX tree')
    assert.ok(tree.some((n) => n.role === 'alert' && n.props.live === 'assertive'), 'no assertive alert in the AX tree')
  })

  await check('toggle buttons keep a fixed name and Chrome reports the pressed state', async () => {
    const mute = async () => (await axTree(page)).filter((n) => n.role === 'button' && n.name === 'Mute')
    const before = await mute()
    assert.equal(before.length, 1, 'expected exactly one button named "Mute"')
    assert.equal(String(before[0].props.pressed), 'false')

    await page.getByRole('button', { name: 'Mute' }).click()
    const after = await mute()
    assert.equal(after.length, 1, 'the name must not change with the state')
    assert.equal(String(after[0].props.pressed), 'true')
    const renamed = (await axTree(page)).filter((n) => n.role === 'button' && /unmute/i.test(n.name))
    await page.getByRole('button', { name: 'Mute' }).click() // restore, before asserting, so a failure cannot leave the page changed
    assert.equal(renamed.length, 0, 'no button may be renamed "Unmute"')
  })

  await check('five people joining at once produce ONE polite message', async () => {
    // Count "joined" entries, not all messages: earlier steps can still have a
    // paced message waiting, and that is not what this check is about.
    const joinedEntries = () => history(page).locator('p', { hasText: /joined$/ }).count()
    const before = await joinedEntries()
    await page.getByRole('button', { name: 'Five people join at once' }).click()
    await page.waitForFunction(
      () => /joined$/.test(document.querySelector('[data-call-a11y-region="polite"]')?.textContent ?? ''),
      null,
      { timeout: 4000 },
    )
    await page.waitForTimeout(1500) // long enough for a stray second message to show up
    assert.equal(await region(page, 'polite').textContent(), 'Jo, Lee, Kim, and 2 others joined')
    assert.equal((await joinedEntries()) - before, 1, 'five join events should be one message')
  })

  await check('a drop-and-return blip says nothing', async () => {
    const entriesBefore = await history(page).locator('p').count()
    await page.getByRole('button', { name: 'Sam drops and comes straight back' }).click()
    await page.waitForTimeout(2200)
    assert.equal(await history(page).locator('p').count(), entriesBefore)
  })

  await check('recording start goes to the assertive region', async () => {
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.waitForFunction(
      () => document.querySelector('[data-call-a11y-region="assertive"]')?.textContent === 'Recording started',
      null,
      { timeout: 3000 },
    )
  })

  await check('Alt+M mutes, announces, and flips the button', async () => {
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Alt+KeyM')
    await page.waitForFunction(
      () => /Microphone off/.test(document.querySelector('[data-call-a11y-region="polite"]')?.textContent ?? ''),
      null,
      { timeout: 3000 },
    )
    assert.equal(await page.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed'), 'true')
  })

  await check('switching shortcuts off makes Alt+M do nothing', async () => {
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Alt+KeyM')
    await page.waitForTimeout(300)
    assert.equal(await page.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed'), 'true')
  })

  await check('captions: a named, focusable log that is not a live region, filling as speech streams', async () => {
    await page.getByRole('button', { name: 'Simulated speech' }).click()
    const log = page.getByRole('log', { name: 'Live captions' })
    assert.equal(await log.getAttribute('aria-live'), 'off')
    assert.equal(await log.getAttribute('tabindex'), '0')
    await page.waitForFunction(
      () => /Priya:/.test(document.querySelector('[aria-label="Live captions"]')?.textContent ?? ''),
      null,
      { timeout: 4000 },
    )
  })

  await check('focusing the caption log stops it following, and the jump button resumes', async () => {
    const log = page.getByRole('log', { name: 'Live captions' })
    await log.focus()
    await page.getByRole('button', { name: 'Jump to latest captions' }).waitFor({ timeout: 2000 })
    await page.getByRole('button', { name: 'Jump to latest captions' }).click()
    await page.getByRole('button', { name: 'Jump to latest captions' }).waitFor({ state: 'detached', timeout: 2000 })
  })

  await check('gotcha: a modal dialog removes the live regions outside it from the accessibility tree', async () => {
    const has = async () => (await axTree(page)).some((n) => n.role === 'status' && n.props.live === 'polite')
    assert.equal(await has(), true)
    await page.evaluate(() => {
      const dialog = document.createElement('dialog')
      dialog.id = 'gotcha'
      dialog.innerHTML = '<p>Settings</p><button>Close</button>'
      document.body.append(dialog)
      dialog.showModal()
    })
    assert.equal(await has(), false, 'an inert live region should not be exposed, which is why `container` exists')
    await page.evaluate(() => document.getElementById('gotcha').remove())
    assert.equal(await has(), true)
  })

  await check('no console errors or uncaught exceptions', async () => {
    assert.deepEqual(errors, [])
  })

  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click() // back on for the picture
  await page.screenshot({ path: 'docs/demo-light.png', fullPage: true })
  await context.close()
}

// -------------------------------------------------------------------- axe
for (const scheme of ['light', 'dark']) {
  const { page, context } = await open(scheme)
  await page.getByRole('button', { name: 'Simulated speech' }).click()
  await page.getByRole('button', { name: 'Five people join at once' }).click()
  await page.waitForTimeout(1600)

  await check(`axe-core, all rules including colour contrast, ${scheme} scheme`, async () => {
    await page.addScriptTag({ content: axeSource })
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document)
      return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    })
    assert.deepEqual(violations, [])
  })

  if (scheme === 'dark') await page.screenshot({ path: 'docs/demo-dark.png', fullPage: true })
  await context.close()
}

await browser.close()
server.close()

for (const [ok, name] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
const failed = results.filter(([ok]) => !ok).length
console.log(`\n${results.length - failed} of ${results.length} browser checks passed`)
process.exit(failed ? 1 : 0)

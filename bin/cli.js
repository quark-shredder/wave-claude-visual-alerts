#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, readdirSync, readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { execFileSync, execSync } from 'child_process'
import {
  findSettingsPath,
  loadSettings,
  backupSettings,
  addHookEntry,
  removeHookEntries,
  saveSettings,
  countRegisteredEvents,
} from '../lib/settings.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version

const INSTALL_DIR = join(homedir(), '.wave-alerts')
const HOOKS_DIR = join(INSTALL_DIR, 'hooks')
const INSTALLED_HOOK = join(HOOKS_DIR, 'wave-alert-hook.sh')
const SOURCE_HOOK = join(ROOT, 'hooks', 'wave-alert-hook.sh')
const SHIM_DIR = join(INSTALL_DIR, 'bin')
const INSTALLED_SHIM = join(SHIM_DIR, 'open')
const SOURCE_SHIM = join(ROOT, 'shim', 'open')
const SHIM_PATH_LINE = 'export PATH="$HOME/.wave-alerts/bin:$PATH"'
const HOOK_TIMEOUT = 3

// Claude Code event -> argument passed to the hook script.
// Only events that support a matcher get one; Stop and UserPromptSubmit do not.
const EVENTS = [
  { event: 'UserPromptSubmit', arg: 'busy' },
  // A turn started with a `!` bash command never fires UserPromptSubmit, so
  // PreToolUse arms the spinner too. It exits in ~5ms when already spinning.
  { event: 'PreToolUse', arg: 'busy', matcher: '*' },
  { event: 'PermissionRequest', arg: 'input', matcher: '*' },
  { event: 'Notification', arg: 'waiting', matcher: 'idle_prompt|agent_needs_input' },
  { event: 'Elicitation', arg: 'mcp', matcher: '*' },
  { event: 'Stop', arg: 'done' },
  { event: 'StopFailure', arg: 'failed', matcher: '*' },
  { event: 'SessionEnd', arg: 'end', matcher: '*' },
]

// Colour carries urgency, animation carries kind. See README.
const SCHEME = [
  ['busy',     'UserPromptSubmit/PreToolUse', 'spinner+spin',   '#429DFF', 'working, no action'],
  ['input',    'PermissionRequest', 'hand+beat',             '#FF9500', 'needs a permission decision'],
  ['waiting',  'Notification',      'circle-question+fade',  '#FFE900', 'idle, waiting on you'],
  ['mcp',      'Elicitation',       'message-question+beat', '#BF55EC', 'an MCP server wants input'],
  ['done',     'Stop',              'circle-check',          '#58C142', 'turn finished'],
  ['failed',   'StopFailure',       'triangle-exclamation+beat', '#FF453A', 'turn died on an API error'],
  ['end',      'SessionEnd',        '(clears everything)',   '-',       'session over'],
]

const COLOR_INPUT = '#FF9500'
const COLOR_DONE = '#58C142'

const log = (m) => console.log(m)
const ok = (m) => log(`  ✓ ${m}`)
const fail = (m) => log(`  ✗ ${m}`)

function findWsh() {
  const paths = [
    join(homedir(), 'Library', 'Application Support', 'waveterm', 'bin', 'wsh'),
    join(homedir(), '.waveterm', 'bin', 'wsh'),
  ]
  for (const p of paths) if (existsSync(p)) return p
  try {
    return execFileSync('command', ['-v', 'wsh'], { encoding: 'utf-8', shell: true }).trim() || null
  } catch {
    return null
  }
}

function runSetup() {
  log('\n🌊 wave-claude-visual-alerts setup\n')

  const wsh = findWsh()
  wsh ? ok(`wsh found: ${wsh}`)
      : fail('wsh not found — install Wave Terminal first (https://waveterm.dev)')

  mkdirSync(HOOKS_DIR, { recursive: true })
  copyFileSync(SOURCE_HOOK, INSTALLED_HOOK)
  chmodSync(INSTALLED_HOOK, 0o755)
  ok(`Hook installed: ${INSTALLED_HOOK}`)

  const settingsPath = findSettingsPath()
  let settings = loadSettings(settingsPath)

  const backupPath = backupSettings(settingsPath)
  if (backupPath) ok(`Settings backed up: ${backupPath}`)

  // Sweep out every entry we own first, so events dropped from EVENTS in a
  // later version don't linger as orphaned registrations.
  settings = removeHookEntries(settings)

  for (const { event, arg, matcher } of EVENTS) {
    settings = addHookEntry(settings, event, `"${INSTALLED_HOOK}" ${arg}`, {
      matcher,
      timeout: HOOK_TIMEOUT,
    })
  }
  saveSettings(settingsPath, settings)
  ok(`Settings updated: ${settingsPath}`)

  log(`\n  Registered ${EVENTS.length} hook events:`)
  for (const [arg, event, icon, color, meaning] of SCHEME) {
    log(`    • ${event.padEnd(18)} ${icon.padEnd(23)} ${color.padEnd(8)} ${meaning}`)
  }
  log('\n  Alerts sit on the tab and clear when you focus it — Wave does that.')
  log('  The busy spinner sits on the block and survives focus until the turn ends.')
  log('  Override any icon or colour with WAVE_ALERT_ICON_* / WAVE_ALERT_COLOR_*.')
  log('\n  Try it:  npx wave-claude-visual-alerts test')
  log('\n  ✅ Setup complete! Restart Claude Code for hooks to take effect.\n')
}

function runUninstall() {
  log('\n🌊 wave-claude-visual-alerts uninstall\n')

  const settingsPath = findSettingsPath()
  if (existsSync(settingsPath)) {
    let settings = loadSettings(settingsPath)
    const backupPath = backupSettings(settingsPath)
    if (backupPath) ok(`Settings backed up: ${backupPath}`)

    const before = countRegisteredEvents(settings)
    settings = removeHookEntries(settings)
    saveSettings(settingsPath, settings)
    ok(`Removed ${before - countRegisteredEvents(settings)} hook entries`)
  } else {
    log('  No settings.json found.')
  }

  if (existsSync(INSTALLED_HOOK)) {
    rmSync(INSTALLED_HOOK)
    ok(`Removed: ${INSTALLED_HOOK}`)
  }
  if (existsSync(INSTALLED_SHIM)) {
    rmSync(INSTALLED_SHIM)
    ok(`Removed: ${INSTALLED_SHIM} — drop the PATH line from your shell rc too`)
  }
  try {
    for (const dir of [HOOKS_DIR, SHIM_DIR]) {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
    }
    if (existsSync(INSTALL_DIR) && readdirSync(INSTALL_DIR).length === 0) rmSync(INSTALL_DIR)
  } catch { /* leave it */ }

  log('\n  Note: tabs you flagged by hand are untouched — this tool never\n  writes tab:flagcolor.\n')
  log('  ✅ Uninstall complete! Restart Claude Code.\n')
}

function runDoctor() {
  log('\n🌊 wave-claude-visual-alerts doctor\n')
  let allGood = true

  log('[1/3] Checking wsh...')
  const wsh = findWsh()
  if (wsh) {
    try {
      ok(`${execFileSync(wsh, ['version'], { encoding: 'utf-8' }).trim()} (${wsh})`)
    } catch {
      ok(`Found: ${wsh} (could not get version — is Wave running?)`)
    }
  } else {
    fail('wsh not found — install Wave Terminal (https://waveterm.dev)')
    allGood = false
  }

  log('[2/3] Checking hook script...')
  if (existsSync(INSTALLED_HOOK)) {
    ok(INSTALLED_HOOK)
  } else {
    fail(`Not found: ${INSTALLED_HOOK} — run "setup"`)
    allGood = false
  }

  log('[3/3] Checking settings.json...')
  const settingsPath = findSettingsPath()
  if (existsSync(settingsPath)) {
    const count = countRegisteredEvents(loadSettings(settingsPath))
    if (count === EVENTS.length) {
      ok(`All ${count} events registered in ${settingsPath}`)
    } else {
      fail(`${count}/${EVENTS.length} events registered — run "setup"`)
      allGood = false
    }
  } else {
    fail(`Not found: ${settingsPath} — run "setup"`)
    allGood = false
  }

  log('[opt] Open shim (optional)...')
  if (existsSync(INSTALLED_SHIM)) {
    shimOnPath() ? ok(`Installed and first on PATH: ${INSTALLED_SHIM}`)
                 : fail(`Installed but not on PATH — add to your shell rc:  ${SHIM_PATH_LINE}`)
  } else {
    log('  - Not installed. "install-open-shim" routes URLs to the Chrome profile of your Claude login.')
  }

  log(allGood ? '\n  ✅ Everything looks good!\n'
              : '\n  ⚠  Some issues found. Fix them and run doctor again.\n')
}

function runTest() {
  log('\n🌊 wave-claude-visual-alerts test\n')
  const tabId = process.env.WAVETERM_TABID
  const wsh = findWsh()
  if (!tabId) { fail('Not running inside a Wave tab (WAVETERM_TABID unset).'); log(''); return }
  if (!wsh)   { fail('wsh not found.'); log(''); return }

  const hook = existsSync(INSTALLED_HOOK) ? INSTALLED_HOOK : SOURCE_HOOK
  const states = SCHEME.filter(([arg]) => arg !== 'end')
  log('  Cycling every state, 4s each. Watch the tab bar.\n')
  for (const [arg, event, icon, color, meaning] of states) {
    log(`    ${arg.padEnd(9)} ${icon.padEnd(23)} ${color.padEnd(8)} ${meaning}`)
  }
  log('')
  // No shell: each state is exec'd directly so a path with spaces or shell
  // metacharacters cannot be reinterpreted as code.
  for (const [arg] of states) {
    execFileSync(hook, [arg], { stdio: 'ignore' })
    execFileSync('/bin/sleep', ['4'], { stdio: 'ignore' })
  }
  execFileSync(hook, ['end'], { stdio: 'ignore' })
  ok('Cycle complete — everything cleared.\n')
}

function shimOnPath() {
  try {
    return execSync('command -v open', { encoding: 'utf-8' }).trim() === INSTALLED_SHIM
  } catch {
    return false
  }
}

function runInstallOpenShim() {
  log('\n🌊 wave-claude-visual-alerts install-open-shim\n')
  if (process.platform !== 'darwin') {
    fail('The open shim is macOS-only (it drives Google Chrome via /usr/bin/open).')
    log('')
    return
  }
  mkdirSync(SHIM_DIR, { recursive: true })
  copyFileSync(SOURCE_SHIM, INSTALLED_SHIM)
  chmodSync(INSTALLED_SHIM, 0o755)
  ok(`Shim installed: ${INSTALLED_SHIM}`)

  if (shimOnPath()) {
    ok('Already first on PATH')
  } else {
    log(`\n  Add this to your ~/.zshrc (or ~/.bashrc), then open a new Wave tab:\n\n    ${SHIM_PATH_LINE}\n`)
  }
  log('  Inside Wave, `open <url>` now lands in the Chrome profile whose account')
  log('  matches your Claude Code login. Files, flags, and non-Wave shells pass through.')
  log('  Clicked links in Wave are not covered — those go to the macOS default browser.\n')
}

function runUninstallOpenShim() {
  log('\n🌊 wave-claude-visual-alerts uninstall-open-shim\n')
  if (existsSync(INSTALLED_SHIM)) {
    rmSync(INSTALLED_SHIM)
    ok(`Removed: ${INSTALLED_SHIM}`)
    try { if (readdirSync(SHIM_DIR).length === 0) rmSync(SHIM_DIR, { recursive: true }) } catch { /* leave it */ }
    log(`\n  Remove this line from your shell rc if you added it:\n\n    ${SHIM_PATH_LINE}\n`)
  } else {
    log('  Shim not installed.\n')
  }
}

function printHelp() {
  log(`
🌊 wave-claude-visual-alerts — flag the Wave tab when Claude wants you

Usage: wave-claude-visual-alerts <command>

Commands:
  setup       Install the hook and register it in Claude Code settings
  uninstall   Remove the hook and deregister it
  doctor      Check wsh, the hook script, and settings registration
  test        Cycle every state on the current tab, 4s each

Optional (macOS):
  install-open-shim    Make "open <url>" inside Wave use the Chrome profile
                       matching your Claude Code login
  uninstall-open-shim  Remove it

Alerts:
${SCHEME.map(([a,e,i,c,m]) => `  ${a.padEnd(9)} ${i.padEnd(23)} ${c.padEnd(8)} ${m}`).join('\n')}

Alerts clear when you focus the tab. The busy spinner persists until the turn
ends. Override any icon or colour with WAVE_ALERT_ICON_* / WAVE_ALERT_COLOR_*.
`)
}

const command = process.argv[2]

try {
  switch (command) {
    case 'setup':     runSetup(); break
    case 'uninstall': runUninstall(); break
    case 'doctor':    runDoctor(); break
    case 'test':      runTest(); break
    case 'install-open-shim':   runInstallOpenShim(); break
    case 'uninstall-open-shim': runUninstallOpenShim(); break
    case '--version': case '-v': log(`wave-claude-visual-alerts v${VERSION}`); break
    case '--help': case '-h': case undefined: printHelp(); break
    default:
      log(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
} catch (e) {
  console.error(`\n  Error: ${e.message}\n`)
  process.exit(1)
}

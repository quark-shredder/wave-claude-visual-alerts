#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, readdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
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

const INSTALL_DIR = join(homedir(), '.wave-alerts')
const HOOKS_DIR = join(INSTALL_DIR, 'hooks')
const INSTALLED_HOOK = join(HOOKS_DIR, 'wave-alert-hook.sh')
const SOURCE_HOOK = join(ROOT, 'hooks', 'wave-alert-hook.sh')
const HOOK_TIMEOUT = 3

// Claude Code event -> argument passed to the hook script.
// PermissionRequest is tool-scoped so it needs a matcher; Stop is not.
const EVENTS = [
  { event: 'PermissionRequest', arg: 'input', matcher: '*' },
  { event: 'Stop', arg: 'done' },
]

const COLOR_INPUT = '#FF9500' // orange — Claude needs a permission decision
const COLOR_DONE = '#00FFDB'  // teal   — Claude finished the turn

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

  for (const { event, arg, matcher } of EVENTS) {
    settings = addHookEntry(settings, event, `${INSTALLED_HOOK} ${arg}`, {
      matcher,
      timeout: HOOK_TIMEOUT,
    })
  }
  saveSettings(settingsPath, settings)
  ok(`Settings updated: ${settingsPath}`)

  log('\n  Registered 2 hook events:')
  log(`    • PermissionRequest  → orange flag ${COLOR_INPUT}  (Claude needs you)`)
  log(`    • Stop               → teal flag   ${COLOR_DONE}  (task done)`)
  log('\n  The flag clears itself when you focus the tab — Wave handles that.')
  log('  Override colors with WAVE_ALERT_COLOR_INPUT / WAVE_ALERT_COLOR_DONE.')
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
  try {
    if (existsSync(HOOKS_DIR) && readdirSync(HOOKS_DIR).length === 0) {
      rmSync(HOOKS_DIR, { recursive: true })
      rmSync(INSTALL_DIR, { recursive: true, force: true })
    }
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
      ok(`Both events registered in ${settingsPath}`)
    } else {
      fail(`${count}/${EVENTS.length} events registered — run "setup"`)
      allGood = false
    }
  } else {
    fail(`Not found: ${settingsPath} — run "setup"`)
    allGood = false
  }

  log(allGood ? '\n  ✅ Everything looks good!\n'
              : '\n  ⚠  Some issues found. Fix them and run doctor again.\n')
}

function runTest() {
  log('\n🌊 wave-claude-visual-alerts test\n')
  const tabId = process.env.WAVETERM_TABID
  if (!tabId) {
    fail('Not running inside a Wave tab (WAVETERM_TABID unset).')
    log('')
    return
  }
  const wsh = findWsh()
  if (!wsh) {
    fail('wsh not found.')
    log('')
    return
  }
  // Real alerts auto-clear on focus, which you cannot see on the tab you are
  // looking at. Pid-link the badge to a short sleep so it stays put.
  const holder = execFileSync('/bin/sh', ['-c', 'sleep 20 >/dev/null 2>&1 & echo $!'], {
    encoding: 'utf-8',
  }).trim()
  execFileSync(wsh, ['badge', 'flag', '--color', COLOR_INPUT, '--pid', holder,
                     '-b', `tab:${tabId}`])
  ok(`Orange flag on this tab for 20s (${COLOR_INPUT}).`)
  log('  If you had flagged this tab by hand, your color is now the small dot')
  log('  beside it, and returns to the main slot when the alert expires.\n')
}

function printHelp() {
  log(`
🌊 wave-claude-visual-alerts — flag the Wave tab when Claude wants you

Usage: wave-claude-visual-alerts <command>

Commands:
  setup       Install the hook and register it in Claude Code settings
  uninstall   Remove the hook and deregister it
  doctor      Check wsh, the hook script, and settings registration
  test        Show the alert flag on the current tab for 20s

Alerts:
  orange flag ${COLOR_INPUT}   Claude needs a permission decision
  teal flag   ${COLOR_DONE}   Claude finished the turn

The flag clears itself when you focus the tab. Colors can be overridden with
WAVE_ALERT_COLOR_INPUT / WAVE_ALERT_COLOR_DONE.
`)
}

const command = process.argv[2]

try {
  switch (command) {
    case 'setup':     runSetup(); break
    case 'uninstall': runUninstall(); break
    case 'doctor':    runDoctor(); break
    case 'test':      runTest(); break
    case '--version': case '-v': log('wave-claude-visual-alerts v0.2.0'); break
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

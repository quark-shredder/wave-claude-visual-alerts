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
// Only events that support a matcher get one; Stop and UserPromptSubmit do not.
const EVENTS = [
  { event: 'UserPromptSubmit', arg: 'busy' },
  { event: 'PermissionRequest', arg: 'input', matcher: '*' },
  { event: 'Notification', arg: 'waiting', matcher: 'idle_prompt|agent_needs_input' },
  { event: 'Elicitation', arg: 'mcp', matcher: '*' },
  { event: 'Stop', arg: 'done' },
  { event: 'StopFailure', arg: 'failed', matcher: '*' },
  { event: 'SubagentStop', arg: 'subagent', matcher: '*' },
  { event: 'SessionEnd', arg: 'end', matcher: '*' },
]

// Colour carries urgency, animation carries kind. See README.
const SCHEME = [
  ['busy',     'UserPromptSubmit',  'spinner+spin',          '#FFE900', 'working, no action'],
  ['input',    'PermissionRequest', 'hand+beat',             '#FF9500', 'needs a permission decision'],
  ['waiting',  'Notification',      'circle-question+fade',  '#FF9500', 'idle, waiting on you'],
  ['mcp',      'Elicitation',       'message-question+beat', '#BF55EC', 'an MCP server wants input'],
  ['done',     'Stop',              'circle-check',          '#58C142', 'turn finished'],
  ['failed',   'StopFailure',       'triangle-exclamation+beat', '#FF453A', 'turn died on an API error'],
  ['subagent', 'SubagentStop',      'robot',                 '#429DFF', 'a subagent finished'],
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

  for (const { event, arg, matcher } of EVENTS) {
    settings = addHookEntry(settings, event, `${INSTALLED_HOOK} ${arg}`, {
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
  // Alerts auto-clear on focus, so hold each one with a pid link while it shows.
  const script = states.map(([arg]) =>
    `"${hook}" ${arg}; sleep 4`).join('; ')
  execFileSync('/bin/sh', ['-c', `${script}; "${hook}" end`], { stdio: 'ignore' })
  ok('Cycle complete — everything cleared.\n')
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

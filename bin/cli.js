#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { execSync } from 'child_process'
import {
  findSettingsPath,
  loadSettings,
  backupSettings,
  addHookEntry,
  removeHookEntries,
  saveSettings,
  countRegisteredEvents,
} from '../lib/settings.js'
import { THEMES, DEFAULT_THEME, VALID_OPACITIES, DEFAULT_OPACITY } from '../lib/themes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const INSTALL_DIR = join(homedir(), '.wave-alerts')
const HOOKS_DIR = join(INSTALL_DIR, 'hooks')
const INSTALLED_HOOK = join(HOOKS_DIR, 'wave-alert-hook.sh')
const SOURCE_HOOK = join(ROOT, 'hooks', 'wave-alert-hook.sh')
const CONFIG_FILE = join(INSTALL_DIR, 'config.json')
const STATE_DIR = '/tmp/wave-alerts'
const HOOK_TIMEOUT = 3

// Events with matcher: '*' (tool-scoped)
const MATCHER_EVENTS = ['PostToolUse', 'PostToolUseFailure', 'PermissionRequest']
// Events without matcher
const PLAIN_EVENTS = ['Stop', 'UserPromptSubmit', 'SessionStart', 'SessionEnd']
const ALL_EVENTS = [...MATCHER_EVENTS, ...PLAIN_EVENTS]

// ─── Helpers ───

function log(msg) { console.log(msg) }
function ok(msg) { log(`  ✓ ${msg}`) }
function warn(msg) { log(`  ⚠ ${msg}`) }
function fail(msg) { log(`  ✗ ${msg}`) }

function findWsh() {
  const paths = [
    join(homedir(), 'Library', 'Application Support', 'waveterm', 'bin', 'wsh'),
    join(homedir(), '.waveterm', 'bin', 'wsh'),
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  try {
    return execSync('command -v wsh', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

function findJq() {
  try {
    return execSync('command -v jq', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

// ─── Config helpers ───

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  mkdirSync(INSTALL_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

function parseConfigFlags(args) {
  const updates = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--theme') {
      const val = args[++i]
      if (!val || !THEMES[val]) {
        log(`\n  Error: Invalid theme "${val}". Available: ${Object.keys(THEMES).join(', ')}\n`)
        process.exit(1)
      }
      updates.theme = val
    } else if (arg === '--bg-opacity') {
      const val = parseFloat(args[++i])
      if (!VALID_OPACITIES.includes(val)) {
        log(`\n  Error: Invalid opacity "${args[i]}". Allowed: ${VALID_OPACITIES.join(', ')}\n`)
        process.exit(1)
      }
      updates.bgOpacity = val
    } else if (arg === '--no-bg') {
      updates.bgEnabled = false
    } else if (arg === '--bg') {
      updates.bgEnabled = true
    }
  }
  return updates
}

function getEffectiveColors(config) {
  const themeName = config.theme || DEFAULT_THEME
  const theme = THEMES[themeName]
  return {
    stop: config.colors?.stop || theme.colors.stop,
    permission: config.colors?.permission || theme.colors.permission,
  }
}

// ─── Commands ───

async function runSetup(args) {
  log('\n🌊 wave-claude-visual-alerts setup\n')

  // 1. Check prerequisites
  const wsh = findWsh()
  const jq = findJq()
  if (wsh) {
    ok(`wsh found: ${wsh}`)
  } else {
    warn('wsh not found — install Wave Terminal first (https://waveterm.dev)')
  }
  if (jq) {
    ok(`jq found: ${jq}`)
  } else {
    warn('jq not found — install it: brew install jq (macOS) or apt install jq (Linux)')
  }
  log('')

  // 2. Create install directory
  mkdirSync(HOOKS_DIR, { recursive: true })

  // 3. Copy hook script
  copyFileSync(SOURCE_HOOK, INSTALLED_HOOK)
  chmodSync(INSTALLED_HOOK, 0o755)
  ok(`Hook installed: ${INSTALLED_HOOK}`)

  // 4. Apply config flags if any
  const flagUpdates = parseConfigFlags(args)
  if (Object.keys(flagUpdates).length > 0) {
    const config = { ...loadConfig(), ...flagUpdates }
    saveConfig(config)
    ok(`Config updated: ${CONFIG_FILE}`)
  }

  // 5. Read settings.json
  const settingsPath = findSettingsPath()
  let settings = loadSettings(settingsPath)

  // 6. Backup
  const backupPath = backupSettings(settingsPath)
  if (backupPath) {
    ok(`Settings backed up: ${backupPath}`)
  }

  // 7. Add hook entries
  for (const event of MATCHER_EVENTS) {
    settings = addHookEntry(settings, event, INSTALLED_HOOK, {
      matcher: '*',
      timeout: HOOK_TIMEOUT,
    })
  }
  for (const event of PLAIN_EVENTS) {
    settings = addHookEntry(settings, event, INSTALLED_HOOK, {
      timeout: HOOK_TIMEOUT,
    })
  }

  // 8. Write settings
  saveSettings(settingsPath, settings)
  ok(`Settings updated: ${settingsPath}`)

  // 9. Summary
  log(`\n  Registered ${ALL_EVENTS.length} hook events:`)
  for (const e of ALL_EVENTS) {
    log(`    • ${e}`)
  }

  // Show active config
  const config = loadConfig()
  const themeName = config.theme || DEFAULT_THEME
  const theme = THEMES[themeName]
  const colors = getEffectiveColors(config)
  const bgEnabled = config.bgEnabled !== false
  const bgOpacity = config.bgOpacity ?? DEFAULT_OPACITY

  log(`\n  Theme: ${theme.label} (${themeName})`)
  log(`  Background tint: ${bgEnabled ? `enabled (opacity ${bgOpacity})` : 'disabled'}`)
  log('\n  Alert colors:')
  log(`    • Stop         ${colors.stop} — task complete, your turn`)
  log(`    • Permission   ${colors.permission} — permission needed`)

  log('\n  Customize: wave-claude-visual-alerts config --theme <name>')
  log(`  Available themes: ${Object.keys(THEMES).join(', ')}\n`)
  log('  ✅ Setup complete! Restart Claude Code for hooks to take effect.\n')
}

async function runUninstall() {
  log('\n🌊 wave-claude-visual-alerts uninstall\n')

  // 1. Read settings
  const settingsPath = findSettingsPath()
  if (!existsSync(settingsPath)) {
    log('  No settings.json found — nothing to uninstall.\n')
    return
  }

  let settings = loadSettings(settingsPath)

  // 2. Backup
  const backupPath = backupSettings(settingsPath)
  if (backupPath) {
    ok(`Settings backed up: ${backupPath}`)
  }

  // 3. Remove hook entries
  const before = countRegisteredEvents(settings)
  settings = removeHookEntries(settings)
  const after = countRegisteredEvents(settings)

  // 4. Write settings
  saveSettings(settingsPath, settings)
  ok(`Removed ${before - after} hook entries from settings.json`)

  // 5. Remove hook script
  if (existsSync(INSTALLED_HOOK)) {
    rmSync(INSTALLED_HOOK)
    ok(`Removed: ${INSTALLED_HOOK}`)
  }

  // Clean hooks dir if empty
  try {
    if (existsSync(HOOKS_DIR) && readdirSync(HOOKS_DIR).length === 0) {
      rmSync(HOOKS_DIR, { recursive: true })
    }
  } catch { /* ignore */ }

  // 6. Clean state dir
  if (existsSync(STATE_DIR)) {
    rmSync(STATE_DIR, { recursive: true, force: true })
    ok('Cleaned state directory: /tmp/wave-alerts/')
  }

  log('\n  Note: ~/.wave-alerts/config.json preserved (if it exists).')
  log('  To fully remove: rm -rf ~/.wave-alerts\n')
  log('  ✅ Uninstall complete! Restart Claude Code.\n')
}

async function runDoctor() {
  log('\n🌊 wave-claude-visual-alerts doctor\n')
  let allGood = true

  // 1. wsh binary
  log('[1/5] Checking wsh binary...')
  const wsh = findWsh()
  if (wsh) {
    try {
      const ver = execSync(`"${wsh}" version`, { encoding: 'utf-8' }).trim()
      ok(`${ver} (${wsh})`)
    } catch {
      ok(`Found: ${wsh} (could not get version — Wave may not be running)`)
    }
  } else {
    fail('wsh not found — install Wave Terminal (https://waveterm.dev)')
    allGood = false
  }

  // 2. jq
  log('[2/5] Checking jq...')
  const jq = findJq()
  if (jq) {
    try {
      const ver = execSync('jq --version', { encoding: 'utf-8' }).trim()
      ok(ver)
    } catch {
      ok(`Found: ${jq}`)
    }
  } else {
    fail('jq not found — brew install jq (macOS) or apt install jq (Linux)')
    allGood = false
  }

  // 3. Hook script
  log('[3/5] Checking hook script...')
  if (existsSync(INSTALLED_HOOK)) {
    ok(INSTALLED_HOOK)
  } else {
    fail(`Not found: ${INSTALLED_HOOK} — run "wave-claude-visual-alerts setup"`)
    allGood = false
  }

  // 4. Settings.json
  log('[4/5] Checking settings.json...')
  const settingsPath = findSettingsPath()
  if (existsSync(settingsPath)) {
    try {
      const settings = loadSettings(settingsPath)
      const count = countRegisteredEvents(settings)
      if (count === ALL_EVENTS.length) {
        ok(`All ${count} events registered in ${settingsPath}`)
      } else {
        warn(`${count}/${ALL_EVENTS.length} events registered — run "wave-claude-visual-alerts setup" to fix`)
        allGood = false
      }
    } catch (e) {
      fail(`Error parsing settings: ${e.message}`)
      allGood = false
    }
  } else {
    fail(`Not found: ${settingsPath} — run "wave-claude-visual-alerts setup"`)
    allGood = false
  }

  // 5. Config file
  log('[5/5] Checking config...')
  const config = loadConfig()
  if (existsSync(CONFIG_FILE)) {
    const themeName = config.theme || DEFAULT_THEME
    const bgEnabled = config.bgEnabled !== false
    const bgOpacity = config.bgOpacity ?? DEFAULT_OPACITY
    ok(`Theme: ${themeName}, BG: ${bgEnabled ? `on (${bgOpacity})` : 'off'}`)
  } else {
    ok(`Using defaults (theme: ${DEFAULT_THEME}, bg: on, opacity: ${DEFAULT_OPACITY})`)
  }

  log('')
  if (allGood) {
    log('  ✅ Everything looks good!\n')
  } else {
    log('  ⚠  Some issues found. Fix them and run doctor again.\n')
  }
}

async function runConfig(args) {
  log('\n🌊 wave-claude-visual-alerts config\n')

  const flagUpdates = parseConfigFlags(args)

  if (Object.keys(flagUpdates).length > 0) {
    // Update mode
    const config = { ...loadConfig(), ...flagUpdates }
    saveConfig(config)
    ok(`Config saved: ${CONFIG_FILE}`)
    log('')
  }

  // Display current config
  const config = loadConfig()
  const themeName = config.theme || DEFAULT_THEME
  const theme = THEMES[themeName]
  const colors = getEffectiveColors(config)
  const bgEnabled = config.bgEnabled !== false
  const bgOpacity = config.bgOpacity ?? DEFAULT_OPACITY

  log(`  Theme:      ${theme.label} (${themeName})`)
  log(`  Background: ${bgEnabled ? `enabled, opacity ${bgOpacity}` : 'disabled'}`)
  log('')
  log('  Colors:')
  log(`    stop         ${colors.stop}`)
  log(`    permission   ${colors.permission}`)

  if (config.colors && Object.keys(config.colors).length > 0) {
    log(`\n  Custom overrides: ${Object.keys(config.colors).join(', ')}`)
  }

  log('\n  Available themes:')
  for (const [name, t] of Object.entries(THEMES)) {
    const marker = name === themeName ? ' ◀' : ''
    log(`    ${name.padEnd(10)} ${t.description}${marker}`)
  }

  log(`\n  Opacity options: ${VALID_OPACITIES.join(', ')}`)
  log(`\n  Config file: ${CONFIG_FILE}`)
  log(`  Changes take effect on next Claude Code hook trigger (no restart needed).\n`)
}

function printHelp() {
  log(`
🌊 wave-claude-visual-alerts — Visual alerts for Claude Code in Wave Terminal

Usage: wave-claude-visual-alerts <command> [options]

Commands:
  setup       Install hook and register in Claude Code settings
  uninstall   Remove hook and deregister from settings
  config      View or update configuration
  doctor      Check dependencies and configuration

Setup / Config options:
  --theme <name>       Set color theme (${Object.keys(THEMES).join(', ')})
  --bg-opacity <val>   Set background tint opacity (${VALID_OPACITIES.join(', ')})
  --no-bg              Disable background tint
  --bg                 Enable background tint

General:
  --help, -h           Show this help
  --version, -v        Show version
`)
}

function printVersion() {
  log('wave-claude-visual-alerts v0.1.0')
}

// ─── Main ───

const args = process.argv.slice(2)
const command = args[0]
const cmdArgs = args.slice(1)

try {
  switch (command) {
    case 'setup':     await runSetup(cmdArgs); break
    case 'uninstall': await runUninstall(); break
    case 'config':    await runConfig(cmdArgs); break
    case 'doctor':    await runDoctor(); break
    case '--help': case '-h': case undefined: printHelp(); break
    case '--version': case '-v': printVersion(); break
    default:
      log(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
} catch (e) {
  console.error(`\n  Error: ${e.message}\n`)
  process.exit(1)
}

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const HOOK_IDENTIFIER = 'wave-alert-hook'

const SETTINGS_PATHS = [
  join(homedir(), '.claude', 'settings.json'),
  join(homedir(), '.config', 'claude', 'settings.json'),
]

export function findSettingsPath() {
  for (const p of SETTINGS_PATHS) {
    if (existsSync(p)) return p
  }
  return SETTINGS_PATHS[0]
}

export function loadSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {}
  const raw = readFileSync(settingsPath, 'utf-8')
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse ${settingsPath}: ${e.message}\nPlease fix the JSON manually and try again.`)
  }
}

export function backupSettings(settingsPath) {
  if (!existsSync(settingsPath)) return null
  const backupPath = `${settingsPath}.backup-${Date.now()}`
  copyFileSync(settingsPath, backupPath)
  return backupPath
}

export function addHookEntry(settings, eventType, hookCommand, { matcher, timeout }) {
  settings.hooks = settings.hooks || {}
  settings.hooks[eventType] = settings.hooks[eventType] || []

  // Remove existing wave-alert-hook entries (idempotent)
  settings.hooks[eventType] = settings.hooks[eventType].filter(h =>
    !h.hooks?.some(hh => hh.command?.includes(HOOK_IDENTIFIER))
  )

  const entry = { hooks: [{ type: 'command', command: hookCommand, timeout }] }
  if (matcher) entry.matcher = matcher

  settings.hooks[eventType].push(entry)
  return settings
}

export function removeHookEntries(settings) {
  if (!settings.hooks) return settings

  for (const eventType of Object.keys(settings.hooks)) {
    settings.hooks[eventType] = settings.hooks[eventType].filter(h =>
      !h.hooks?.some(hh => hh.command?.includes(HOOK_IDENTIFIER))
    )
    if (settings.hooks[eventType].length === 0) {
      delete settings.hooks[eventType]
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }
  return settings
}

export function saveSettings(settingsPath, settings) {
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
}

export function countRegisteredEvents(settings) {
  if (!settings.hooks) return 0
  let count = 0
  for (const entries of Object.values(settings.hooks)) {
    for (const entry of entries) {
      if (entry.hooks?.some(h => h.command?.includes(HOOK_IDENTIFIER))) {
        count++
        break
      }
    }
  }
  return count
}

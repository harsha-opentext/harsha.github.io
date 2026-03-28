const NOTE_CONFIG = {
  STORAGE_ROOT: '../NoteMd',
  DATA_INDEX: 'data/index.json',
  FOLDERS_FILE: 'folders.yaml'
};

// Optional logging defaults
NOTE_CONFIG.LOG_DEFAULTS = {
  level: 'info',
  retentionMinutes: 5
};

function applyNoteConfig() {
  try {
    if (window.state) {
      if (NOTE_CONFIG.LOG_DEFAULTS && NOTE_CONFIG.LOG_DEFAULTS.level) window.state.logLevel = NOTE_CONFIG.LOG_DEFAULTS.level;
      if (NOTE_CONFIG.LOG_DEFAULTS && typeof NOTE_CONFIG.LOG_DEFAULTS.retentionMinutes === 'number') window.state.retentionMinutes = NOTE_CONFIG.LOG_DEFAULTS.retentionMinutes;
    }
  } catch (e) {}
}

window.applyNoteConfig = applyNoteConfig;

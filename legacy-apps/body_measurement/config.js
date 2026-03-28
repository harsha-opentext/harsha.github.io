// Configuration for Body Measurement (Weight Tracker)
const BM_DEFAULT_CONFIG = {
  STORAGE_ROOT: 'body_measurement',
  DATA_FOLDER: 'data',
  INDEX_FOLDER: 'index',
  INDEX_FILE: 'index.json',
  MAX_ENTRIES_PER_FILE: 50,
  DATE_FORMAT: 'YYYY-MM-DD'
};

function bm_getConfig(key) {
  const stored = localStorage.getItem(`bm_config_${key}`);
  return stored !== null ? JSON.parse(stored) : BM_DEFAULT_CONFIG[key];
}

function bm_setConfig(key, value) {
  localStorage.setItem(`bm_config_${key}`, JSON.stringify(value));
}

function bm_getAllConfig() {
  const cfg = { ...BM_DEFAULT_CONFIG };
  Object.keys(BM_DEFAULT_CONFIG).forEach(k => {
    const s = localStorage.getItem(`bm_config_${k}`);
    if (s !== null) cfg[k] = JSON.parse(s);
  });
  return cfg;
}

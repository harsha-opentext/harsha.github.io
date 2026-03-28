// Default configuration - these values can be overridden in localStorage
const DEFAULT_CONFIG = {
    // GitHub repository settings
    dataFolder: 'data',     // Per-day files will be written under this folder
    schemaFile: 'schema.yaml',  // Schema definition file
    logFile: 'logs.txt',  // Log file name in repository
    maxLogFileSize: 1048576,  // Max log file size in bytes (1MB)
    fetchDays: 90, // Default number of recent per-date files to fetch
    
    // Application settings
    dateFormat: 'YYYY-MM-DD',
    autoFetch: true,  // Auto-fetch on load if credentials are saved
    autoSave: true,  // Persist changes automatically (always enabled)
    dailyBudget: 2000, // Default daily calorie budget (kcal)
    
    // UI settings
    theme: 'dark',
    showLogs: false,
    logRetentionMinutes: 5
};

// Get configuration value with localStorage override
function getConfig(key) {
    const stored = localStorage.getItem(`config_${key}`);
    return stored !== null ? JSON.parse(stored) : DEFAULT_CONFIG[key];
}

// Set configuration value in localStorage
function setConfig(key, value) {
    localStorage.setItem(`config_${key}`, JSON.stringify(value));
}

// Get all config merged with localStorage overrides
function getAllConfig() {
    const config = { ...DEFAULT_CONFIG };
    Object.keys(DEFAULT_CONFIG).forEach(key => {
        const stored = localStorage.getItem(`config_${key}`);
        if (stored !== null) {
            config[key] = JSON.parse(stored);
        }
    });
    return config;
}

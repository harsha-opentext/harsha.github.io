// Configuration
const DEFAULT_CONFIG = {
    dataFile: 'todos.json',
    autoSave: false
};

function getConfig(key) {
    const stored = localStorage.getItem(`todo_config_${key}`);
    return stored !== null ? JSON.parse(stored) : DEFAULT_CONFIG[key];
}

function setConfig(key, value) {
    localStorage.setItem(`todo_config_${key}`, JSON.stringify(value));
}

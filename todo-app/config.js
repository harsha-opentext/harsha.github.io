// Configuration
const DEFAULT_CONFIG = {
    dataFile: 'todos.json',
    autoSave: false
};
// Default maximum description length (characters)
DEFAULT_CONFIG.descriptionMaxLength = 2000;
// Default maximum number of tags user can create
DEFAULT_CONFIG.maxTags = 5;

function getConfig(key) {
    const stored = localStorage.getItem(`todo_config_${key}`);
    return stored !== null ? JSON.parse(stored) : DEFAULT_CONFIG[key];
}

function setConfig(key, value) {
    localStorage.setItem(`todo_config_${key}`, JSON.stringify(value));
}

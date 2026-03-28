// Entry point for Body Measurement (Weight Tracker)
document.addEventListener('DOMContentLoaded', async () => {
  // Wire buttons
  try {
    document.getElementById('bm-add-btn').addEventListener('click', bm_handleAddEntry);
    document.getElementById('bm-refresh-btn').addEventListener('click', () => bm_renderList(50));
    // Settings wiring
    const settingsBtn = document.getElementById('bm-open-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', bm_showSettings);
    const saveBtn = document.getElementById('bm-save-settings');
    if (saveBtn) saveBtn.addEventListener('click', bm_saveSettings);
    const closeBtn = document.getElementById('bm-close-settings');
    if (closeBtn) closeBtn.addEventListener('click', bm_hideSettings);
    const cancelBtn = document.getElementById('bm-cancel-settings');
    if (cancelBtn) cancelBtn.addEventListener('click', bm_hideSettings);
  } catch (e) { /* ignore if elements not yet present */ }

  // Initialize settings page inputs when present
  try { if (document.getElementById('bm-cfg-token') || document.getElementById('bm-cfg-repo')) bm_initSettingsPage(); } catch(e) {}

  // Initial render
  await bm_renderList(50);
});

// Expose functions for inline handlers or console
window.bm_renderList = bm_renderList;
window.bm_handleAddEntry = bm_handleAddEntry;
window.bm_showSettings = bm_showSettings;
window.bm_saveSettings = bm_saveSettings;
window.bm_hideSettings = bm_hideSettings;

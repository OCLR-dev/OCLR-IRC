// Synthetic UI tests are deterministic on every CI host; production follows the OS.
require('electron').app.getPreferredSystemLanguages = () => ['zh-TW']

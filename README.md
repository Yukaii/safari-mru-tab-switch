# Safari MRU Tab Switch

A Tampermonkey script for Safari that enables Most Recently Used (MRU) tab switching, similar to how Alt+Tab works in most operating systems. Uses Raycast and AppleScript to enable seamless tab switching.

## Features

- Switch between your most recently used tabs using **Alt+Tab** (like Windows/Linux)
- Visual overlay showing all recent tabs for easy selection
- Cycle through tabs in both directions (Alt+Tab and Alt+Shift+Tab)
- Press ESC to cancel a tab switch operation
- Maintains history of your 10 most recently used tabs
- Automatically cleans up closed tabs from history

## Installation

### 1. Tampermonkey Script

1. Install the [Tampermonkey extension for Safari](https://www.tampermonkey.net/)
2. Click on the Tampermonkey icon and select "Create a new script"
3. Copy and paste the contents of `safari-mru-tab.user.js` into the editor
4. Save the script (Command+S)

### 2. Raycast Integration

1. Install [Raycast](https://www.raycast.com/) if you haven't already
2. Copy the `switch-safari-tab.applescript` file to your Raycast scripts directory
3. In Raycast, go to Extensions → Script Commands → Add Script Directory
4. Add the directory where you saved the script

## How It Works

1. The Tampermonkey script tracks your tab usage history
2. When you press **Alt+Tab**, it shows an overlay with your recently used tabs
3. You can cycle through tabs with **Tab** or go backwards with **Shift+Tab**
4. When you release the **Alt** key, it uses Raycast and AppleScript to switch to the selected tab
5. Tab switching is done via the tab index (most reliable) or the tab title as fallback

## Usage

- Press **Alt+Tab** to show the tab switcher overlay and switch to previous tab
- Hold **Alt** and press **Tab** repeatedly to cycle forward through tabs
- Hold **Alt** and press **Shift+Tab** to cycle backward through tabs
- Press **Esc** while holding **Alt** to cancel the tab switch
- Release **Alt** to switch to the selected tab

## Debugging

You can access debugging functions in the browser console:

```javascript
// Show current tab history
window._mruTabSwitch.showHistory();

// Manually trigger tab switch
window._mruTabSwitch.switchToPrevious();
```

## Contributing

Feel free to submit issues or pull requests to improve this script.

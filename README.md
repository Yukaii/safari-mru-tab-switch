# Safari MRU Tab Switch

A Tampermonkey script for Safari that enables Most Recently Used (MRU) tab switching, similar to how Alt+Tab works in most operating systems.

## Features

- Switch between your most recently used tabs using keyboard shortcuts
- Maintains history of your tab usage
- Works in Safari with Tampermonkey extension

## Installation

1. Install the [Tampermonkey extension for Safari](https://www.tampermonkey.net/)
2. Click on the Tampermonkey icon and select "Create a new script"
3. Copy and paste the contents of `safari-mru-tab.user.js` into the editor
4. Save the script (Ctrl+S or Command+S)

## Usage

- Press **Command+`** (backtick) to switch to your previously used tab
- The script maintains a history of your 10 most recently used tabs

## Limitations

Safari's extension capabilities have some limitations compared to Chrome or Firefox:

- This script works best within the same window
- Some functionality might be limited due to Safari's security model
- For full tab management functionality, a native Safari extension might be required

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

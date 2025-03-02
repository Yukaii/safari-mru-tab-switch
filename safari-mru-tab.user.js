// ==UserScript==
// @name        Safari MRU Tab Switch
// @namespace   http://tampermonkey.net/
// @version     1.7
// @description Cycle through most recently used tabs in Safari using AppleScript deep links
// @author      You
// @match       *://*/*
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_deleteValue
// @grant       GM_getTab
// @grant       GM_saveTab
// @run-at      document-start
// @noframes
// ==/UserScript==

(function() {
  'use strict';

  console.log('Safari MRU Tab Switch: Script initialized with updated AppleScript deep link support');

  // Constants
  const HISTORY_KEY = 'mruTabHistoryWithIndices';
  const MAX_HISTORY = 10;
  const RAYCAST_DEEPLINK_PREFIX = 'raycast://script-commands/switch-safari-tab';

  // URL patterns to exclude from history
  const EXCLUDED_URL_PATTERNS = [
    /service_worker/i,
    /sw_iframe/i,
    /^about:/i,
    /^chrome:/i,
    /^safari-extension:/i,
    /^data:/i,
    /^javascript:/i,
    /^blob:/i
  ];

  // Variable to track if we're currently switching tabs
  let isSwitching = false;
  let lastSwitchTime = 0;
  const DOUBLE_PRESS_THRESHOLD = 500; // ms

  // Utility function to check if a URL should be excluded from history
  function shouldExcludeUrl(url) {
    // Check against excluded patterns
    for (const pattern of EXCLUDED_URL_PATTERNS) {
      if (pattern.test(url)) {
        console.log(`Safari MRU Tab Switch: Excluding URL that matches pattern ${pattern}: ${url}`);
        return true;
      }
    }
    return false;
  }

  // Get current tab info - simplified
  function getCurrentTabInfo() {
      // Skip if URL should be excluded
      if (shouldExcludeUrl(window.location.href)) {
        console.log('Safari MRU Tab Switch: Skipping tab info collection - URL is in exclusion list');
        return null;
      }

      // Try to get tab index from document
      let tabIndex = -1;

      try {
          // Get tab index from meta tag if available
          const metaTabIndex = document.querySelector('meta[name="safari-tab-index"]');
          if (metaTabIndex) {
              tabIndex = parseInt(metaTabIndex.getAttribute('content'), 10);
              console.log(`Safari MRU Tab Switch: Found tab index from meta tag: ${tabIndex}`);
          }

          // Try to extract index from URL or other page elements if needed
          // This can be customized based on your specific needs
          if (tabIndex < 0) {
              // Add additional detection methods here if needed
              console.log('Safari MRU Tab Switch: Could not determine tab index from standard methods');
          }
      } catch (e) {
          console.error('Error getting tab index from meta:', e);
      }

      return {
          id: `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          url: window.location.href,
          title: document.title || window.location.href,
          index: tabIndex, // May be -1 if unknown
          lastAccessed: Date.now()
      };
  }

  // Get the tab order history
  function getTabHistory() {
      return GM_getValue(HISTORY_KEY, []);
  }

  // Save the tab order history
  function saveTabHistory(history) {
      GM_setValue(HISTORY_KEY, history);
      console.log('Safari MRU Tab Switch: Saved tab history:', history);
  }

  // Update tab history when this tab is accessed
  function updateTabHistory(tabData) {
      if (isSwitching) {
          console.log('Safari MRU Tab Switch: Switching in progress, skipping history update');
          return;
      }

      // Skip if tabData is null (iframe or excluded URL)
      if (!tabData) {
          console.log('Safari MRU Tab Switch: Skipping history update - invalid tab data');
          return;
      }

      // Skip if URL should be excluded (double-check)
      if (shouldExcludeUrl(tabData.url)) {
          console.log('Safari MRU Tab Switch: Skipping history update - URL is in exclusion list');
          return;
      }

      console.log(`Safari MRU Tab Switch: Updating tab history with:`, tabData);

      // Get current history
      const history = getTabHistory();

      // Remove this tab if it's already in history (by URL)
      const existingIndex = history.findIndex(tab => tab.url === tabData.url);
      if (existingIndex !== -1) {
          console.log(`Safari MRU Tab Switch: Removing existing tab from history at position ${existingIndex}`);
          history.splice(existingIndex, 1);
      }

      // Add this tab to the beginning of history
      history.unshift(tabData);

      // Limit history size
      while (history.length > MAX_HISTORY) {
          const removed = history.pop();
          console.log(`Safari MRU Tab Switch: Removed oldest tab from history: ${removed.url}`);
      }

      // Save the updated history
      saveTabHistory(history);

      // Store the tab data in the current tab's storage
      GM_getTab(function(tab) {
          tab.mruTabData = tabData;
          GM_saveTab(tab);
      });
  }

  // Create deep link for tab switching - UPDATED to strictly prioritize index
  function createTabSwitchDeepLink(tabIndex, tabTitle) {
      // Always try to use index first, only fall back to title as last resort
      let argument = '';

      if (typeof tabIndex === 'number' && tabIndex >= 0) {
          // If we have a valid index (0 or greater), use that as the argument
          argument = tabIndex.toString();
          console.log(`Safari MRU Tab Switch: Using tab INDEX ${tabIndex} for switch`);
      } else {
          // Fall back to title only when no valid index is available
          console.warn(`Safari MRU Tab Switch: No valid tab index available (got: ${tabIndex})`);
          console.log(`Safari MRU Tab Switch: Stack trace for debugging:`, new Error().stack);
          argument = tabTitle;
          console.log(`Safari MRU Tab Switch: Falling back to title: "${tabTitle}"`);
      }

      return `${RAYCAST_DEEPLINK_PREFIX}?arguments=${encodeURIComponent(argument)}`;
  }

  // Execute tab switch using deep link
  function executeTabSwitch(deepLink) {
      console.log(`Safari MRU Tab Switch: Executing deep link: ${deepLink}`);

      // Create a temporary link element to open the deep link
      const linkElement = document.createElement('a');
      linkElement.href = deepLink;
      linkElement.style.display = 'none';

      // Add to document and click
      document.body.appendChild(linkElement);

      try {
          linkElement.click();
          console.log('Safari MRU Tab Switch: Deep link click event fired');
      } catch (e) {
          console.error('Safari MRU Tab Switch: Failed to click deep link:', e);
      }

      // Clean up
      setTimeout(() => {
          document.body.removeChild(linkElement);
      }, 100);

      return true;
  }

  // Switch to previous tab - Updated with better index handling
  function switchToPreviousTab() {
      console.log('Safari MRU Tab Switch: Attempting to switch to previous tab');

      const history = getTabHistory();

      if (history.length <= 1) {
          console.log('Safari MRU Tab Switch: No previous tabs available');
          console.log('%c No previous tabs available to switch to ', 'background: #ff0000; color: white; font-size: 16px;');
          return;
      }

      isSwitching = true;

      // Get the current tab data
      const currentTab = getCurrentTabInfo();
      const now = Date.now();
      const isDoubleTap = (now - lastSwitchTime) < DOUBLE_PRESS_THRESHOLD;
      lastSwitchTime = now;

      // Get the previous tab with index validation
      let previousTab = null;

      for (const tab of history) {
          if (tab.url !== currentTab.url) {
              // Found a different tab, check its index
              if (tab.index >= 0) {
                  previousTab = tab;
                  console.log(`Safari MRU Tab Switch: Found previous tab with valid index ${tab.index}`);
                  break;
              } else {
                  console.warn(`Safari MRU Tab Switch: Skipping tab with invalid index:`,
                             { title: tab.title, index: tab.index });
              }
          }
      }

      // If no tab with valid index found, take first different tab
      if (!previousTab) {
          for (const tab of history) {
              if (tab.url !== currentTab.url) {
                  previousTab = tab;
                  console.warn('Safari MRU Tab Switch: No tab with valid index found, using first different tab');
                  break;
              }
          }
      }

      if (!previousTab) {
          console.log('Safari MRU Tab Switch: No valid previous tab found');
          console.log('%c No previous tab found to switch to ', 'background: #ff0000; color: white; font-size: 16px;');
          isSwitching = false;
          return;
      }

      // Log tab index for debugging
      console.log(`Safari MRU Tab Switch: Switching to tab:`, previousTab);
      console.log(`Safari MRU Tab Switch: Previous tab index: ${previousTab.index}, title: "${previousTab.title}"`);

      // Create the new history order - move previous tab to front, current tab second
      const newHistory = [previousTab];

      // Add the current tab next - but update its data first
      currentTab.lastAccessed = Date.now();
      newHistory.push(currentTab);

      // Add the rest of the history (excluding the two we already added)
      for (const tab of history) {
          if (tab.url !== previousTab.url && tab.url !== currentTab.url) {
              newHistory.push(tab);
          }
      }

      // Save the updated history
      saveTabHistory(newHistory);

      // Create the deep link with strict index prioritization
      const deepLink = createTabSwitchDeepLink(
          previousTab.index,
          previousTab.title
      );

      console.log(`Safari MRU Tab Switch: Generated deep link: ${deepLink}`);

      // Visual feedback
      console.log('%c Tab switch initiated! ', 'background: #4CAF50; color: white; font-size: 16px;');

      // Try to switch tabs with the deep link
      const success = executeTabSwitch(deepLink);

      if (!success || isDoubleTap) {
          // For double-tap or if deep link fails, try more aggressive visual feedback
          try {
              // Flash the screen
              const flashElement = document.createElement('div');
              flashElement.style.position = 'fixed';
              flashElement.style.top = '0';
              flashElement.style.left = '0';
              flashElement.style.width = '100%';
              flashElement.style.height = '100%';
              flashElement.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
              flashElement.style.zIndex = '9999999';
              flashElement.style.transition = 'opacity 0.3s ease-out';
              flashElement.style.pointerEvents = 'none';
              flashElement.style.display = 'flex';
              flashElement.style.justifyContent = 'center';
              flashElement.style.alignItems = 'center';

              // Show the target tab info
              flashElement.innerHTML = `<div style="font-size: 24px; color: #333; font-weight: bold; text-align: center;">
                  <div style="margin-bottom: 10px;">Switching to Tab:</div>
                  <div style="font-size: 18px; color: #0066cc;">${previousTab.title}</div>
              </div>`;

              document.body.appendChild(flashElement);

              setTimeout(() => {
                  flashElement.style.opacity = '0';
                  setTimeout(() => {
                      document.body.removeChild(flashElement);
                  }, 300);
              }, 1000);

              // If it's a double-tap, try the deep link again
              if (isDoubleTap) {
                  console.log('%c Double-tap detected! Trying deep link again ', 'background: #9C27B0; color: white; font-size: 14px;');
                  setTimeout(() => {
                      executeTabSwitch(deepLink);
                  }, 300);
              }

          } catch (e) {
              console.error('Safari MRU Tab Switch: Error during visual feedback:', e);
          }
      }

      setTimeout(() => {
          isSwitching = false;
          console.log('Safari MRU Tab Switch: Switching mode deactivated');
      }, 1000);
  }

  // Initialize tab tracking - simplified
  function initializeTabTracking() {
      // Skip if URL should be excluded
      if (shouldExcludeUrl(window.location.href)) {
          console.log('Safari MRU Tab Switch: Skipping initialization - URL is in exclusion list');
          return;
      }

      // Get current tab information
      const tabData = getCurrentTabInfo();

      // Update the tab history with this tab (only if valid)
      if (tabData) {
          updateTabHistory(tabData);
          console.log('Safari MRU Tab Switch: Tab tracking initialized with data:', tabData);

          // More aggressive index updates
          setTimeout(updateTabIndex, 500);
          setTimeout(updateTabIndex, 1500);
          setTimeout(updateTabIndex, 3000);
      }
  }

  // Update the tab index if it wasn't available initially - Enhanced for better index capture
  function updateTabIndex() {
      GM_getTab(function(tab) {
          if (tab.mruTabData) {
              // Always try to update the index, even if we already have one
              let newIndex = -1;

              try {
                  // Check for any indicators of tab index
                  const metaTabIndex = document.querySelector('meta[name="safari-tab-index"]');
                  if (metaTabIndex) {
                      newIndex = parseInt(metaTabIndex.getAttribute('content'), 10);
                      console.log(`Safari MRU Tab Switch: Found tab index ${newIndex} from meta tag during update`);
                  }
              } catch (e) {
                  console.error('Error updating tab index:', e);
              }

              // If we have a valid new index, update our stored data
              if (newIndex >= 0 && newIndex !== tab.mruTabData.index) {
                  console.log(`Safari MRU Tab Switch: Updating tab index from ${tab.mruTabData.index} to ${newIndex}`);
                  tab.mruTabData.index = newIndex;
                  GM_saveTab(tab);

                  // Also update in the history
                  const history = getTabHistory();
                  let updated = false;

                  for (let i = 0; i < history.length; i++) {
                      // Update by ID first if available
                      if (history[i].id === tab.mruTabData.id) {
                          history[i].index = newIndex;
                          updated = true;
                          break;
                      }
                  }

                  // If we couldn't find by ID, try by URL
                  if (!updated) {
                      for (let i = 0; i < history.length; i++) {
                          if (history[i].url === tab.mruTabData.url) {
                              history[i].index = newIndex;
                              updated = true;
                              break;
                          }
                      }
                  }

                  if (updated) {
                      saveTabHistory(history);
                      console.log(`Safari MRU Tab Switch: Updated index in history for ${tab.mruTabData.url}`);
                  }
              }
          }
      });
  }

  // Set up keyboard shortcut listener
  document.addEventListener('keydown', function(e) {
      // Check for Alt+Tab (Windows/Linux) or Command+` (Mac)
      if ((e.altKey && e.key === 'Tab') || (e.metaKey && e.key === '`')) {
          console.log('Safari MRU Tab Switch: Shortcut detected! Preventing default action');
          e.preventDefault();
          e.stopPropagation();
          switchToPreviousTab();
          return false;
      }
  }, true); // Use capture phase for earlier interception

  // Add a second listener at window level for better coverage
  window.addEventListener('keydown', function(e) {
      // Check for Alt+Tab (Windows/Linux) or Command+` (Mac)
      if ((e.altKey && e.key === 'Tab') || (e.metaKey && e.key === '`')) {
          console.log('Safari MRU Tab Switch: Window-level shortcut detected!');
          e.preventDefault();
          e.stopPropagation();
          switchToPreviousTab();
          return false;
      }
  }, true); // Use capture phase

  // Add an alternative key detection using keyCode for older browsers
  document.addEventListener('keydown', function(e) {
      // Check using keyCodes (` is keyCode 192)
      if ((e.altKey && e.keyCode === 9) || (e.metaKey && e.keyCode === 192)) {
          console.log('Safari MRU Tab Switch: Shortcut detected via keyCode! Preventing default action');
          e.preventDefault();
          e.stopPropagation();
          switchToPreviousTab();
          return false;
      }
  }, true);

  // Monitor for tab focus changes using the Page Visibility API
  document.addEventListener('visibilitychange', function() {
      console.log(`Safari MRU Tab Switch: Visibility changed to: ${document.visibilityState}`);

      if (document.visibilityState === 'visible') {
          console.log('Safari MRU Tab Switch: Tab became visible, updating history');
          initializeTabTracking();
      }
  });

  // Debug functions for the console
  function debugShowHistory() {
      const history = getTabHistory();
      console.log('Safari MRU Tab Switch: Tab history:', history);
      return history;
  }

  function clearTabHistory() {
      saveTabHistory([]);
      console.log('Safari MRU Tab Switch: Tab history cleared');
      return 'History cleared';
  }

  // Function to manually switch to a tab - Updated for strict index handling
  function switchToTab(indexOrTitle) {
      const parsedIndex = parseInt(indexOrTitle, 10);
      let deepLink;

      if (!isNaN(parsedIndex) && parsedIndex >= 0) {
          console.log(`Safari MRU Tab Switch: Manual switch to tab index ${parsedIndex}`);
          deepLink = createTabSwitchDeepLink(parsedIndex, null);
      } else {
          console.warn(`Safari MRU Tab Switch: Invalid tab index (${indexOrTitle}), falling back to title`);
          deepLink = createTabSwitchDeepLink(-1, indexOrTitle);
      }

      return executeTabSwitch(deepLink);
  }

  // Update debug functions - remove isIframe check
  unsafeWindow._mruTabSwitch = {
      showHistory: debugShowHistory,
      switchToPrevious: switchToPreviousTab,
      clearHistory: clearTabHistory,
      switchToTab: switchToTab,
      updateIndex: updateTabIndex,
      checkUrl: function(url) { return !shouldExcludeUrl(url); }
  };

  // Initialize when the document is ready
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeTabTracking);
  } else {
      initializeTabTracking();
  }

  // Display a startup message in the console
  console.log('%c Safari MRU Tab Switch Loaded (with AppleScript support) ',
             'background: #3498db; color: white; font-size: 18px; font-weight: bold;');
  console.log('%c Press Command+` (Mac) or Alt+Tab to switch tabs ',
             'background: #2ecc71; color: white; font-size: 14px;');
  console.log('%c This version uses Raycast AppleScript deep links for actual tab switching ',
             'background: #9C27B0; color: white; font-size: 14px;');
})();

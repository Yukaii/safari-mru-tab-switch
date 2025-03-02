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
// @grant       GM_getTabs
// @grant       GM_saveTab
// @run-at      document-start
// @noframes
// @downloadURL  https://raw.githubusercontent.com/Yukaii/safari-mru-tab-switch/refs/heads/main/safari-mru-tab.user.js
// @updateURL    https://raw.githubusercontent.com/Yukaii/safari-mru-tab-switch/refs/heads/main/safari-mru-tab.user.js
// ==/UserScript==

(function() {
  'use strict';

  console.log('Safari MRU Tab Switch: Script initialized with updated AppleScript deep link support');

  // Constants
  const HISTORY_KEY = 'mruTabHistoryWithIndices';
  const MAX_HISTORY = 10;
  const RAYCAST_DEEPLINK_PREFIX = 'raycast://script-commands/switch-safari-tab';
  const CLEANUP_INTERVAL = 1000 * 60 * 5; // Reduce to 5 minutes for more frequent cleanup

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

  // Variables for tab cycling UI - changed to use Alt key instead of Meta
  let isAltKeyPressed = false;
  let tabCycleOverlay = null;
  let currentCycleIndex = 0;
  let tabCycleHistory = [];

  // Variable to track if we're currently switching tabs
  let isSwitching = false;
  let lastSwitchTime = 0;
  const DOUBLE_PRESS_THRESHOLD = 500; // ms

  // Add new properties to track potentially closed tabs
  let lastCleanupTime = 0;

  // Add variable to track initial tab index
  let initialCycleIndex = 0;

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

  // Improved tab cleanup using GM_getTabs
  function cleanupTabsUsingGMTabs() {
    console.log('Safari MRU Tab Switch: Running comprehensive tab cleanup with GM_getTabs');

    // Get current history
    const history = getTabHistory();
    if (!history || history.length === 0) return;

    // Use GM_getTabs to get all active tabs
    try {
      GM_getTabs(function(tabs) {
        console.log('Safari MRU Tab Switch: Retrieved data for ' + Object.keys(tabs).length + ' active tabs');

        // Create a map of active tab URLs from GM_getTabs data
        const activeTabUrls = new Set();
        for (const [tabId, tabData] of Object.entries(tabs)) {
          if (tabData.mruTabData && tabData.mruTabData.url) {
            activeTabUrls.add(tabData.mruTabData.url);
          }
        }

        console.log('Safari MRU Tab Switch: Found ' + activeTabUrls.size + ' active tab URLs');

        // Filter history to keep only tabs that are still active
        const updatedHistory = history.filter(historyTab => {
          const isActive = activeTabUrls.has(historyTab.url);
          if (!isActive) {
            console.log(`Safari MRU Tab Switch: Removing closed tab from history: ${historyTab.title}`);
          }
          return isActive;
        });

        // Save the updated history if changes were made
        if (updatedHistory.length !== history.length) {
          console.log(`Safari MRU Tab Switch: Removed ${history.length - updatedHistory.length} closed tabs from history`);
          saveTabHistory(updatedHistory);
        } else {
          console.log('Safari MRU Tab Switch: No closed tabs found in history');
        }
      });
    } catch (e) {
      console.error('Safari MRU Tab Switch: Error using GM_getTabs:', e);
    }
  }

  // Replace the old cleanup function with the new one
  function cleanupClosedTabs() {
    const now = Date.now();

    if (now - lastCleanupTime < CLEANUP_INTERVAL) {
      return; // Don't clean up too frequently
    }

    lastCleanupTime = now;
    cleanupTabsUsingGMTabs();
  }

  // Update: Mark a tab as potentially closed
  function markTabAsClosed(tab) {
    if (!tab) return;

    const history = getTabHistory();
    let updated = false;

    for (let i = 0; i < history.length; i++) {
      if (history[i].url === tab.url) {
        history[i].isClosed = true;
        console.log(`Safari MRU Tab Switch: Marked tab as potentially closed: ${tab.title}`);
        updated = true;
        break;
      }
    }

    if (updated) {
      saveTabHistory(history);
    }
  }

  // Updated: Modify executeTabSwitch to handle potentially closed tabs
  function executeTabSwitch(deepLink, tabData) {
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
        // If we fail to switch, the tab might be closed
        if (tabData) {
            markTabAsClosed(tabData);
        }
        return false;
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

          // Run comprehensive tab cleanup to keep history accurate
          cleanupTabsUsingGMTabs();
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

  // Create tab cycle overlay
  function createTabCycleOverlay() {
    // Create overlay container if it doesn't exist
    if (!tabCycleOverlay) {
      tabCycleOverlay = document.createElement('div');
      tabCycleOverlay.id = 'safari-mru-tab-cycle-overlay';
      tabCycleOverlay.style.cssText = `
        position: fixed;
        top: 20%;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(42, 42, 42, 0.9);
        border-radius: 10px;
        padding: 15px;
        z-index: 999999;
        display: none;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 5px 30px rgba(0, 0, 0, 0.5);
        min-width: 300px;
        max-width: 600px;
        width: 50%;
        overflow: hidden;
        transition: opacity 0.2s ease-in-out;
        opacity: 0;
      `;

      document.body.appendChild(tabCycleOverlay);
    }

    return tabCycleOverlay;
  }

  // Update the tab cycle overlay content
  function updateTabCycleOverlay() {
    const overlay = createTabCycleOverlay();

    // Clear previous content
    overlay.innerHTML = '';

    if (tabCycleHistory.length === 0) {
      overlay.innerHTML = '<div style="text-align: center; padding: 10px;">No recent tabs available</div>';
      return;
    }

    // Create title with updated key instructions including Shift+Tab
    const title = document.createElement('div');
    title.textContent = 'Recent Tabs (Alt+Tab to cycle forward, Alt+Shift+Tab to cycle backward)';
    title.style.cssText = 'font-size: 14px; margin-bottom: 10px; text-align: center; color: #aaa;';
    overlay.appendChild(title);

    // Create tab list
    const tabList = document.createElement('div');
    tabList.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-width: 100%;';

    tabCycleHistory.forEach((tab, index) => {
      const tabItem = document.createElement('div');

      // Highlight current selection - both active and inactive items have the same border width
      if (index === currentCycleIndex) {
        tabItem.style.cssText = `
          padding: 8px 12px;
          border-radius: 6px;
          background-color: rgba(59, 130, 246, 0.8);
          display: flex;
          align-items: center;
          justify-content: space-between;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border-left: 4px solid #ffffff;
          cursor: pointer;
          max-width: 100%;
        `;
      } else {
        tabItem.style.cssText = `
          padding: 8px 12px;
          border-radius: 6px;
          background-color: rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: space-between;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          cursor: pointer;
          transition: background-color 0.2s ease;
          max-width: 100%;
          border-left: 4px solid transparent;
        `;
      }

      // Container for title with enforced max-width
      const titleContainer = document.createElement('div');
      titleContainer.style.cssText = 'flex: 1; min-width: 0; max-width: calc(100% - 80px); display: flex; align-items: center;';

      // Tab title with proper truncation
      const tabTitle = document.createElement('div');
      tabTitle.textContent = tab.title;
      tabTitle.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;';

      // Add title attribute to show full title on hover
      tabTitle.title = tab.title;

      titleContainer.appendChild(tabTitle);
      tabItem.appendChild(titleContainer);

      // Tab index if available
      const tabIndex = document.createElement('div');
      if (tab.index >= 0) {
        tabIndex.textContent = `Tab #${tab.index + 1}`;
        tabIndex.style.cssText = 'margin-left: 10px; color: #aaa; font-size: 12px; flex-shrink: 0;';
      }

      if (tabIndex.textContent) {
        tabItem.appendChild(tabIndex);
      }

      tabList.appendChild(tabItem);
    });

    overlay.appendChild(tabList);
  }

  // Show the tab cycle overlay - Update to use GM_getTabs for fresh data
  function showTabCycleOverlay() {
    const overlay = createTabCycleOverlay();

    // Run cleanup before showing the overlay to remove closed tabs
    cleanupTabsUsingGMTabs(); // Use the more comprehensive cleanup

    // Get the updated history after cleanup
    setTimeout(() => {
      // Short timeout to allow cleanup to complete
      tabCycleHistory = getTabHistory();
      currentCycleIndex = 0;
      initialCycleIndex = 0;
      updateTabCycleOverlay();
    }, 50);

    // Show overlay with fade-in effect
    overlay.style.display = 'block';
    setTimeout(() => {
      overlay.style.opacity = '1';
    }, 60); // Increase timeout slightly to ensure we have updated data
  }

  // Hide the tab cycle overlay
  function hideTabCycleOverlay() {
    const overlay = tabCycleOverlay;
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 200);
    }
  }

  // Cycle to the next tab in the overlay
  function cycleToNextTab() {
    if (tabCycleHistory.length === 0) return;

    currentCycleIndex = (currentCycleIndex + 1) % tabCycleHistory.length;
    updateTabCycleOverlay();
  }

  // Add function to cycle to the previous tab (opposite direction)
  function cycleToPreviousTab() {
    if (tabCycleHistory.length === 0) return;

    // Cycle backwards
    currentCycleIndex = (currentCycleIndex - 1 + tabCycleHistory.length) % tabCycleHistory.length;
    updateTabCycleOverlay();
  }

  // Updated switchToSelectedCycleTab with error handling
  function switchToSelectedCycleTab() {
    if (tabCycleHistory.length === 0 || currentCycleIndex >= tabCycleHistory.length) return;

    const selectedTab = tabCycleHistory[currentCycleIndex];
    console.log(`Safari MRU Tab Switch: Switching to selected tab:`, selectedTab);

    // Create deep link and execute
    const deepLink = createTabSwitchDeepLink(selectedTab.index, selectedTab.title);
    const success = executeTabSwitch(deepLink, selectedTab);

    if (success) {
      // Update history - move the selected tab to front
      const newHistory = [selectedTab];

      // Add the rest, excluding the selected one
      for (const tab of tabCycleHistory) {
        if (tab.url !== selectedTab.url) {
          newHistory.push(tab);
        }
      }

      // Save the updated history
      saveTabHistory(newHistory);
    } else {
      console.error('Safari MRU Tab Switch: Failed to switch to tab, it might be closed');
    }
  }

  // Handle alt key down
  function handleAltKeyDown(e) {
    // Only trigger on plain alt key, not with other modifiers
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (!isAltKeyPressed) {
        console.log('Safari MRU Tab Switch: Alt key pressed, showing tab cycle overlay');
        isAltKeyPressed = true;
        showTabCycleOverlay();
      }
    }
  }

  // Handle alt key up - switch to selected tab only if changed
  function handleAltKeyUp(e) {
    if (isAltKeyPressed) {
      console.log('Safari MRU Tab Switch: Alt key released');
      isAltKeyPressed = false;
      hideTabCycleOverlay();

      // Only switch if the user actually changed the tab selection
      if (currentCycleIndex !== initialCycleIndex) {
        console.log('Safari MRU Tab Switch: Tab selection changed, switching tabs');
        switchToSelectedCycleTab();
      } else {
        console.log('Safari MRU Tab Switch: Tab selection unchanged, not switching');
      }
    }
  }

  // Update tab key handler to support Shift+Tab for reverse cycling
  function handleTabKeyWithAltPressed(e) {
    if (isAltKeyPressed && e.key === 'Tab') {
      console.log(`Safari MRU Tab Switch: ${e.shiftKey ? 'Shift+' : ''}Tab key pressed while Alt is down, cycling tabs ${e.shiftKey ? 'backwards' : 'forwards'}`);
      e.preventDefault();
      e.stopPropagation();

      // Use Shift+Tab to go backward in the cycle
      if (e.shiftKey) {
        cycleToPreviousTab();
      } else {
        cycleToNextTab();
      }
    }
  }

  // Handle Escape key to cancel tab switching
  function handleEscapeKey(e) {
    if (e.key === 'Escape' && isAltKeyPressed) {
      console.log('Safari MRU Tab Switch: Escape key pressed, cancelling tab switch');
      e.preventDefault();
      e.stopPropagation();

      // Reset state and hide overlay
      isAltKeyPressed = false;
      hideTabCycleOverlay();

      return false;
    }
  }

  // Fix the Alt+Tab handling - don't switch immediately
  document.addEventListener('keydown', function(e) {
      // Only use Alt+Tab now, but don't switch immediately - show overlay instead
      if (e.altKey && e.key === 'Tab') {
          console.log(`Safari MRU Tab Switch: Alt+${e.shiftKey ? 'Shift+' : ''}Tab detected! Showing tab cycle overlay`);
          e.preventDefault();
          e.stopPropagation();

          // Show the overlay instead of switching immediately
          if (!isAltKeyPressed) {
            isAltKeyPressed = true;
            showTabCycleOverlay();

            // Cycle to the appropriate tab (usually previous tab is at index 1)
            if (tabCycleHistory.length > 1) {
              // If Shift is pressed, go to last tab instead of second tab for initial selection
              if (e.shiftKey && tabCycleHistory.length > 2) {
                currentCycleIndex = tabCycleHistory.length - 1;
              } else {
                currentCycleIndex = 1; // Skip to the previous tab (index 1)
              }
              // Update initialCycleIndex to track where we started
              initialCycleIndex = currentCycleIndex;
              updateTabCycleOverlay();
            }
          } else {
            // If already showing overlay, cycle in appropriate direction
            if (e.shiftKey) {
              cycleToPreviousTab();
            } else {
              cycleToNextTab();
            }
          }

          return false;
      }
  }, true);

  // Similar changes for window-level listener
  window.addEventListener('keydown', function(e) {
      if (e.altKey && e.key === 'Tab') {
          // Similar implementation as above with Shift key support
          // ...same implementation with shift key handling...
          e.preventDefault();
          e.stopPropagation();

          // Similar implementation as above
          if (!isAltKeyPressed) {
            isAltKeyPressed = true;
            showTabCycleOverlay();

            if (tabCycleHistory.length > 1) {
              if (e.shiftKey && tabCycleHistory.length > 2) {
                currentCycleIndex = tabCycleHistory.length - 1;
              } else {
                currentCycleIndex = 1;
              }
              // Update initialCycleIndex here too
              initialCycleIndex = currentCycleIndex;
              updateTabCycleOverlay();
            }
          } else {
            if (e.shiftKey) {
              cycleToPreviousTab();
            } else {
              cycleToNextTab();
            }
          }

          return false;
      }
  }, true);

  // Also update keyCode handler
  document.addEventListener('keydown', function(e) {
      if (e.altKey && e.keyCode === 9) {
          // Similar implementation with Shift key support
          // ...same implementation with shift key handling...

          e.preventDefault();
          e.stopPropagation();

          if (!isAltKeyPressed) {
            isAltKeyPressed = true;
            showTabCycleOverlay();

            if (tabCycleHistory.length > 1) {
              if (e.shiftKey && tabCycleHistory.length > 2) {
                currentCycleIndex = tabCycleHistory.length - 1;
              } else {
                currentCycleIndex = 1;
              }
              // Update initialCycleIndex here too
              initialCycleIndex = currentCycleIndex;
              updateTabCycleOverlay();
            }
          } else {
            if (e.shiftKey) {
              cycleToPreviousTab();
            } else {
              cycleToNextTab();
            }
          }

          return false;
      }
  }, true);

  // Set up keyboard shortcuts for tab cycling and ESC key
  document.addEventListener('keydown', handleAltKeyDown);
  document.addEventListener('keyup', function(e) {
    if (e.key === 'Alt') {
      handleAltKeyUp(e);
    }
  });
  document.addEventListener('keydown', handleTabKeyWithAltPressed, true);

  // Add escape key handler
  document.addEventListener('keydown', handleEscapeKey, true);
  window.addEventListener('keydown', handleEscapeKey, true);

  // Handle visibility change - clean up UI if needed
  document.addEventListener('visibilitychange', function() {
    console.log(`Safari MRU Tab Switch: Visibility changed to: ${document.visibilityState}`);

    if (document.visibilityState === 'visible') {
        console.log('Safari MRU Tab Switch: Tab became visible, updating history');
        initializeTabTracking();
    }

    // Also clean up the tab cycle UI if the document becomes hidden
    if (document.visibilityState === 'hidden' && isAltKeyPressed) {
      isAltKeyPressed = false;
      hideTabCycleOverlay();
    }
  });

  // Add window focus handler to refresh tab data
  window.addEventListener('focus', function() {
    console.log('Safari MRU Tab Switch: Window gained focus, refreshing tab data');

    // Update tracking for this tab
    initializeTabTracking();

    // Clean up closed tabs
    cleanupTabsUsingGMTabs();

    // If tab cycle overlay is currently visible, refresh its content
    if (tabCycleOverlay && tabCycleOverlay.style.display === 'block') {
      console.log('Safari MRU Tab Switch: Refreshing visible tab cycle overlay');

      // Get fresh tab history
      setTimeout(() => {
        tabCycleHistory = getTabHistory();

        // If the currently selected tab was closed, reset to first tab
        if (currentCycleIndex >= tabCycleHistory.length) {
          currentCycleIndex = 0;
        }

        updateTabCycleOverlay();
      }, 100); // Short delay to allow cleanup to complete
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

  // Debug functions for the console - Add tab inspection
  function debugShowActiveTabs() {
      console.log('Safari MRU Tab Switch: Retrieving active tabs data...');
      GM_getTabs(function(tabs) {
          console.log('Active tabs:', tabs);
          return tabs;
      });
  }

  // Update debug functions
  unsafeWindow._mruTabSwitch = {
      showHistory: debugShowHistory,
      switchToPrevious: switchToPreviousTab,
      clearHistory: clearTabHistory,
      switchToTab: switchToTab,
      updateIndex: updateTabIndex,
      checkUrl: function(url) { return !shouldExcludeUrl(url); },
      showTabCycleOverlay: showTabCycleOverlay,
      hideTabCycleOverlay: hideTabCycleOverlay,
      showActiveTabs: debugShowActiveTabs, // Add new debug function
      cleanupTabs: cleanupTabsUsingGMTabs // Add direct access to tab cleanup
  };

  // Initialize when the document is ready
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeTabTracking);
  } else {
      initializeTabTracking();
  }

  // Display a startup message in the console - UPDATED with new shortcut info
  console.log('%c Safari MRU Tab Switch Loaded (with AppleScript support) ',
             'background: #3498db; color: white; font-size: 18px; font-weight: bold;');
  console.log('%c Press Alt+Tab to switch tabs on all platforms ',
             'background: #2ecc71; color: white; font-size: 14px;');
  console.log('%c This version uses Raycast AppleScript deep links for actual tab switching ',
             'background: #9C27B0; color: white; font-size: 14px;');
})();

// ==UserScript==
// @name        Safari MRU Tab Switch
// @namespace   http://tampermonkey.net/
// @version     1.10
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

// biome-ignore lint/complexity/useArrowFunction: <explanation>
(function () {
  console.log(
    "Safari MRU Tab Switch: Script initialized with updated AppleScript deep link support",
  );

  const gmGetTabsAsync = () =>
    new Promise((resolve, reject) => {
      GM_getTabs((tabs) => resolve(tabs));
    });
  const gmGetTabAsync = () =>
    new Promise((resolve, reject) => {
      GM_getTab((tab) => resolve(tab));
    });

  // Constants
  const HISTORY_KEY = "mruTabHistoryWithIndices";
  const RAYCAST_DEEPLINK_PREFIX = "raycast://script-commands/switch-safari-tab-url";
  // Removed MAX_HISTORY constant
  // Removed NEW_TAB_CHECK_INTERVAL constant

  // Remove variable to track when we last checked for new tabs
  // let lastNewTabCheckTime = 0;

  // URL patterns to exclude from history
  const EXCLUDED_URL_PATTERNS = [
    /service_worker/i,
    /sw_iframe/i,
    /^about:/i,
    /^chrome:/i,
    /^safari-extension:/i,
    /^data:/i,
    /^javascript:/i,
    /^blob:/i,
  ];

  // Variables for tab cycling UI - changed to use Alt key instead of Meta
  let isAltKeyPressed = false;
  let tabCycleOverlay = null;
  let currentCycleIndex = 0;
  let tabCycleHistory = [];

  // Remove all cache-related variables

  // Variable to track if we're currently switching tabs
  let isSwitching = false;
  let lastSwitchTime = 0;
  const DOUBLE_PRESS_THRESHOLD = 500; // ms

  // Add variable to track initial tab index
  let initialCycleIndex = 0;

  // Update alt key handling with debouncing
  let altKeyDebounceTimer = null;
  let escKeyPrePressed = false;

  // Utility function to check if a URL should be excluded from history
  function shouldExcludeUrl(url) {
    // Check against excluded patterns
    for (const pattern of EXCLUDED_URL_PATTERNS) {
      if (pattern.test(url)) {
        console.log(
          `Safari MRU Tab Switch: Excluding URL that matches pattern ${pattern}: ${url}`,
        );
        return true;
      }
    }
    return false;
  }

  // Get current tab info - simplified
  function getCurrentTabInfo() {
    // Skip if URL should be excluded
    if (shouldExcludeUrl(window.location.href)) {
      console.log(
        "Safari MRU Tab Switch: Skipping tab info collection - URL is in exclusion list",
      );
      return null;
    }

    // Try to get tab index from document
    let tabIndex = -1;

    try {
      // Get tab index from meta tag if available
      const metaTabIndex = document.querySelector(
        'meta[name="safari-tab-index"]',
      );
      if (metaTabIndex) {
        tabIndex = Number.parseInt(metaTabIndex.getAttribute("content"), 10);
        console.log(
          `Safari MRU Tab Switch: Found tab index from meta tag: ${tabIndex}`,
        );
      }
    } catch (e) {
      console.error("Error getting tab index from meta:", e);
    }

    return {
      id: `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url: window.location.href,
      safeUrl: window.location.href,
      title: (document.querySelector("title")?.textContent) || window.location.href,
      index: tabIndex, // May be -1 if unknown
      lastAccessed: Date.now(),
    };
  }

  // Get the tab order history - simplified without backup recovery
  function getTabHistory() {
    return GM_getValue(HISTORY_KEY, []);
  }

  // Save the tab order history - simplified without backup
  function saveTabHistory(history) {
    GM_setValue(HISTORY_KEY, history);
    console.log("Safari MRU Tab Switch: Saved tab history:", history);
  }

  // Update tab history when this tab is accessed
  function updateTabHistory(tabData) {
    if (isSwitching) {
      console.log(
        "Safari MRU Tab Switch: Switching in progress, skipping history update",
      );
      return;
    }

    // Skip if tabData is null (iframe or excluded URL)
    if (!tabData) {
      console.log(
        "Safari MRU Tab Switch: Skipping history update - invalid tab data",
      );
      return;
    }

    // Skip if URL should be excluded (double-check)
    if (shouldExcludeUrl(tabData.url)) {
      console.log(
        "Safari MRU Tab Switch: Skipping history update - URL is in exclusion list",
      );
      return;
    }

    console.log("Safari MRU Tab Switch: Updating tab history with:", tabData);

    // Get current history
    const history = getTabHistory();

    // Remove this tab if it's already in history (by URL)
    const existingIndex = history.findIndex((tab) => tab.url === tabData.url);
    if (existingIndex !== -1) {
      console.log(
        `Safari MRU Tab Switch: Removing existing tab from history at position ${existingIndex}`,
      );
      history.splice(existingIndex, 1);
    }

    // Add this tab to the beginning of history
    history.unshift(tabData);

    // Save the updated history
    saveTabHistory(history);

    // Store the tab data in the current tab's storage
    (async () => {
      const tab = await gmGetTabAsync();
      tab.mruTabData = tabData;
      GM_saveTab(tab);
    })();
  }

  // Create deep link for tab switching - UPDATED to strictly prioritize index
  function createTabSwitchDeepLink(safeUrl) {
    console.log(
      `Safari MRU Tab Switch: Using safe URL "${safeUrl}" for switch`,
    );
    return `${RAYCAST_DEEPLINK_PREFIX}?arguments=${encodeURIComponent(safeUrl)}`;
  }

  async function cleanupTabsUsingGMTabs() {
    console.log(
      "Safari MRU Tab Switch: Running fresh tab cleanup with GM_getTabs",
    );

    const history = getTabHistory();
    if (!history || history.length === 0) {
      return history;
    }

    try {
      const tabs = await gmGetTabsAsync();
      console.log(
        `Safari MRU Tab Switch: Retrieved data for ${Object.keys(tabs).length} active tabs`,
      );

      const activeTabUrls = new Set();
      for (const [tabId, tabData] of Object.entries(tabs)) {
        if (tabData.mruTabData?.url) {
          activeTabUrls.add(tabData.mruTabData.url);
        }
      }

      console.log(
        `Safari MRU Tab Switch: Found ${activeTabUrls.size} active tab URLs`,
      );

      if (activeTabUrls.size < 2 && history.length > 3) {
        console.warn(
          "Safari MRU Tab Switch: Too few active URLs detected, skipping cleanup",
        );
        return history;
      }

      const updatedHistory = history.filter((historyTab) => {
        const isActive = activeTabUrls.has(historyTab.url);
        if (!isActive) {
          console.log(
            `Safari MRU Tab Switch: Removing closed tab from history: ${historyTab.title}`,
          );
        }
        return isActive;
      });

      if (updatedHistory.length !== history.length) {
        console.log(
          `Safari MRU Tab Switch: Removed ${history.length - updatedHistory.length} closed tabs from history`,
        );
        saveTabHistory(updatedHistory);
        return updatedHistory;
      }
      console.log("Safari MRU Tab Switch: No closed tabs found in history");
      return history;
    } catch (e) {
      console.error("Safari MRU Tab Switch: Error using GM_getTabs:", e);
      return history;
    }
  }

  function executeTabSwitch(deepLink) {
    console.log(`Safari MRU Tab Switch: Executing deep link: ${deepLink}`);

    // Create a temporary link element to open the deep link
    const linkElement = document.createElement("a");
    linkElement.href = deepLink;
    linkElement.style.display = "none";

    // Add to document and click
    document.body.appendChild(linkElement);

    try {
      linkElement.click();
      console.log("Safari MRU Tab Switch: Deep link click event fired");
    } catch (e) {
      console.error("Safari MRU Tab Switch: Failed to click deep link:", e);
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
    console.log("Safari MRU Tab Switch: Attempting to switch to previous tab");

    const history = getTabHistory();

    if (history.length <= 1) {
      console.log("Safari MRU Tab Switch: No previous tabs available");
      console.log(
        "%c No previous tabs available to switch to ",
        "background: #ff0000; color: white; font-size: 16px;",
      );
      return;
    }

    isSwitching = true;

    // Get the current tab data
    const currentTab = getCurrentTabInfo();
    const now = Date.now();
    const isDoubleTap = now - lastSwitchTime < DOUBLE_PRESS_THRESHOLD;
    lastSwitchTime = now;

    // Get the previous tab with index validation
    let previousTab = null;

    for (const tab of history) {
      if (tab.url !== currentTab.url) {
        // Found a different tab, check its index
        if (tab.index >= 0) {
          previousTab = tab;
          console.log(
            `Safari MRU Tab Switch: Found previous tab with valid index ${tab.index}`,
          );
          break;
        }
        console.warn(
          "Safari MRU Tab Switch: Skipping tab with invalid index:",
          { title: tab.title, index: tab.index },
        );
      }
    }

    // If no tab with valid index found, take first different tab
    if (!previousTab) {
      for (const tab of history) {
        if (tab.url !== currentTab.url) {
          previousTab = tab;
          console.warn(
            "Safari MRU Tab Switch: No tab with valid index found, using first different tab",
          );
          break;
        }
      }
    }

    if (!previousTab) {
      console.log("Safari MRU Tab Switch: No valid previous tab found");
      console.log(
        "%c No previous tab found to switch to ",
        "background: #ff0000; color: white; font-size: 16px;",
      );
      isSwitching = false;
      return;
    }

    // Log tab index for debugging
    console.log("Safari MRU Tab Switch: Switching to tab:", previousTab);
    console.log(
      `Safari MRU Tab Switch: Previous tab index: ${previousTab.index}, title: "${previousTab.title}"`,
    );

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
    const deepLink = createTabSwitchDeepLink(previousTab.title);

    console.log(`Safari MRU Tab Switch: Generated deep link: ${deepLink}`);

    // Visual feedback
    console.log(
      "%c Tab switch initiated! ",
      "background: #4CAF50; color: white; font-size: 16px;",
    );

    // Try to switch tabs with the deep link
    const success = executeTabSwitch(deepLink);

    if (!success || isDoubleTap) {
      // For double-tap or if deep link fails, try more aggressive visual feedback
      try {
        // Flash the screen
        const flashElement = document.createElement("div");
        flashElement.style.position = "fixed";
        flashElement.style.top = "0";
        flashElement.style.left = "0";
        flashElement.style.width = "100%";
        flashElement.style.height = "100%";
        flashElement.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
        flashElement.style.zIndex = "9999999";
        flashElement.style.transition = "opacity 0.3s ease-out";
        flashElement.style.pointerEvents = "none";
        flashElement.style.display = "flex";
        flashElement.style.justifyContent = "center";
        flashElement.style.alignItems = "center";

        // Show the target tab info
        flashElement.innerHTML = `<div style="font-size: 24px; color: #333; font-weight: bold; text-align: center;">
                  <div style="margin-bottom: 10px;">Switching to Tab:</div>
                  <div style="font-size: 18px; color: #0066cc;">${previousTab.title}</div>
              </div>`;

        document.body.appendChild(flashElement);

        setTimeout(() => {
          flashElement.style.opacity = "0";
          setTimeout(() => {
            document.body.removeChild(flashElement);
          }, 300);
        }, 1000);

        // If it's a double-tap, try the deep link again
        if (isDoubleTap) {
          console.log(
            "%c Double-tap detected! Trying deep link again ",
            "background: #9C27B0; color: white; font-size: 14px;",
          );
          setTimeout(() => {
            executeTabSwitch(deepLink);
          }, 300);
        }
      } catch (e) {
        console.error(
          "Safari MRU Tab Switch: Error during visual feedback:",
          e,
        );
      }
    }

    setTimeout(() => {
      isSwitching = false;
      console.log("Safari MRU Tab Switch: Switching mode deactivated");
    }, 1000);
  }

  // Initialize tab tracking - simplified without title observer
  function initializeTabTracking() {
    // Skip if URL should be excluded
    if (shouldExcludeUrl(window.location.href)) {
      console.log(
        "Safari MRU Tab Switch: Skipping initialization - URL is in exclusion list",
      );
      return;
    }

    // Get current tab information
    const tabData = getCurrentTabInfo();

    // Update the tab history with this tab (only if valid)
    if (tabData) {
      updateTabHistory(tabData);
      console.log(
        "Safari MRU Tab Switch: Tab tracking initialized with data:",
        tabData,
      );

      checkForNewTabs();
    } else {
      console.log(
        "Safari MRU Tab Switch: Skipping tab tracking initialization - invalid tab data",
      );
    }
  }

  // Create tab cycle overlay with improved width constraints and text handling
  function createTabCycleOverlay() {
    // Create overlay container if it doesn't exist
    if (!tabCycleOverlay) {
      tabCycleOverlay = document.createElement("div");
      tabCycleOverlay.id = "safari-mru-tab-cycle-overlay";
      tabCycleOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 100px));
        background-color: rgba(42, 42, 42, 0.9);
        border-radius: 10px;
        padding: 15px;
        z-index: 999999;
        display: none;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 5px 30px rgba(0, 0, 0, 0.5);
        max-width: 600px;
        width: 80%;
        overflow: hidden;
        transition: opacity 0.2s ease-in-out;
        opacity: 0;
      `;

      document.body.appendChild(tabCycleOverlay);
    }

    return tabCycleOverlay;
  }

  // Update the tab cycle overlay content with improved text truncation
  function updateTabCycleOverlay() {
    const overlay = createTabCycleOverlay();

    // Clear previous content
    overlay.innerHTML = "";

    if (tabCycleHistory.length === 0) {
      overlay.innerHTML =
        '<div style="text-align: center; padding: 10px;">No recent tabs available</div>';
      return;
    }

    // Create title with updated key instructions including Shift+Tab
    const title = document.createElement("div");
    title.textContent =
      "Recent Tabs (Alt+Tab to cycle forward, Alt+Shift+Tab to cycle backward)";
    title.style.cssText =
      "font-size: 14px; margin-bottom: 10px; text-align: center; color: #aaa;";
    overlay.appendChild(title);

    // Create tab list with improved styling
    const tabList = document.createElement("div");
    tabList.style.cssText =
      "display: flex; flex-direction: column; gap: 8px; max-height: 70vh; overflow-y: auto;";

    tabCycleHistory.forEach((tab, index) => {
      const tabItem = document.createElement("div");

      // Highlight current selection with improved text handling
      if (index === currentCycleIndex) {
        tabItem.style.cssText = `
          padding: 8px 12px;
          max-height: 35px;
          border-radius: 6px;
          background-color: rgba(59, 130, 246, 0.8);
          display: flex;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
          border-left: 4px solid #ffffff;
          cursor: pointer;
        `;
      } else {
        tabItem.style.cssText = `
          padding: 8px 12px;
          max-height: 35px;
          border-radius: 6px;
          background-color: rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
          border-left: 4px solid transparent;
          cursor: pointer;
        `;
      }

      // Tab title container with improved text truncation
      const tabTitleContainer = document.createElement("div");
      tabTitleContainer.style.cssText =
        "flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; height: 18px; line-height: 18px;";

      // Tab title with guaranteed truncation
      const tabTitle = document.createElement("span");
      tabTitle.textContent = tab.title;
      tabTitle.style.cssText =
        "display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; line-height: 18px; font-size: 14px;";

      tabTitleContainer.appendChild(tabTitle);
      tabItem.appendChild(tabTitleContainer);

      // Tab index if available, with fixed width to ensure consistent layout
      if (tab.index >= 0) {
        const tabIndex = document.createElement("div");
        tabIndex.textContent = `Tab #${tab.index + 1}`;
        tabIndex.style.cssText =
          "margin-left: 10px; color: #aaa; font-size: 12px; min-width: 50px; text-align: right; flex-shrink: 0;";
        tabItem.appendChild(tabIndex);
      }

      // Add click handler to switch to this tab
      tabItem.addEventListener("click", (e) => {
        console.log(
          `Safari MRU Tab Switch: Tab clicked, index ${index}, title "${tab.title}"`,
        );
        e.stopPropagation();

        // Update current index
        currentCycleIndex = index;

        // Hide the overlay
        hideTabCycleOverlay();

        // Switch to the tab
        setTimeout(() => {
          isAltKeyPressed = false;
          switchToSelectedCycleTab();
        }, 50);
      });

      tabList.appendChild(tabItem);
    });

    overlay.appendChild(tabList);
  }

  // Show the tab cycle overlay - Updated to always clean up tabs first
  async function showTabCycleOverlay() {
    const overlay = createTabCycleOverlay();

    if (overlay.style.display === "block" && overlay.style.opacity === "1") {
      console.log(
        "Safari MRU Tab Switch: Overlay already showing, not rebuilding",
      );
      return;
    }
    await checkForNewTabs();
    await cleanupTabsUsingGMTabs();
    tabCycleHistory = getTabHistory();
    currentCycleIndex = 0;
    initialCycleIndex = 0;
    updateTabCycleOverlay();

    overlay.style.display = "block";
    setTimeout(() => {
      overlay.style.opacity = "1";
    }, 30);
  }

  // Hide the tab cycle overlay
  function hideTabCycleOverlay() {
    const overlay = tabCycleOverlay;
    if (overlay) {
      overlay.style.opacity = "0";
      setTimeout(() => {
        overlay.style.display = "none";
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
    currentCycleIndex =
      (currentCycleIndex - 1 + tabCycleHistory.length) % tabCycleHistory.length;
    updateTabCycleOverlay();
  }

  // Updated switchToSelectedCycleTab with error handling
  function switchToSelectedCycleTab() {
    if (
      tabCycleHistory.length === 0 ||
      currentCycleIndex >= tabCycleHistory.length
    )
      return;

    const selectedTab = tabCycleHistory[currentCycleIndex];
    console.log(
      "Safari MRU Tab Switch: Switching to selected tab:",
      selectedTab,
    );

    // Create deep link and execute
    const deepLink = createTabSwitchDeepLink(selectedTab.safeUrl);
    const success = executeTabSwitch(deepLink);

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
      console.error(
        "Safari MRU Tab Switch: Failed to switch to tab, it might be closed",
      );
    }
  }

  // Handle alt key up - switch to selected tab only if changed
  function handleAltKeyUp() {
    if (isAltKeyPressed) {
      console.log("Safari MRU Tab Switch: Alt key released");
      isAltKeyPressed = false;
      hideTabCycleOverlay();

      // Only switch if the user actually changed the tab selection
      if (currentCycleIndex !== initialCycleIndex) {
        console.log(
          "Safari MRU Tab Switch: Tab selection changed, switching tabs",
        );
        switchToSelectedCycleTab();
      } else {
        console.log(
          "Safari MRU Tab Switch: Tab selection unchanged, not switching",
        );
      }
    }
  }

  function globalKeyDownHandler(e) {
    const evt = e || window.event;

    // Handle Escape key separately
    if (evt.key === "Escape" || evt.key === "Esc" || evt.keyCode === 27) {
      if (isAltKeyPressed) {
        console.log("Safari MRU Tab Switch: Escape pressed, cancelling tab switch");
        isAltKeyPressed = false;
        hideTabCycleOverlay();
        return false;
      }
      // Let Escape propagate normally when not in tab switching mode
      return;
    }

    // Handle backtick to always cancel
    if (evt.key === "Dead") {
      console.log(
        "Safari MRU Tab Switch: Backtick pressed, cancelling tab switch",
      );
      isAltKeyPressed = false;
      hideTabCycleOverlay();
      if (altKeyDebounceTimer) {
        clearTimeout(altKeyDebounceTimer);
        altKeyDebounceTimer = null;
      }
      return false;
    }

    // Handle Alt+Tab (by key or keyCode 9)
    if (e.altKey && (e.key === "Tab" || e.keyCode === 9)) {
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

    // Handle plain Alt key press
    if (e.key === "Alt") {
      // If Escape was pressed before Alt, cancel tab switch
      if (escKeyPrePressed) {
        console.log(
          "Safari MRU Tab Switch: Alt key pressed after Escape, cancelling tab switch",
        );
        isAltKeyPressed = false;
        hideTabCycleOverlay();
        escKeyPrePressed = false;
        if (altKeyDebounceTimer) {
          clearTimeout(altKeyDebounceTimer);
          altKeyDebounceTimer = null;
        }
        return false;
      }
      altKeyPressedTimestamp = Date.now();
      if (!isAltKeyPressed) {
        console.log(
          "Safari MRU Tab Switch: Alt key pressed, showing tab cycle overlay",
        );
        isAltKeyPressed = true;
        if (altKeyDebounceTimer) {
          clearTimeout(altKeyDebounceTimer);
        }
        altKeyDebounceTimer = setTimeout(() => {
          showTabCycleOverlay();
          altKeyDebounceTimer = null;
        }, 50);
      }
    }
  }

  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Alt") {
        handleAltKeyUp(e);
      }
    },
    true,
  );
  document.addEventListener("keydown", globalKeyDownHandler, true);
  window.addEventListener("keydown", globalKeyDownHandler, true);

  // Handle visibility change - refresh data when tab becomes visible
  document.addEventListener("visibilitychange", () => {
    console.log(
      `Safari MRU Tab Switch: Visibility changed to: ${document.visibilityState}`,
    );

    if (document.visibilityState === "visible") {
      console.log(
        "Safari MRU Tab Switch: Tab became visible, updating history",
      );
      initializeTabTracking();
    }

    // Also clean up the tab cycle UI if the document becomes hidden
    if (document.visibilityState === "hidden" && isAltKeyPressed) {
      isAltKeyPressed = false;
      hideTabCycleOverlay();
    }
  });

  // Debug functions for the console
  function debugShowHistory() {
    const history = getTabHistory();
    console.log("Safari MRU Tab Switch: Tab history:", history);
    return history;
  }

  function clearTabHistory() {
    saveTabHistory([]);
    console.log("Safari MRU Tab Switch: Tab history cleared");
    return "History cleared";
  }

  function switchToTab(title) {
    const deepLink = createTabSwitchDeepLink(title);
    return executeTabSwitch(deepLink);
  }

  // Debug functions for the console - Add tab inspection
  function debugShowActiveTabs() {
    console.log("Safari MRU Tab Switch: Retrieving active tabs data...");
    GM_getTabs((tabs) => {
      console.log("Active tabs:", tabs);
      return tabs;
    });
  }

  async function checkForNewTabs() {
    console.log("Safari MRU Tab Switch: Checking for new tabs...");

    const history = getTabHistory();
    const knownUrls = new Set(history.map((tab) => tab.url));

    try {
      const tabs = await gmGetTabsAsync();
      console.log(
        `Safari MRU Tab Switch: Found ${Object.keys(tabs).length} active tabs`,
      );

      const newTabsFound = [];

      for (const [tabId, tabData] of Object.entries(tabs)) {
        if (
          tabData.mruTabData?.url &&
          !shouldExcludeUrl(tabData.mruTabData.url)
        ) {
          if (!knownUrls.has(tabData.mruTabData.url)) {
            console.log(
              `Safari MRU Tab Switch: Found new tab not in history: ${tabData.mruTabData.title}`,
            );
            newTabsFound.push(tabData.mruTabData);
          }
        }
      }

      if (newTabsFound.length > 0) {
        console.log(
          `Safari MRU Tab Switch: Adding ${newTabsFound.length} new tabs to history`,
        );
        const updatedHistory = [...newTabsFound, ...history];
        saveTabHistory(updatedHistory);
      } else {
        console.log("Safari MRU Tab Switch: No new tabs found");
      }
    } catch (e) {
      console.error("Safari MRU Tab Switch: Error checking for new tabs:", e);
    }
  }

  // Removed the setInterval for periodic tab checking

  // Updated debug functions - remove title-related functions
  unsafeWindow._mruTabSwitch = {
    showHistory: debugShowHistory,
    switchToPrevious: switchToPreviousTab,
    clearHistory: clearTabHistory,
    switchToTab: switchToTab,
    checkUrl: (url) => !shouldExcludeUrl(url),
    showTabCycleOverlay: showTabCycleOverlay,
    hideTabCycleOverlay: hideTabCycleOverlay,
    showActiveTabs: debugShowActiveTabs,
    cleanupTabs: cleanupTabsUsingGMTabs,
    checkForNewTabs: checkForNewTabs,
  };

  // Initialize when the document is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeTabTracking);
  } else {
    initializeTabTracking();
  }

  // Watch for URL and title changes and update tab history
  function watchUrlAndTitleChanges() {
    let lastUrl = window.location.href;
    let lastTitle = document.querySelector("title").textContent;

    // Observe title changes using MutationObserver
    const titleElement = document.querySelector("title");
    if (titleElement) {
      const titleObserver = new MutationObserver(() => {
        if (titleElement.textContent !== lastTitle) {
          lastTitle = titleElement.textContent;
          console.log("Safari MRU Tab Switch: Title changed to", lastTitle);
          const tabData = getCurrentTabInfo();
          updateTabHistory(tabData);
        }
      });
      titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });
    }

    // Listen for URL changes using popstate and hashchange events
    window.addEventListener("popstate", () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("Safari MRU Tab Switch: URL changed via popstate to", lastUrl);
        const tabData = getCurrentTabInfo();
        updateTabHistory(tabData);
      }
    });
    window.addEventListener("hashchange", () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log("Safari MRU Tab Switch: URL changed via hashchange to", lastUrl);
        const tabData = getCurrentTabInfo();
        updateTabHistory(tabData);
      }
    });
  }
  watchUrlAndTitleChanges();

  // Display a startup message in the console - UPDATED with new shortcut info
  console.log(
    "%c Safari MRU Tab Switch Loaded (with AppleScript support) ",
    "background: #3498db; color: white; font-size: 18px; font-weight: bold;",
  );
  console.log(
    "%c Press Alt+Tab to switch tabs on all platforms ",
    "background: #2ecc71; color: white; font-size: 14px;",
  );
  console.log(
    "%c This version uses Raycast AppleScript deep links for actual tab switching ",
    "background: #9C27B0; color: white; font-size: 14px;",
  );
})();

chrome.runtime.onInstalled.addListener((details) => {
  const version = chrome.runtime.getManifest().version;
  console.log(`[Tensei] ${details.reason}: v${version}`);
});

// Track connected sidebar ports for message routing
const sidebarPorts = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidebar") return;
  sidebarPorts.add(port);
  port.onDisconnect.addListener(() => sidebarPorts.delete(port));
});

// Route messages from any context to all connected sidebars
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  for (const port of sidebarPorts) {
    port.postMessage(message);
  }
  sendResponse({ ack: true });
  return true;
});

// Fallback: open side panel if triggered without a popup (e.g., keyboard shortcut)
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

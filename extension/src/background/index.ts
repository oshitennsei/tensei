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

// Handle messages from all contexts (content scripts, sidebar pages)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Content script forwards portal auth token — store it and broadcast to sidebar
  if (message.type === "PORTAL_AUTH_SUCCESS" && message.token) {
    chrome.storage.local.set({ portal_session_token: message.token });
    chrome.runtime.sendMessage({ type: "PORTAL_AUTH_SUCCESS", token: message.token }).catch(() => {});
  }
  for (const port of sidebarPorts) {
    port.postMessage(message);
  }
  sendResponse({ ack: true });
  return true;
});

// Detect portal magic link callback and capture session token
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const url = tab.url ?? "";
  const m = url.match(/tensei-portal\.pages\.dev\/dashboard\?token=([A-Za-z0-9_-]+)/);
  if (!m) return;
  const sessionToken = m[1];
  chrome.storage.local.set({ portal_session_token: sessionToken });
  for (const port of sidebarPorts) {
    port.postMessage({ type: "PORTAL_AUTH_SUCCESS", token: sessionToken });
  }
  // Also broadcast to sidebar pages listening via chrome.runtime.onMessage
  chrome.runtime.sendMessage({ type: "PORTAL_AUTH_SUCCESS", token: sessionToken }).catch(() => {});
});

// Handle messages from portal / PWA pages (externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "SAVE_MODEL" && message.model) {
    chrome.storage.local.set({ pending_model: message.model }, () => {
      chrome.windows.getCurrent({ populate: false }, (w) => {
        if (w?.id != null) chrome.sidePanel.open({ windowId: w.id });
      });
      sendResponse({ ok: true });
    });
    return true;
  }
});

// Fallback: open side panel if triggered without a popup (e.g., keyboard shortcut)
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

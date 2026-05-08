chrome.windows.getCurrent((win) => {
  if (win.id !== undefined) {
    chrome.sidePanel.open({ windowId: win.id });
  }
});

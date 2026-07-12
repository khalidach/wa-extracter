// Background script (Service Worker) for Manifest V3

// Listen for clicks on the extension's toolbar icon
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes("web.whatsapp.com")) {
    // Send message to the content script in the active tab to toggle the extractor drawer
    chrome.tabs.sendMessage(tab.id, { action: "toggleDrawer" })
      .catch(err => console.log("[WA Extractor] Content script not loaded yet or active tab changed.", err));
  } else {
    // If not on WhatsApp Web, open it in a new tab
    chrome.tabs.create({ url: "https://web.whatsapp.com/" });
  }
});

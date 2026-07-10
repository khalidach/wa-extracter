// Event listener for the "Open WhatsApp Web" button in popup
document.getElementById('open-wa-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
});

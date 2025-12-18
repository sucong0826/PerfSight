// content.js
// Inject the script to capture page context logs
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Listen for messages from injected script
window.addEventListener('message', function(event) {
    if (event.source !== window) return;

    if (event.data && event.data.source === 'perfsight-inject') {
        // Forward to Background
        try {
            chrome.runtime.sendMessage(event.data);
        } catch (e) {
            // Extension context invalidated or disconnected
        }
    }
});



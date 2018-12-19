var defaultEnabled = true;  // XXX read from storage
var processMessage = function(message, sender, sendResponse) {
  console.log(message);
  if (message.operation == 'setIconOn') {
    browser.pageAction.setIcon({tabId: sender.tab.id, path: 'icons/icon-on.svg'});
  } else if (message.operation == 'setIconOff') {
    browser.pageAction.setIcon({tabId: sender.tab.id, path: 'icons/icon-off.svg'});
  }
};
browser.runtime.onMessage.addListener(processMessage);

browser.pageAction.onClicked.addListener(tab => {
  browser.tabs.sendMessage(tab.id, {operation: 'iconClicked'});
});

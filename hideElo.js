/*
 * Hide Elo ratings on lichess.org.
 *
 * This works in three steps:
 *
 * 1. At document_start, inject CSS to hide ratings already while the page is loading. At this point
 *    we need to hide a superset because some ratings are not isolated in the DOM tree.
 * 2. At document_end, make some static changes to the DOM tree to isolate ratings.
 * 3. Register MutationObserver-s to handle dynamic elements, such as the seek list and tool tips.
 *
 * Now we can toggle the visibility of the isolated/tagged elements containing ratings via CSS.
 */

var skipPageRE = new RegExp('^https?://lichess.org/training(/.*)?$');

// Generic pattern to match "foobar (1234)" or "WIM foobar (2500?)" or "BOT foobar (3333)".
var titleNameRating = '((?:[A-Z]{2,}\\s+)?\\S+)\\s+(\\([123]?\\d{3}\\??\\))';

// Matches a plain rating, like "666" or "2345".
var ratingRE = /[123]?\d{3}\??/;

// Matches name and rating in the left sidebox, e.g. "foobar (1500?)".
var leftSideboxNameRatingRE = /(\S*)\s+(\([123]?\d{3}\??\))/;

// Matches the legend shown below a game in the #powerTip, e.g. "IM foobar (2400) • 1+0".
var tooltipGameLegendRE = new RegExp(titleNameRating + '\\s+(.*)');

// Matches the tooltip of the #powerTip, e.g. "GM foobar (2500) vs baz (1500?) • 15+15".
var tooltipGameTitleRE = new RegExp(titleNameRating + '\\s+vs\\s+' + titleNameRating + '\\s+(.*)');

// Matches name and rating in an incoming challenge.
// Caveat: I don't know what a challenge from a titled player looks like :-)
var challengeNameRE = new RegExp(titleNameRating);

// Matches the TV title, e.g. "foo (1234) - bar (2345) in xyz123 * lichess.org"
var tvTitleRE = new RegExp(titleNameRating + '\\s+-\\s+' + titleNameRating + '\\s+(.*)');
var tvTitlePageRE = new RegExp('.*/tv$');

// Matches ratings in the PGN.
var pgnRatingsRE = /\[(WhiteElo|BlackElo|WhiteRatingDiff|BlackRatingDiff)\b.*\]\n/g;

// Chess960 tag in the PGN.
var chess960RE = /\[Variant\s*"Chess960"\]/;

// FEN tag in the PGN (initial position).
var fenRE = /\[FEN\s*"(([nbrqk]{8})\/p{8}\/(?:8\/){4}P{8}\/([NBRQK]{8})\s+[wb]\s+)KQkq - 0 1"\]/;

// Replace the &nbsp; Lichess sometimes puts between name and rating.
function createSeparator() {
  var nbsp = document.createTextNode('\u00A0');
  var span = document.createElement('span');
  span.appendChild(nbsp);
  return span;
}

// ---------- Seek list ----------

function observeLobbyBox(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      // When new seeks come in, individual rows are added. When switching tabs or switching back
      // from the filter settings the whole table is rebuilt and re-added.
      if (node.tagName === 'TR') {
        hideRatingsInSeekList([node]);
      } else if (typeof node.querySelectorAll === 'function') {
        hideRatingsInSeekList(node.querySelectorAll('tr'));
      }
    });
  });
}

function hideRatingsInSeekList(rows) {
  rows.forEach(function(row) {
    if (row.children.length >= 3) {
      var cell = row.children[2];
      // This is really just a hack to skip the top row (which contains headings):
      if (ratingRE.test(cell.textContent)) {
        cell.classList.add('hide_elo');
      }
    }
  });
}

var hooksWrap = document.querySelector('div#hooks_wrap');
if (hooksWrap) {
  new MutationObserver(observeLobbyBox).observe(hooksWrap, {childList: true, subtree: true});
}

// ---------- Ingame left side box ----------

function observeLeftSideBox(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      if (typeof node.querySelectorAll === 'function') {
        hideRatingsInLeftSidebox(node.querySelectorAll('.side_box div.players .player a.user_link'));
      }
    });
  });
}

function hideRatingsInLeftSidebox(players) {
  players.forEach(function(player) {
    // A title like IM is a separate node.
    if (player.firstChild.classList && player.firstChild.classList.contains('title')) {
      var nameNode = player.childNodes[1];
      player.insertBefore(createSeparator(), nameNode);
    } else {
      var nameNode = player.childNodes[0];
    }
    var match = leftSideboxNameRatingRE.exec(nameNode.textContent);
    if (match) {
      nameNode.textContent = match[1];  // Just the name.
      var rating = document.createElement('span');
      rating.textContent = match[2];
      rating.classList.add('hide_elo');
      // Insert before rating change if it exists (i.e. it's a rated game), or else at the end if
      // nextSibling is null.
      player.insertBefore(rating, nameNode.nextSibling);
      // Lichess puts an nbsp between name and rating.
      player.insertBefore(createSeparator(), nameNode.nextSibling);
      // Indicate that it's now safe to show the player name.
      player.classList.add('elo_hidden');
    }
  });
}

var boardLeft = document.querySelector('div.board_left');
if (boardLeft) {
  new MutationObserver(observeLeftSideBox).observe(boardLeft, {childList: true, subtree: true });
}

// Process the player names in the left side box of the game view. NOTE: When hovering over these
// they load a #powerTip with more ratings, which is hidden via CSS. *While* this tooltip is loading
// it will show the text from the link.
hideRatingsInLeftSidebox(document.querySelectorAll('.side_box div.players .player a.user_link'));

// ---------- Tooltip ----------

function observeTooltip(mutations) {
  if (!enabled) {
    return;
  }
  // Enabled state can't be toggled while the tooltip is shown, so we don't need to use CSS.
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      if (typeof node.matches === 'function') {
        if (node.matches('#powerTip div.game_legend')) {
          hideRatingsInTooltipGameLegend(node);
        } else if (node.matches('#miniGame a.mini_board') || node.matches('#powerTip a.mini_board')) {
          hideRatingsInMetaTooltip(node);
        } else if (node.matches('#miniGame div.vstext.clearfix')) {
          hideRatingsInMiniGame(node);
        }
      }
    });
  });
}

function hideRatingsInTooltipGameLegend(node) {
  var match = tooltipGameLegendRE.exec(node.textContent);
  if (match) {
    node.textContent = match[1] + ' ' + match[3];
  }
}

function hideRatingsInMetaTooltip(node) {
  var match = tooltipGameTitleRE.exec(node.title);
  if (match) {
    node.title = match[1] + ' vs ' + match[3] + ' ' + match[5];
  }
}

function hideRatingsInMiniGame(node) {
  if (typeof node.querySelectorAll === 'function') {
    var playerLeft = node.querySelector('div.left.user_link');
    var playerRight = node.querySelector('div.right.user_link');
    if (playerLeft) {
      // Rating is the last node.
      playerLeft.childNodes[playerLeft.childNodes.length - 1].remove();
    }
    if (playerRight) {
      // Rating is at index 2, possibly followed by a title.
      playerRight.childNodes[2].remove();
    }
  }
}

new MutationObserver(observeTooltip).observe(document, {childList: true, subtree: true});

// ---------- TV title ----------

var originalTitle = document.title;
var hiddenTitle = document.title;
if (tvTitlePageRE.test(location.href)) {
  var match = tvTitleRE.exec(document.title);
  if (match) {
    hiddenTitle = match[1] + ' - ' + match[3] + ' ' + match[5];
  }
}

// ---------- Challenge (incoming) ----------

function observeIncomingChallenge(mutations) {
  mutations.forEach(function(mutation) {
    mutation.addedNodes.forEach(function(node) {
      if (typeof node.querySelector === 'function') {
        var name = node.querySelector('div.challenges a.user_link name');
        if (name) {
          hideRatingsInIncomingChallenge(name);
        }
      }
    });
  });
}

function hideRatingsInIncomingChallenge(name) {
  var match = challengeNameRE.exec(name.textContent);
  if (match) {
    name.textContent = match[1];
    name.appendChild(createSeparator());
    var rating = document.createElement('span');
    rating.textContent = match[2];
    rating.classList.add('hide_elo');
    name.appendChild(rating);
    name.appendChild(createSeparator());
  }
}

var challengeNotifications = document.querySelector('div#top div.challenge_notifications');
if (challengeNotifications) {
  new MutationObserver(observeIncomingChallenge).observe(challengeNotifications, {childList: true, subtree: true});
}

// ---------- Analysis board: PGN ----------

var pgn = document.querySelector('div.analysis_panels div.panel.fen_pgn div.pgn');
var originalPgn;
var hiddenPgn;
if (pgn) {
  originalPgn = pgn.textContent;
  hiddenPgn = originalPgn.replace(pgnRatingsRE, '');
  pgn.textContent = hiddenPgn;
  pgn.classList.add('elo_hidden');

  // And now for our surprise feature :-)
  if (chess960RE.test(hiddenPgn)) {
    browser.storage.sync.get('convertFen').then(result => {
      if (result.convertFen) {  // default (undefined) maps to false
        var match = fenRE.exec(hiddenPgn);
        if (match) {
          if (match[2].toUpperCase() === match[3]) {
            var leftRookBlack = match[2].indexOf('r');
            var rightRookBlack = match[2].indexOf('r', leftRookBlack + 1);
            var rookFiles = String.fromCharCode('a'.charCodeAt(0) + rightRookBlack, 'a'.charCodeAt(0) + leftRookBlack);
            var sFen = '[FEN "' + match[1] + rookFiles.toUpperCase() + rookFiles + ' - 0 1"]';
            hiddenPgn = hiddenPgn.replace(fenRE, sFen);
            originalPgn = originalPgn.replace(fenRE, sFen);
            doTheThing();
          }
        }
      }
    });
  }
}

// ---------- Toggle on/off ----------

function doTheThing() {
  var skipPage = skipPageRE.test(location.href);
  if (enabled && !skipPage) {
    document.body.classList.remove('no_hide_elo');
    document.title = hiddenTitle;
    if (pgn) pgn.textContent = hiddenPgn;
  } else {
    document.body.classList.add('no_hide_elo');
    document.title = originalTitle;
    if (pgn) pgn.textContent = originalPgn;
  }
}

// ---------- Clicks on the icon ----------

// Process clicks on the icon, sent from the background script.
browser.runtime.onMessage.addListener(message => {
  if (message.operation == 'iconClicked') {
    enabled = !enabled;
  }
  storeEnabledState();
  doTheThing();
  setIconState();
});

function setIconState() {
  browser.runtime.sendMessage({operation: enabled ? 'setIconOn' : 'setIconOff'});
}

// ---------- Store/retrieve enabled state and options ----------

function storeEnabledState() {
  sessionStorage.setItem('enabled', enabled);
}

// Whether the extension is enabled on the current tab.
var enabled = sessionStorage.getItem('enabled');
if (enabled === null) {
  // Use default from sync storage. This uses actual booleans.
  browser.storage.sync.get('defaultEnabled').then(result => {
    enabled = result.defaultEnabled === undefined || result.defaultEnabled;
    storeEnabledState();
    doTheThing();
    setIconState();
  });
} else {
  // Session storage uses Strings.
  enabled = enabled === 'true';
  doTheThing();
  setIconState();
}

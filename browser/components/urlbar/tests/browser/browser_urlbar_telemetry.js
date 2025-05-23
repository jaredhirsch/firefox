/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

/**
 * This file tests urlbar telemetry with search related actions.
 */

"use strict";

const SCALAR_URLBAR = "browser.engagement.navigation.urlbar";
const SCALAR_SEARCHMODE = "browser.engagement.navigation.urlbar_searchmode";

// The preference to enable suggestions in the urlbar.
const SUGGEST_URLBAR_PREF = "browser.urlbar.suggest.searches";

ChromeUtils.defineESModuleGetters(this, {
  SearchSERPTelemetry:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
});

function searchInAwesomebar(value, win = window) {
  return UrlbarTestUtils.promiseAutocompleteResultPopup({
    window: win,
    waitForFocus,
    value,
    fireInputEvent: true,
  });
}

/**
 * Click one of the entries in the urlbar suggestion popup.
 *
 * @param {string} resultTitle
 *        The title of the result to click on.
 * @param {number} button [optional]
 *        which button to click.
 * @returns {number}
 *          The index of the result that was clicked, or -1 if not found.
 */
async function clickURLBarSuggestion(resultTitle, button = 1) {
  await UrlbarTestUtils.promiseSearchComplete(window);

  const count = UrlbarTestUtils.getResultCount(window);
  for (let i = 0; i < count; i++) {
    let result = await UrlbarTestUtils.getDetailsOfResultAt(window, i);
    if (result.displayed.title == resultTitle) {
      // This entry is the search suggestion we're looking for.
      let element = await UrlbarTestUtils.waitForAutocompleteResultAt(
        window,
        i
      );
      if (button == 1) {
        EventUtils.synthesizeMouseAtCenter(element, {});
      } else if (button == 2) {
        EventUtils.synthesizeMouseAtCenter(element, {
          type: "mousedown",
          button: 2,
        });
      }
      return i;
    }
  }
  return -1;
}

/**
 * Create an engine to generate search suggestions and add it as default
 * for this test.
 *
 * @param {Function} taskFn
 *   The function to run with the new search engine as default.
 */
async function withNewSearchEngine(taskFn) {
  let suggestionEngine = await SearchTestUtils.installOpenSearchEngine({
    url: getRootDirectory(gTestPath) + "urlbarTelemetrySearchSuggestions.xml",
  });
  let previousEngine = await Services.search.getDefault();
  await Services.search.setDefault(
    suggestionEngine,
    Ci.nsISearchService.CHANGE_REASON_UNKNOWN
  );

  try {
    await taskFn(suggestionEngine);
  } finally {
    await Services.search.setDefault(
      previousEngine,
      Ci.nsISearchService.CHANGE_REASON_UNKNOWN
    );
    await Services.search.removeEngine(suggestionEngine);
  }
}

add_setup(async function () {
  await SearchTestUtils.installSearchExtension(
    {
      name: "MozSearch",
      keyword: "mozalias",
      search_url: "https://example.com/",
    },
    { setAsDefault: true }
  );

  // Make it the first one-off engine.
  let engine = Services.search.getEngineByName("MozSearch");
  await Services.search.moveEngine(engine, 0);

  // Enable search suggestions in the urlbar.
  let suggestionsEnabled = Services.prefs.getBoolPref(SUGGEST_URLBAR_PREF);
  Services.prefs.setBoolPref(SUGGEST_URLBAR_PREF, true);

  // Enable local telemetry recording for the duration of the tests.
  let oldCanRecord = Services.telemetry.canRecordExtended;
  Services.telemetry.canRecordExtended = true;

  // Clear history so that history added by previous tests doesn't mess up this
  // test when it selects results in the urlbar.
  await PlacesUtils.history.clear();

  // Clear historical search suggestions to avoid interference from previous
  // tests.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.maxHistoricalSearchSuggestions", 0]],
  });

  // This test assumes that general results are shown before suggestions.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.showSearchSuggestionsFirst", false]],
  });

  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.scotchBonnet.enableOverride", false]],
  });

  // Make sure to restore the engine once we're done.
  registerCleanupFunction(async function () {
    Services.telemetry.canRecordExtended = oldCanRecord;
    Services.prefs.setBoolPref(SUGGEST_URLBAR_PREF, suggestionsEnabled);
    await PlacesUtils.history.clear();
    await UrlbarTestUtils.formHistory.clear();
  });
});

add_task(async function test_simpleQuery() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  clearSAPTelemetry();

  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );

  info("Simulate entering a simple search.");
  let p = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await searchInAwesomebar("simple query");
  EventUtils.synthesizeKey("KEY_Enter");
  await p;

  // Check if the scalars contain the expected values.
  const scalars = TelemetryTestUtils.getProcessScalars("parent", true, false);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    SCALAR_URLBAR,
    "search_enter",
    1
  );
  Assert.equal(
    Object.keys(scalars[SCALAR_URLBAR]).length,
    1,
    "This search must only increment one entry in the scalar."
  );

  // SAP counts are incremented only for the urlbar source, since the internal
  // @search keyword was not used.
  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 1,
  });

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_searchMode_enter() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();

  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );

  info("Enter search mode using an alias and a query.");
  let p = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await searchInAwesomebar("mozalias query");
  EventUtils.synthesizeKey("KEY_Enter");
  await p;

  // Check if the scalars contain the expected values.
  const scalars = TelemetryTestUtils.getProcessScalars("parent", true, false);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    SCALAR_SEARCHMODE,
    "search_enter",
    1
  );
  Assert.equal(
    Object.keys(scalars[SCALAR_SEARCHMODE]).length,
    1,
    "This search must only increment one entry in the scalar."
  );

  BrowserTestUtils.removeTab(tab);
});

// Performs a search using the first result, a one-off button, and the Return
// (Enter) key.
add_task(async function test_oneOff_enter() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  clearSAPTelemetry();

  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "about:blank"
  );

  info("Perform a one-off search using the first engine.");
  let p = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await searchInAwesomebar("query");

  info("Pressing Alt+Down to take us to the first one-off engine.");
  let searchPromise = UrlbarTestUtils.promiseSearchComplete(window);
  EventUtils.synthesizeKey("KEY_ArrowDown", { altKey: true });
  let engine =
    UrlbarTestUtils.getOneOffSearchButtons(window).selectedButton.engine;
  EventUtils.synthesizeKey("KEY_Enter");
  await searchPromise;

  await UrlbarTestUtils.assertSearchMode(window, {
    engineName: engine.name,
    entry: "oneoff",
  });

  // Now that we're in search mode, execute the search.
  EventUtils.synthesizeKey("KEY_Enter");
  await p;

  // Check if the scalars contain the expected values.
  const scalars = TelemetryTestUtils.getProcessScalars("parent", true, false);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    SCALAR_SEARCHMODE,
    "search_enter",
    1
  );
  Assert.equal(
    Object.keys(scalars[SCALAR_SEARCHMODE]).length,
    1,
    "This search must only increment one entry in the scalar."
  );

  // SAP counts should be incremented, but only the urlbar-searchmode source
  // since aliases aren't counted separately in search mode.
  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar-searchmode",
    count: 1,
  });

  BrowserTestUtils.removeTab(tab);
});

// Clicks the first suggestion offered by the test search engine.
add_task(async function test_suggestion_click() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  await UrlbarTestUtils.formHistory.clear();
  clearSAPTelemetry();

  await withNewSearchEngine(async function (engine) {
    let tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "about:blank"
    );

    info("Type a query. Suggestions should be generated by the test engine.");
    let p = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    await searchInAwesomebar("query");
    info("Clicking the urlbar suggestion.");
    await clickURLBarSuggestion("queryfoo");
    await p;

    // Check if the scalars contain the expected values.
    const scalars = TelemetryTestUtils.getProcessScalars("parent", true, false);
    TelemetryTestUtils.assertKeyedScalar(
      scalars,
      SCALAR_URLBAR,
      "search_suggestion",
      1
    );
    Assert.equal(
      Object.keys(scalars[SCALAR_URLBAR]).length,
      1,
      "This search must only increment one entry in the scalar."
    );

    await SearchUITestUtils.assertSAPTelemetry({
      engineName: engine.name,
      source: "urlbar",
      count: 1,
    });

    BrowserTestUtils.removeTab(tab);
  });
});

// Clicks the first suggestion offered by the test search engine when in search
// mode.
add_task(async function test_searchmode_suggestion_click() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  clearSAPTelemetry();

  await withNewSearchEngine(async function (engine) {
    let tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "about:blank"
    );

    info("Type a query. Suggestions should be generated by the test engine.");
    await searchInAwesomebar("query");
    await UrlbarTestUtils.enterSearchMode(window, {
      engineName: engine.name,
    });
    info("Clicking the urlbar suggestion.");
    let p = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    await clickURLBarSuggestion("queryfoo");
    await p;

    // Check if the scalars contain the expected values.
    const scalars = TelemetryTestUtils.getProcessScalars("parent", true, false);
    TelemetryTestUtils.assertKeyedScalar(
      scalars,
      SCALAR_SEARCHMODE,
      "search_suggestion",
      1
    );
    Assert.equal(
      Object.keys(scalars[SCALAR_SEARCHMODE]).length,
      1,
      "This search must only increment one entry in the scalar."
    );

    await SearchUITestUtils.assertSAPTelemetry({
      engineName: engine.name,
      source: "urlbar-searchmode",
      count: 1,
    });

    BrowserTestUtils.removeTab(tab);
  });
});

// Clicks a form history result.
add_task(async function test_formHistory_click() {
  Services.telemetry.clearScalars();
  Services.telemetry.clearEvents();
  clearSAPTelemetry();
  await UrlbarTestUtils.formHistory.clear();
  await UrlbarTestUtils.formHistory.add(["foobar"]);

  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.maxHistoricalSearchSuggestions", 1]],
  });

  await withNewSearchEngine(async engine => {
    let tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "about:blank"
    );

    info("Type a query. There should be form history.");
    let p = BrowserTestUtils.browserLoaded(tab.linkedBrowser);
    await searchInAwesomebar("foo");
    info("Clicking the form history.");
    await clickURLBarSuggestion("foobar");
    await p;

    // Check if the scalars contain the expected values.
    const scalars = TelemetryTestUtils.getProcessScalars("parent", true, false);
    TelemetryTestUtils.assertKeyedScalar(
      scalars,
      SCALAR_URLBAR,
      "search_formhistory",
      1
    );
    Assert.equal(
      Object.keys(scalars[SCALAR_URLBAR]).length,
      1,
      "This search must only increment one entry in the scalar."
    );

    await SearchUITestUtils.assertSAPTelemetry({
      engineName: engine.name,
      source: "urlbar",
      count: 1,
    });

    BrowserTestUtils.removeTab(tab);
    await UrlbarTestUtils.formHistory.clear();
    await SpecialPowers.popPrefEnv();
  });
});

add_task(async function test_privateWindow() {
  // This test assumes the showSearchTerms feature is not enabled,
  // as multiple searches are made one after another, relying on
  // urlbar as the keyed scalar SAP, not urlbar_persisted.
  await SpecialPowers.pushPrefEnv({
    set: [["browser.urlbar.showSearchTerms.featureGate", false]],
  });

  // Override the search telemetry search provider info to
  // count in-content SAP telemetry for our test engine.
  SearchSERPTelemetry.overrideSearchTelemetryForTests([
    {
      telemetryId: "example",
      searchPageRegexp: "^https://example\\.com/",
      queryParamNames: ["q"],
    },
  ]);

  clearSAPTelemetry();

  // First, do a bunch of searches in a private window.
  let win = await BrowserTestUtils.openNewBrowserWindow({ private: true });

  info("Search in a private window and the pref does not exist");
  let p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 1,
  });
  let scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    1
  );

  info("Search again in a private window after setting the pref to true");
  Services.prefs.setBoolPref("browser.engagement.search_counts.pbm", true);
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("another query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  // SAP counts should not be incremented.
  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 1,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    1
  );

  info("Search again in a private window after setting the pref to false");
  Services.prefs.setBoolPref("browser.engagement.search_counts.pbm", false);
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("another query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 2,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    2
  );

  info("Search again in a private window after clearing the pref");
  Services.prefs.clearUserPref("browser.engagement.search_counts.pbm");
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("another query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 3,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    3
  );

  await BrowserTestUtils.closeWindow(win);

  // Now, do a bunch of searches in a non-private window.  Telemetry should
  // always be recorded regardless of the pref's value.
  win = await BrowserTestUtils.openNewBrowserWindow();

  info("Search in a non-private window and the pref does not exist");
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 4,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    4
  );

  info("Search again in a non-private window after setting the pref to true");
  Services.prefs.setBoolPref("browser.engagement.search_counts.pbm", true);
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("another query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 5,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    5
  );

  info("Search again in a non-private window after setting the pref to false");
  Services.prefs.setBoolPref("browser.engagement.search_counts.pbm", false);
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("another query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 6,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    6
  );

  info("Search again in a non-private window after clearing the pref");
  Services.prefs.clearUserPref("browser.engagement.search_counts.pbm");
  p = BrowserTestUtils.browserLoaded(win.gBrowser.selectedBrowser);
  await searchInAwesomebar("another query", win);
  EventUtils.synthesizeKey("KEY_Enter", undefined, win);
  await p;

  await SearchUITestUtils.assertSAPTelemetry({
    engineName: "MozSearch",
    source: "urlbar",
    count: 7,
  });
  scalars = TelemetryTestUtils.getProcessScalars("parent", true);
  TelemetryTestUtils.assertKeyedScalar(
    scalars,
    "browser.search.content.urlbar",
    "example:organic:none",
    7
  );

  await BrowserTestUtils.closeWindow(win);

  // Reset the search provider info.
  SearchSERPTelemetry.overrideSearchTelemetryForTests();
  await UrlbarTestUtils.formHistory.clear();
  await SpecialPowers.popPrefEnv();
});

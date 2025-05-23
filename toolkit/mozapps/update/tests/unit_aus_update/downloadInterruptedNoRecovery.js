/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

async function run_test() {
  setupTestCommon();
  debugDump("testing mar download with interrupted recovery count exceeded");
  Services.prefs.setBoolPref(PREF_APP_UPDATE_STAGING_ENABLED, false);
  start_httpserver();
  setUpdateURL(gURLData + gHTTPHandlerPath);
  Services.prefs.setIntPref(PREF_APP_UPDATE_SOCKET_MAXERRORS, 2);
  Services.prefs.setIntPref(PREF_APP_UPDATE_RETRYTIMEOUT, 0);

  await downloadUpdate({
    incrementalDownloadErrorType: 0,
    expectedCheckResult: { updateCount: 1 },
    expectedDownloadResult: Cr.NS_ERROR_NET_RESET,
  });

  stop_httpserver(doTestFinish);
}

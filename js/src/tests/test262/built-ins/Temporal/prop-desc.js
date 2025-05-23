// |reftest| shell-option(--enable-temporal) skip-if(!this.hasOwnProperty('Temporal')||!xulRuntime.shell) -- Temporal is not enabled unconditionally, requires shell-options
// Copyright (C) 2020 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal-objects
includes: [propertyHelper.js]
description: The "Temporal" property of the global object
features: [Temporal]
---*/

assert.sameValue(typeof Temporal, "object");
verifyProperty(this, "Temporal", {
  writable: true,
  enumerable: false,
  configurable: true,
});

reportCompare(0, 0);



  // from browser_newtab_ping test in the asrouter component
  let pingSubmitted = false;
  // TODO: do we want a "reason"?
  GleanPings.profiles.testBeforeNextSubmit(reason => {
    pingSubmitted = true;
    Assert.equal(reason, "profiles_whatever"); // TODO
    let record = Glean.profiles.closed.testGetValue("delete");
    Assert.equal(record.length, 1, "Should only have one delete closed event");
  });

  // Now create a shutdown interrupting listener, on shutdown requested cancel it.
  // Then, hit the delete button, or load the about:deleteprofile page,
  // somehow get ProfilesParent, and call ProfilesParent.handleEvent with a "DeleteProfile" custom event.
  await BrowserTestUtils.waitForCondition(
    () => pingSubmitted,
    "We expect the ping to have been submitted"
  );


Deps.autorun(function () {
  Meteor.subscribe("journey", Session.get("journeyId"));
});
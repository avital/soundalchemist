Meteor.publish("journey", function (id) {
  return Journeys.find(id);
});
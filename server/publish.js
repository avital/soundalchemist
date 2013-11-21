Meteor.publish("journey", function (id) {
  return Journeys.find(id, {fields: {"current.recommendations": 0, "recommendations": 0}});
});
// New methods for the browser plugin

Meteor.methods({
  vote2: function (journeyId, soundcloudUrl, weight) {
    var track = Meteor.call("loadTrack", {url: soundcloudUrl});
    var trackId = track.id;
    var journey = Journeys.findOne(journeyId);
    journey.current.recommendations =
      generateRecommendations(journeyId, trackId, buildRecommendationsCounter);
    turnRecommendations(journey, weight);
    updateFuture(journey);
    if (weight > 0)
      addHistory(journey, track, weight);
    Journeys.update(journeyId, journey);
  }
});

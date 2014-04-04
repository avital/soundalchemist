DECAY = 0.9;

Meteor.methods({
  skip: function (journeyId) {
    var journey;
    if (Meteor.isServer) {
      var transactionId = Random.id();
      Journeys.update(journeyId,
                      {$push: {skipping: transactionId}});

    journey = Journeys.findOne(journeyId);

      if (journey.skipping[0] !== transactionId) {
        console.log("someone else already leader of this skip");
        return;
      }
    } else {
      journey = Journeys.findOne(journeyId);
    }

    if (!journey.past)
      journey.past = [];

    journey.past.unshift(_.extend(
      {weight: journey.currentWeight},
      _.pick(journey.current, 'id', 'artwork_url', 'title', 'username')));
    journey.past = journey.past.splice(0, 10);
    journey.currentWeight = 0;
    journey.current = journey.future[0][0];
    delete journey.future["-3"];
    delete journey.future["-2"];
    delete journey.future["-1"];
    delete journey.future["1"];
    delete journey.future["2"];
    delete journey.future["3"];
    journey.future["0"] = journey.future["0"].splice(1);
    journey.recommendationsLoaded = 0.001;

    _.each(journey.recommendations, function (rec, id) {
      rec.rank = rec.rank * DECAY;
    });

    delete journey.skipping;
    Journeys.update(journeyId, journey);

    if (Meteor.isServer) {
      Meteor.defer(function () {
        Meteor.call("buildRecommendations", journeyId);
        var journey = Journeys.findOne(journeyId);
        updateFuture(journey);
        Journeys.update(journeyId, journey);
      });
    }
  },

  vote: function (journeyId, weight) {
    console.log("voting with weight", weight);
    var journey = Journeys.findOne(journeyId);
    var oldFuture = EJSON.clone(journey.future);
    journey.future = {};
    _.each(_.range(-6, 7), function (dir) {
      if (oldFuture[dir + weight])
        journey.future[dir] = oldFuture[dir + weight];
    });
    journey.currentWeight += weight;
    Journeys.update(journeyId, journey);
  },

  start: function (journeyId) {
    var journey = Journeys.findOne(journeyId);
    if (!journey.currentWeight)
      journey.currentWeight = 0;
    if (!journey.recommendations)
      journey.recommendations = {};
    journey.currentWeight = 1;

    _.each(journey.current.recommendations, function (rec, id) {
      if (!journey.recommendations[id])
        journey.recommendations[id] = _.extend(_.extend({}, rec), {rank: 0});
      journey.recommendations[id].rank += rec.rank;
    });

    updateFuture(journey);
    Journeys.update(journeyId, journey);
  }
});

// XXX move this from the repo to a settings.json file that is in a
// private repository
soundcloudClientId = "17a48e602c9a59c5a713b456b60fea68";

var Future = Npm.require("fibers/future");
var LIMIT = Meteor._get(Meteor.settings, 'public', 'prod') ? 120 : 5;

Meteor.methods({
  // opts: either {trackId: 172234} or {url: "http://soundcloud.com/foo/bar"}
  loadTrack: function (opts) {
    var data;
    try {
      if (opts.trackId) {
        data = HTTP.get("http://api.soundcloud.com/tracks/" + opts.trackId + ".json", {
          params: {
            client_id: soundcloudClientId
          }
        }).data;
      } else {
        data = HTTP.get("http://api.soundcloud.com/resolve.json", {
          params: {
            url: opts.url,
            client_id: soundcloudClientId
          }
        }).data;
      }
    } catch (e) {
      throw new Meteor.Error(400, "not a valid soundcloud url");
    }

    if (data.kind !== 'track')
      throw new Meteor.Error(400, "not a track");

    data = _.pick(data, 'id', 'artwork_url');
    return data;
  },

  buildRecommendations: function (journeyId) {
    var attempts = 0;
    var MAX_ATTEMPTS = 15;
    var error = undefined; // might be "503 - Service Unavailable"

    for (;;) {
      try {
        attempts++;
        console.log("tryBuildRecommendations, attempt " + attempts);
        Meteor.call("tryBuildRecommendations", journeyId);
        // success
        break;
      } catch (e) {
        if (attempts === MAX_ATTEMPTS) {
          error = e;
          break;
        } else {
          Meteor._sleepForMs(1000 * Math.pow(1.15, attempts));
        }
      }
    }

    if (error) {
      Journeys.update(journeyId,
                      {$set: {error: error.message},
                       $unset: {recommendationsLoaded: true}});
      throw error;
    } else {
      Journeys.update(journeyId,
                      {$unset: {error: true}});
    }
  },

  // build `journey.current.recommendations`. updates a progress bar,
  // so this is best run not at the top-level of a method.
  tryBuildRecommendations: function (journeyId) {
    var journey = Journeys.findOne(journeyId);
    var trackId = journey.current.id;

    var favoriters = HTTP.get("http://api.soundcloud.com/tracks/" + trackId + "/favoriters.json", {
      params: {
        limit: LIMIT,
        client_id: soundcloudClientId
      }
    }).data;

    var i = 0;
    var futures = _.map(favoriters, function (user) {
      var fut = new Future;

      var likes = HTTP.get("http://api.soundcloud.com/users/" + user.id + "/favorites.json", {
        params: {
          limit: LIMIT,
          client_id: soundcloudClientId
        }
      }, function (err, res) {
        i++;
        Journeys.update(journeyId, {$set: {recommendationsLoaded: i / favoriters.length}});
        fut.resolver()(null, res);
      });

      return fut;
    });

    Future.wait(futures);

    var recommendations = {};
    _.each(futures, function (future) {
      var likes = future.get().data;
      likes && _.each(likes, function (like) {
        if (like.kind === 'track') {
          recommendations[like.id] = recommendations[like.id] ||
            _.extend({rank: 0}, _.pick(like, 'id', 'artwork_url'));
          // XXX think about the math with tracks with many followers, vs <200.
          recommendations[like.id].rank += 1;
        }
      });
    });

    // a rank of 1 is almost surely just a fluke.
    _.each(recommendations, function (entry, id) {
      if (entry.rank === 1)
        delete recommendations[id];
    });

    delete recommendations[trackId];

    Journeys.update(journeyId, {$set: {"current.recommendations": recommendations}});
  }
});

Meteor.methods({
  startJourney: function (url) {
    var track = Meteor.call("loadTrack", {url: url});
    var journeyId = Journeys.insert({current: track, recommendationsLoaded: 0.001});

    // return immediately so users don't have to wait for music to
    // start, but prepare recommendations in the background
    Meteor.defer(function () {
      Meteor.call("buildRecommendations", journeyId);
      Meteor.call("vote", journeyId, +1);
    });

    return journeyId;
  }
});

updateFuture = function (journey) {
  if (!journey.future)
    journey.future = {};

  _.each([-2, -1, 0, 1, 2], function (direction) {
    var directedRecommendations = EJSON.clone(journey.recommendations);

    _.each(journey.current.recommendations, function (rec, id) {
      if (!directedRecommendations[id])
        directedRecommendations[id] = {rank: 0};
      directedRecommendations[id].rank += rec.rank * direction;
    });

    var pairs = pairsWithoutPlayed(_.pairs(directedRecommendations), journey);

    var trail = [];
    _.times(5, function () {
      var maxPair = _.max(pairs, function (p) { return p[1].rank; });
      pairs = _.without(pairs, maxPair);
      trail.push(maxPair[1]);
    });

    journey.future[direction] = trail;
  });
};

var pairsWithoutPlayed = function (pairs, journey) {
  return _.reject(pairs, function (p) {
    return _.any(journey.past, function (entry) {
      return entry.id === parseInt(p[0], 10);
    }) || parseInt(p[0], 10) === journey.current.id;
  });
};

soundcloudClientId = "17a48e602c9a59c5a713b456b60fea68";

var Future = Npm.require("fibers/future");

var LIMIT = 45;

Meteor.methods({
  // opts: either {trackId: 172234} or {url: "http://soundcloud.com/foo/bar"}
  loadTrack: function (opts) {
    var data;
    try {
      if (opts.trackId)
        data = HTTP.get("http://api.soundcloud.com/tracks/" + opts.trackId + ".json", {
          params: {
            client_id: soundcloudClientId
          }
        }).data;
      else {
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

    var favoriters = HTTP.get("http://api.soundcloud.com/tracks/" + data.id + "/favoriters.json", {
      params: {
        limit: LIMIT,
        client_id: soundcloudClientId
      }
    }).data;

    var futures = _.map(favoriters, function (user) {
      var fut = new Future;

      var likes = HTTP.get("http://api.soundcloud.com/users/" + user.id + "/favorites.json", {
        params: {
          limit: LIMIT,
          client_id: soundcloudClientId
        }
      }, fut.resolver());

      return fut;
    });

    Future.wait(futures);

    var recommendations = {};
    _.each(futures, function (future) {
      var likes = future.get().data;
      _.each(likes, function (like) {
        if (like.kind === 'track') {
          recommendations[like.id] = recommendations[like.id] ||
            _.extend({rank: 0}, _.pick(like, 'id', 'artwork_url', 'permalink_url', 'stream_url'));
          recommendations[like.id].rank += (LIMIT / likes.length) * (LIMIT / favoriters.length);
        }
      });
    });

    delete recommendations[data.id];

    data.recommendations = recommendations;
    Tracks.upsert(data.id, {$set: data});
    return data;
  }
});

var DECAY = 0.9;

Meteor.methods({
  startJourney: function (url) {
    var track = Meteor.call("loadTrack", {url: url});
    var journeyId = Journeys.insert({recommend: {}, current: track});
    Meteor.call("vote", journeyId, +1);
    Meteor.call("skip", journeyId);
    return journeyId;
  },

  vote: function (journeyId, weight) {
    var journey = Journeys.findOne(journeyId);
    if (!journey.currentWeight)
      journey.currentWeight = 0;
    journey.currentWeight += weight;

    _.each(journey.current.recommendations, function (rec, id) {
      if (!journey.recommend[id])
        journey.recommend[id] = _.extend(_.extend({}, rec), {rank: 0});
      journey.recommend[id].rank += rec.rank * weight;
    });

    updateFuture(journey);
    Journeys.update(journeyId, journey);
  },

  skip: function (journeyId) {
    var journey = Journeys.findOne(journeyId);
    if (!journey.past)
      journey.past = [];

    journey.past.unshift(_.extend({weight: journey.currentWeight}, journey.current));
    journey.past = journey.past.splice(0, 5);
    journey.currentWeight = 0;
    var currentId = journey.future[0][0].id;

    journey.current = Meteor.call("loadTrack", {trackId: currentId});
    updateFuture(journey);
    Journeys.update(journeyId, journey);
  }
});

var updateFuture = function (journey) {
  if (!journey.future)
    journey.future = {};

  _.each([-2, -1, 0, 1, 2], function (direction) {
    var directedRecommend = EJSON.clone(journey.recommend);

    _.each(journey.current.recommendations, function (rec, id) {
      if (!directedRecommend[id])
        directedRecommend[id] = {rank: 0};
      directedRecommend[id].rank += rec.rank * direction;
    });

    var pairs = pairsWithoutPlayed(_.pairs(directedRecommend), journey);

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

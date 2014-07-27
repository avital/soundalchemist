// XXX move this from the repo to a settings.json file that is in a
// private repository
soundcloudClientId = "17a48e602c9a59c5a713b456b60fea68";

var Future = Npm.require("fibers/future");
var LIMIT = Meteor._get(Meteor.settings, 'public', 'prod') ? 120 : 20;
var MAX_LIMIT = 200;

// used to break out of a call to buildRecommendation
buildRecommendationsCounter = 0;

var TRACK_FIELDS = ["id", "artwork_url", "title", "username", "permalink_url"];

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
        if (!/^http/.test(opts.url))
          opts.url = 'http://' + opts.url;
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

    data.username = data.user.username;
    data = _.pick(data, TRACK_FIELDS);
    return data;
  },

  buildRecommendations: function (journeyId) {
    // let subsequence methods run; they know how to stop this one if they want to
    this.unblock();

    var attempts = 0;
    var MAX_ATTEMPTS = 15;
    var error = undefined; // might be "503 - Service Unavailable"
    var ourBuildRecommmendationsCounter = ++buildRecommendationsCounter;
    console.log('buildRecommendations: ', buildRecommendationsCounter);

    for (;;) {
      if (ourBuildRecommmendationsCounter === buildRecommendationsCounter) {
	try {
	  attempts++;
	  console.log("tryBuildRecommendations, attempt " + attempts, 'counter:', ourBuildRecommmendationsCounter);

	  Meteor.call("tryBuildRecommendations",
		      journeyId,
		      ourBuildRecommmendationsCounter);
	  console.log('Successful: ', ourBuildRecommmendationsCounter);
	  break;
	} catch (e) {
	  console.log('Attempt failed with error: ', e.message, e.stack);
	  if (attempts === MAX_ATTEMPTS) {
	    error = e;
	    break;
	  } else {
	    Meteor._sleepForMs(1000 * Math.pow(1.15, attempts));
	  }
	} finally {
	  if(ourBuildRecommmendationsCounter !== buildRecommendationsCounter) {
	    console.log('We canceled counter ', ourBuildRecommmendationsCounter);
	    return;
	  }
	}
      }
    }

    if (error) {
      Journeys.update(journeyId,
                      {$set: {error: error.message},
                       $unset: {recommendationsLoaded: true}});
      // throw error;
    } else {
      Journeys.update(journeyId,
                      {$unset: {error: true}});
    }
  },

  // build `journey.current.recommendations`. updates a progress bar,
  // so this is best run not at the top-level of a method.
  tryBuildRecommendations: function (journeyId, ourBuildRecommmendationsCounter) {
    var journey = Journeys.findOne(journeyId);
    var trackId = journey.current.id;

    var recommendations = generateRecommendations(journeyId, trackId, ourBuildRecommmendationsCounter);
    Journeys.update(journeyId, {$set: {"current.recommendations": recommendations}});
    return true;
  }
});

generateRecommendations = function (journeyId, trackId, ourBuildRecommmendationsCounter) {
  var favoriters = HTTP.get("http://api.soundcloud.com/tracks/" + trackId + "/favoriters.json", {
    params: {
      limit: LIMIT,
      client_id: soundcloudClientId
    }
  }).data;

  var i = 0;
  var printedSkip = false;
  var futures = _.map(favoriters, function (user) {
    var fut = new Future;

    var likes = HTTP.get("http://api.soundcloud.com/users/" + user.id + "/favorites.json", {
      params: {
        limit: MAX_LIMIT,
        client_id: soundcloudClientId
      }
    }, function (err, res) {
      if (ourBuildRecommmendationsCounter === buildRecommendationsCounter) {
        i++;
        Journeys.update(journeyId, {$set: {recommendationsLoaded: i / favoriters.length}});
      } else {
        if (!printedSkip) {
          console.log("stopping buildRecommendations call");
          printedSkip = true;
        }
      }
      fut.resolver()(null, res);
    });

    return fut;
  });

  Future.wait(futures);

  if (ourBuildRecommmendationsCounter !== buildRecommendationsCounter) {
    // we're already building other recommendations
    return false;
  }

  // _noYieldsAllowed to be ensure the recommendation counter check is enough
  var recommendations = {};
  Meteor._noYieldsAllowed(function () {
    _.each(futures, function (future) {
      // not sure why this happens but this is what you get when you
      // ask the soundcloud api for the list of likes for
      // https://soundcloud.com/jingles-jacquelyn
      if (future.get() === null)
        return;

      var likes = future.get().data;
      likes && _.each(likes, function (like) {
        if (like.kind === 'track') {
          like.username = like.user.username;
          recommendations[like.id] = recommendations[like.id] ||
            _.extend({rank: 0}, _.pick(like, TRACK_FIELDS));
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
  });

  return recommendations;
};

Meteor.methods({
  startJourney: function (url) {
    var track = Meteor.call("loadTrack", {url: url});
    var journeyId = Journeys.insert({current: track, recommendationsLoaded: 0.001});

    // return immediately so users don't have to wait for music to
    // start, but prepare recommendations in the background
    Meteor.defer(function () {
      Meteor.call("buildRecommendations", journeyId);
      Meteor.call("start", journeyId);
    });

    return journeyId;
  }
});

updateFuture = function (journey) {
  if (!journey.future)
    journey.future = {};

  _.each([-3, -2, -1, 0, 1, 2, 3], function (direction) {
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

Meteor.methods({
  clone: function (journeyId) {
    var journey = Journeys.findOne(journeyId);
    delete journey._id;
    return Journeys.insert(journey);
  }
});

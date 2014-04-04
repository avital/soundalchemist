var Router = Backbone.Router.extend({
  routes: {
    "": "main",
    "journey/:journeyId": "journey"
  },

  main: function() {
    Session.set("journeyId", null);
    this.navigate("/");
  },

  journey: function(journeyId) {
    Session.set("journeyId", journeyId);
    this.navigate("/journey/" + journeyId);
  }
});
var router = new Router;
Meteor.startup(function () {
  Backbone.history.start({pushState: true});
});


var journey = function () {
  return Session.get("journey");
};

Deps.autorun(function () {
  Session.set("journey", Journeys.findOne(Session.get("journeyId")));
});

Deps.autorun(function () {
  Meteor.subscribe("journey", Session.get("journeyId"));
});

Template.main.helpers({
  started: function () {
    return Session.get("journeyId");
  },
  error: function () {
    return Session.get("error") || (journey() && journey().error);
  },
  loading: function () {
    return Session.get("loading");
  },
  pastArtworkUrl: function (i) {
    return journey() && Meteor._get(journey(), 'past', i, 'artwork_url');
  },
  future: function () {
    return journey() && Meteor._get(journey(), 'future', 0, 0);
  },
  futureArtworkUrl: function (side, i) {
    return journey() && Meteor._get(journey(), 'future', side, i, "artwork_url");
  },
  tooltip: function (side, i) {
    var info;
    if (side < 0) { // from past
      info = journey() && Meteor._get(journey(), 'past', -side - 1);
    } else { // from future
      info = journey() && Meteor._get(journey(), 'future', side, i);
    }
    return info && (info.title + " by " + info.username);
  },
  currentTrackId: function () {
    return Session.get("currentTrackId");
  },
  autoplay: function () {
    return Meteor.settings && Meteor._get(Meteor.settings, 'public', 'prod');
  },
  recommendations: function () {
    return journey() && journey().recommendations;
  },
  recommendationsLoading: function () {
    return journey() && journey().recommendationsLoaded && journey().recommendationsLoaded !== 1;
  },
  recommendationsLoadedPercent: function () {
    return journey() && Math.floor(journey().recommendationsLoaded * 100);
  },
  canVote: function () {
    return journey() && journey().past && Meteor._get(journey(), 'future', 1, 0);
  },
  futureEntry: function (side, i) {
    if (side === 0) {
      return journey() && Meteor._get(journey(), 'future', side, i);
    } else {
      return journey() && Meteor._get(journey(), 'future', side, i)
        && journey().recommendationsLoaded === 1;
    }
  },
  directions: function () {
    if (Template.main.canVote())
      return [-2, -1, 0, 1, 2];
    else
      return [0];
  },
  distance: [0, 1, 2, 3],
  top: function () {
    return this * 100; // XXX dup with @coversize in main.less
  },
  left: function(dir) {
    return dir * (this + 6) * 25 - (100/* @coversize*/ / 2);
  },
  waiting: function () {
    return Session.get("waiting");
  },
  past: function () {
    return journey() && journey().past;
  }
});

Template.main.events({
  'click .back': function () {
    router.main();
  },

  'keypress .entry': function (evt, tmpl) {
    if (evt.which === 13) { // enter
      var url = tmpl.find('.entry').value;
      if (! /^(https?:\/\/)?(www.)?soundcloud.com/.test(url)) {
        Session.set("error", "not a soundcloud url");
      } else {
        Session.set("error", null);
        start(url);
      }
    }
  },
  'click .skip': function () {
    Session.set("waiting", true);
    Meteor.call("skip", Session.get("journeyId"), function () {
      Session.set("waiting", false);
    });
  },
  'click .downvote': function () {
    Session.set("waiting", true);
    Meteor.call("vote", Session.get("journeyId"), -1, function () {
      Session.set("waiting", false);
    });
  },
  'click .upvote': function () {
    Session.set("waiting", true);
    Meteor.call("vote", Session.get("journeyId"), +1, function () {
      Session.set("waiting", false);
    });
  }
});

var start = function (url) {
  Session.set("loading", true);
  Meteor.call("startJourney", url, function (err, journeyId) {
    if (err) {
      Session.set("loading", false);
      Session.set("error", err.reason);
    } else {
      animateEntryToCurrent(function () {
        Session.set("loading", false);
        router.journey(journeyId);
        Deps.flush();
      });
    }
  });
};

Session.set("currentTrackId", null);

Deps.autorun(function () {
  if (journey() && journey().current.id) {
    Session.set("currentTrackId", journey().current.id);
  }
});

player = null;
Deps.autorun(function () {
  if (Session.get("currentTrackId")) {
    Meteor.defer(function () {
      player = SC.Widget("player");
      player.bind(SC.Widget.Events.READY, function () {
        console.log("ready");
        Meteor.setTimeout(function () { // XXX mysteriously, without
          // waiting the event gets
          // registered but doesn't fire.
          player.unbind(SC.Widget.Events.FINISH);
          player.bind(SC.Widget.Events.FINISH, function () {
            console.log("finish");
            Meteor.call("skip", Session.get("journeyId"));
          });
        }, 5000);
      });
    });
  }
});

var animateEntryToCurrent = function (transition) {
  $('.loading').animate({opacity: 0}, 600, function () {
    var startTop = $('.entry-wrapper').offset().top;
    var startLeft = $('.entry-wrapper').offset().left;
    var startHeight = $('.entry-wrapper').height();
    var startWidth = $('.entry-wrapper').width();
    var loadingClone = $('.entry-wrapper').clone().appendTo(document.body);

    transition();

    $('.current').css({opacity: 0});

    var endTop = $('.current').offset().top;
    var endLeft = $('.current').offset().left;
    var endHeight = $('.current').height();
    var endWidth = $('.current').width();
    $('.current').addClass('hidden');

    loadingClone.css({
      position: 'absolute',
      top: startTop,
      left: startLeft,
      height: startHeight,
      width: startWidth,
      'margin-left': '0'
    });

    loadingClone.animate({
      top: endTop,
      left: endLeft,
      height: endHeight,
      width: endWidth
    }, 600, function () {
      loadingClone.remove();
      $('.current').removeClass('hidden');
      $('.current').animate({opacity: 1}, 1000);
    });
  });
};


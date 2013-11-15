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
  return Journeys.findOne(Session.get("journeyId"));
};

Deps.autorun(function () {
  Meteor.subscribe("journey", Session.get("journeyId"));
});

Template.main.helpers({
  started: function () {
    return Session.get("journeyId");
  },
  error: function () {
    return Session.get("error");
  },
  loading: function () {
    return Session.get("loading");
  },
  pastArtworkUrl: function (i) {
    return journey() && Meteor._get(journey(), 'past', i, 'artwork_url');
  },
  futureArtworkUrl: function (side, i) {
    return journey() && Meteor._get(journey(), 'future', side, i, "artwork_url");
  },
  currentTrackId: function () {
    return journey() && Meteor._get(journey(), 'current', 'id');
  },
  directions: [-2, -1, 0, 1, 2],
  distance: [0, 1, 2, 3],
  top: function () {
    return this * 100; // XXX dup with @coversize in main.less
  }
});

Template.main.events({
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
    Meteor.call("skip", Session.get("journeyId"));
  },
  'click .downvote': function () {
    Meteor.call("vote", Session.get("journeyId"), -1);
  },
  'click .upvote': function () {
    Meteor.call("vote", Session.get("journeyId"), +1);
  }
});

var start = function (url) {
  Session.set("loading", true);
  Meteor.call("startJourney", url, function (err, journeyId) {
    if (err) {
      Session.set("loading", false);
      Session.set("error", err.reason);
    } else {
      animateEntryToPast0(function () {
        Session.set("loading", false);
        router.journey(journeyId);
        Deps.flush();

//        soundManager.setup(
      });
    }
  });
};

var animateEntryToPast0 = function (transition) {
  $('.loading').animate({opacity: 0}, 600, function () {
    var startTop = $('.entry-wrapper').offset().top;
    var startLeft = $('.entry-wrapper').offset().left;
    var startHeight = $('.entry-wrapper').height();
    var startWidth = $('.entry-wrapper').width();
    var loadingClone = $('.entry-wrapper').clone().appendTo(document.body);

    transition();

    $('.current').css({opacity: 0});

    var endTop = $('.past0').offset().top;
    var endLeft = $('.past0').offset().left;
    var endHeight = $('.past0').height();
    var endWidth = $('.past0').width();
    $('.past0').addClass('hidden');

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
      $('.past0').removeClass('hidden');
      $('.current').animate({opacity: 1}, 1000);
    });
  });
};
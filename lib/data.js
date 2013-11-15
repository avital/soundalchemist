Tracks = new Meteor.Collection("tracks");

// {
//   past: [up to 5 _.extend(track, {weight: ...}],
//   recommend: object {trackId -> _.extend(track, {rank: ...})},
//   current: track,
//   currentWeight: 0,
//   future: {
//     "-2": [5 tracks]
//     "-1": [5 tracks]
//     0: [5 tracks]
//     "1": [5 tracks]
//     "2": [5 tracks]
//   }
// }
Journeys = new Meteor.Collection("journeys");

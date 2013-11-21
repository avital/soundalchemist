// {
//   past: [up to 10 _.extend(track, {weight: ...}],
//   recommendations: object {trackId -> _.extend(track, {rank: ...})},
//   current: track {id, artwork_url, recommendationsLoadad: (between 0 and 1), recommendations},
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

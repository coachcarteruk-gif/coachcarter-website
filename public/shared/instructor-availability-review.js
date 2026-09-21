(function () {
  'use strict';

  // This acknowledgement only saves availability. It never creates, moves or
  // cancels a lesson, and is bound by the server to the reviewed conflict list.
  window.saveAvailabilityWithReview = async function (url, body) {
    var payload = Object.assign({}, body);
    for (;;) {
      var res = await ccAuth.fetchAuthed(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (res.status !== 409 || data.code !== 'AVAILABILITY_BOOKING_CONFLICTS') {
        return { res: res, data: data, cancelled: false };
      }
      var lessons = (data.conflicts || []).map(function (booking) {
        var date = new Date(booking.scheduled_date + 'T12:00:00Z').toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
        });
        return date + ', ' + booking.start_time.slice(0, 5) + '–' + booking.end_time.slice(0, 5) +
          ': ' + (booking.learner_name || 'Existing learner');
      }).join('\n');
      if (!window.confirm('These lessons will fall outside your availability:\n\n' + lessons +
          '\n\nThey will stay booked. You will need to arrange any changes separately. Save availability changes?')) {
        return { res: res, data: data, cancelled: true };
      }
      payload.availability_conflict_token = data.availability_conflict_token;
    }
  };
})();

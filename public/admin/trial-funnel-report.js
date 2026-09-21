(function () {
  'use strict';
  var report;
  var $ = function (id) { return document.getElementById(id); };
  if (!$('trial-report-form')) return;
  var today = new Date(); $('trial-report-to').value = today.toISOString().slice(0,10);
  today.setUTCDate(today.getUTCDate()-28); $('trial-report-from').value = today.toISOString().slice(0,10);
  $('trial-funnel-panel').addEventListener('toggle', async function () {
    if (!this.open || $('trial-report-instructor').options.length > 1) return;
    try {
      var r = await ccAdminAuth.fetchAuthed('/api/admin?action=all-instructors'); var d = await r.json();
      (d.instructors || []).forEach(function (i) { var o=document.createElement('option'); o.value=i.id;o.textContent=i.name;$('trial-report-instructor').appendChild(o); });
    } catch (e) { /* All instructors remains a usable report. */ }
  });
  var columns = ['segment','source','content_version','view','booking_count','consented_bookings','unknown_date_share','exceptions','count','matured','immature','unresolved_learners','denominator','net_conversions','gross_conversions','mean_paid_hours','median_paid_hours','early_commitments','paid_hours_booked_before_t0','cancelled_commitments','chargeable_hours','elapsed_hours_without_recorded_exception','paid_trial_extension_hours','first_booking_mean_days','test_day_bookings','conversion_interval_95'];
  function rows() {
    return report.groups.flatMap(function(g){return ['all_booked_original_end','final_session_continuation','elapsed_without_recorded_exception'].map(function(view){return Object.assign({},g,g[view],{view:view});});});
  }
  function display(value) { return value == null ? 'Unavailable' : Array.isArray(value) ? value.map(function(v){return (v*100).toFixed(1)+'%';}).join(' to ') : typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(3) : String(value); }
  $('trial-report-form').addEventListener('submit', async function(e){
    e.preventDefault(); $('trial-report-csv').disabled=true; $('trial-report-result').textContent='Loading…';
    try {
      var q=new URLSearchParams({action:'trial-funnel-report',from:$('trial-report-from').value,to:$('trial-report-to').value});
      if($('trial-report-instructor').value)q.set('instructor_id',$('trial-report-instructor').value);
      var r=await ccAdminAuth.fetchAuthed('/api/admin?'+q);var d=await r.json();if(!r.ok)throw new Error(d.error||'Report unavailable');report=d;
      var out=$('trial-report-result');out.replaceChildren();
      [d.scope,d.attendance,d.retention,d.purchase_scope,'Definition '+d.definition_version+'; as of '+d.as_of+'; timezone '+d.school_timezone,
        'Each range selects original booking dates; use a seven-day range for a booking-week stratum. Purchases below use this date range, not the 56-day continuation window.',
        'Existing offers and promotions may confound these outcomes. Record activation dates in the rollout log. No fabricated baseline or lift estimate.',
        'Data quality: '+JSON.stringify(d.data_quality),'Separate purchase counts: '+JSON.stringify(d.purchases)].forEach(function(text){var p=document.createElement('p');p.textContent=text;out.appendChild(p);});
      var wrapper=document.createElement('div');wrapper.style.overflowX='auto';var table=document.createElement('table');
      var head=document.createElement('tr');columns.forEach(function(c){var th=document.createElement('th');th.scope='col';th.textContent=c.replaceAll('_',' ');head.appendChild(th);});table.appendChild(head);
      rows().forEach(function(row){var tr=document.createElement('tr');columns.forEach(function(c){var td=document.createElement('td');td.textContent=display(row[c]);tr.appendChild(td);});table.appendChild(tr);});
      wrapper.appendChild(table);out.appendChild(wrapper);
      var note=document.createElement('p');note.textContent='Means and medians include zero among mature learners with resolved evidence. Immature and unresolved learners are separate. Small groups support no comparative conclusion. The browser funnel uses consented visitors; do not divide database bookings by that denominator.';out.appendChild(note);
      $('trial-report-csv').disabled=false;
    } catch(err){$('trial-report-result').textContent=err.message;}
  });
  $('trial-report-csv').addEventListener('click',function(){
    if(!report)return;
    var fields=['definition_version','as_of','school_timezone','from_inclusive','to_exclusive','scope','attendance','data_quality','purchases'].concat(columns);
    function cell(v){var s=display(v);if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
    var csv=[fields.map(cell).join(',')].concat((rows().length ? rows() : [{view:'no_cohorts'}]).map(function(row){return [report.definition_version,report.as_of,report.school_timezone,report.cohort_bounds.from,report.cohort_bounds.to,report.scope,report.attendance,JSON.stringify(report.data_quality),JSON.stringify(report.purchases)].concat(columns.map(function(c){return row[c];})).map(cell).join(',');})).join('\r\n');
    var url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));var a=document.createElement('a');a.href=url;a.download='trial-funnel-'+report.cohort_bounds.from+'.csv';a.click();URL.revokeObjectURL(url);
  });
}());

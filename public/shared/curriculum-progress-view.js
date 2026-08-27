(function(){
  'use strict';
  function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function date(value){if(!value)return '';var d=new Date(value);return isNaN(d.getTime())?'':d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function score(value){var r=(window.CC_COMPETENCY.CURRICULUM_RATINGS||[]).find(function(x){return x.score===Number(value)});return r?r.score+' · '+r.label:'Not assessed'}
  function historyFor(data,key){return (data.history||[]).filter(function(x){return x.item_key===key}).slice(0,6)}
  function render(data){
    var cc=window.CC_COMPETENCY, latest={};
    (data.ratings||[]).forEach(function(row){latest[row.item_key+'|'+row.assessor_role]=row});
    var completed={};(data.completions||[]).forEach(function(row){completed[row.item_key]=row});
    return '<div class="cp-card"><h2>Booked-lesson curriculum</h2><p>Learner confidence and instructor observation stay separate. Blank means Not assessed.</p>'+cc.CURRICULUM_SECTIONS.map(function(section){
      var items=cc.CURRICULUM_ITEMS.filter(function(item){return item.section===section.key});
      return '<details class="cp-progress-section"'+(section.type==='completion'?' open':'')+'><summary>'+esc(section.label)+'</summary>'+items.map(function(item){
        if(item.assessmentType==='completion'){
          var done=completed[item.key];return '<div class="cp-progress-row"><span class="cp-key">'+item.key+'</span><strong>'+esc(item.label)+'</strong><div class="'+(done?'cp-complete':'cp-not-assessed')+'">'+(done?'Done · '+date(done.completed_at)+(done.completed_by?' · '+esc(done.completed_by):''):'Not completed')+'</div></div>';
        }
        var learner=latest[item.key+'|learner'], instructor=latest[item.key+'|instructor'];
        var diff=learner&&instructor&&Number(learner.score)!==Number(instructor.score)?'<div class="cp-difference">Useful difference: learner '+learner.score+', instructor '+instructor.score+'</div>':'';
        var hist=historyFor(data,item.key);
        return '<div class="cp-progress-row"><span class="cp-key">'+item.key+'</span><strong>'+esc(item.label)+'</strong><div class="cp-score-grid"><div class="cp-score"><strong>Learner confidence</strong>'+score(learner&&learner.score)+'<small>'+date(learner&&learner.assessed_at)+'</small></div><div class="cp-score"><strong>Instructor observation</strong>'+score(instructor&&instructor.score)+'<small>'+date(instructor&&instructor.assessed_at)+'</small></div></div>'+diff+(hist.length?'<details class="cp-history"><summary>Lesson history and notes</summary>'+hist.map(function(h){return '<div>'+date(h.assessed_at)+' · '+esc(h.assessor_role)+' · '+score(h.score)+(h.note?' · '+esc(h.note):'')+(h.submission_note?' · '+esc(h.submission_note):'')+'</div>'}).join('')+'</details>':'')+'</div>';
      }).join('')+'</details>';
    }).join('')+'</div>';
  }
  async function mount(container, learnerId){
    if(!container)return;
    var url='/api/curriculum-progress?action=progress'+(learnerId?'&learner_id='+encodeURIComponent(learnerId):'');
    try{var res=await ccAuth.fetchAuthed(url);var data=await res.json();if(!res.ok)throw new Error(data.error||'Failed to load');if(data.enabled!==true){container.hidden=true;return}container.hidden=false;container.innerHTML=render(data)}catch(e){container.innerHTML='<div class="cp-card cp-error">Curriculum progress could not be loaded.</div>'}
  }
  window.CCCurriculumProgress={mount:mount,render:render};
})();

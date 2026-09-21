(function () {
  'use strict';
  var root, flow, config, scope, onBooking, step=0, ready=false, raw=null, busy=false;
  var data={practical_booked:null,theory_booked:null,budget:''}, contact={}, selected=new Set(), key;
  var $=function(id){return document.getElementById(id);};
  var esc=function(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
  function event(name){if(window.ccTrialFunnel)ccTrialFunnel.send(name);}
  function price(pence){return '£'+(pence/100).toLocaleString('en-GB',{maximumFractionDigits:2});}
  function choice(name,value,label,checked){return '<label class="question-choice"><input type="radio" name="'+name+'" value="'+value+'" '+(checked?'checked':'')+' required><span>'+esc(label)+'</span></label>';}
  function field(id,label,type,value){return '<label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" type="'+type+'" value="'+esc(value||'')+'" '+(type==='date'?'min="'+config.local_date+'"':'')+' required>';}
  function focusHeading(){var h=root.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  function show(direction){
    raw=null;root.hidden=false;flow.hidden=true;
    var c=config.trial_questionnaire, content='';
    if(step===0) content='<h2>Do you have a practical driving test booked?</h2>'+choice('practical','yes','Yes',data.practical_booked===true)+choice('practical','no','No',data.practical_booked===false);
    if(step===1 && data.practical_booked) {
      content='<h2>Your practical driving test</h2>'+field('qPracticalDate','Practical test date','date',data.practical_date)+field('qPracticalTime','Practical test time','time',data.practical_time)+'<label for="qCentre">Test centre</label><select id="qCentre" required><option value="">Choose a centre</option>'+c.supported_centres.concat(['Other']).map(function(s){return '<option '+(data.centre_choice===s?'selected':'')+'>'+esc(s)+'</option>';}).join('')+'</select><div id="qOther" '+(data.centre_choice==='Other'?'':'hidden')+'>'+field('qOtherCentre','Which test centre?','text',data.other_centre)+'</div>';
    }
    if(step===1 && !data.practical_booked) content='<h2>Have you booked your theory test?</h2>'+choice('theory','yes','Yes',data.theory_booked===true)+choice('theory','no','No',data.theory_booked===false)+'<div id="qTheory" '+(data.theory_booked?'':'hidden')+'>'+field('qTheoryDate','Theory test date','date',data.theory_date)+field('qTheoryTime','Theory test time','time',data.theory_time)+'</div>';
    if(step===2) content='<h2>Future lessons with us can cost up to '+price(c.maximum_hourly_pence)+'/hr. Does this match the budget you have available?</h2>'+[
      ['saved','Yes, I have money set aside for lessons.'],['payg','Yes, only on a pay-as-you-go basis.'],['lower','No, I would need lessons to be around '+price(c.lower_budget_pence)+'/hr.'],['lowest','No, I would need lessons to be around '+price(c.lowest_budget_pence)+'/hr.']
    ].map(function(x){return choice('budget',x[0],x[1],data.budget===x[0]);}).join('')+'<p class="field-help">This is a budget preference, not an offered rate or discount.</p>';
    root.innerHTML='<p class="question-progress" role="status">Question '+(step+1)+' of 3</p><form id="questionForm" novalidate><div id="questionSlide" class="question-slide-'+(direction||'forward')+'">'+content+'</div><p id="qError" class="question-error" role="alert"></p><div class="question-actions">'+(step?'<button type="button" class="question-back" id="qBack">Back</button>':'')+'<button class="question-next" type="submit">Continue</button></div></form>';
    syncRequired();
    root.querySelector('form').addEventListener('change',function(e){
      if(e.target.id==='qCentre') { $('qOther').hidden=e.target.value!=='Other';if(e.target.value!=='Other')$('qOtherCentre').value=''; }
      if(e.target.name==='theory') { $('qTheory').hidden=e.target.value!=='yes';if(e.target.value!=='yes'){$('qTheoryDate').value='';$('qTheoryTime').value='';} }
      syncRequired();
    });
    if($('qBack'))$('qBack').onclick=function(){save();step--;show('back');focusHeading();};
    $('questionForm').onsubmit=function(e){e.preventDefault();if(!this.reportValidity())return;save();
      if(step<2){event('trial_questionnaire_step_'+(step+1)+'_completed');step++;show();focusHeading();}
      else {event('trial_questionnaire_step_3_completed');route();}
    };
  }
  function syncRequired(){root.querySelectorAll('#qOther input,#qTheory input').forEach(function(i){i.disabled=i.parentElement.hidden;});}
  function save(){
    var checked;
    if(step===0){checked=root.querySelector('[name=practical]:checked');if(checked){var next=checked.value==='yes';if(next!==data.practical_booked){data.practical_date=data.practical_time=data.centre_choice=data.other_centre='';data.theory_date=data.theory_time='';data.theory_booked=null;}data.practical_booked=next;}}
    if(step===1 && data.practical_booked){data.practical_date=$('qPracticalDate').value;data.practical_time=$('qPracticalTime').value;data.centre_choice=$('qCentre').value;data.other_centre=data.centre_choice==='Other'?$('qOtherCentre').value:'';}
    if(step===1 && !data.practical_booked){checked=root.querySelector('[name=theory]:checked');data.theory_booked=checked?checked.value==='yes':null;data.theory_date=data.theory_booked?$('qTheoryDate').value:'';data.theory_time=data.theory_booked?$('qTheoryTime').value:'';}
    if(step===2){checked=root.querySelector('[name=budget]:checked');data.budget=checked?checked.value:'';}
  }
  function route(){
    raw=Object.assign({},data);
    if(data.practical_booked && config.trial_questionnaire.supported_centres.includes(data.centre_choice) && data.budget!=='lowest'){
      root.hidden=true;flow.hidden=false;event('trial_questionnaire_booking_route');
      [['name','guest_name'],['email','guest_email'],['phone','guest_phone']].forEach(function(pair){if(contact[pair[0]])$(pair[1]).value=contact[pair[0]];});
      if(!ready){ready=true;onBooking(config);}
      if(!$('trialRouteTools')) { var tools=document.createElement('div');tools.id='trialRouteTools';tools.className='trial-route-tools';tools.innerHTML='<button type="button" id="editTrialAnswers">Back to your answers</button><button type="button" id="requestTrialInstead">No suitable time? Request a trial</button>';flow.prepend(tools);
        $('editTrialAnswers').onclick=function(){step=2;show('back');focusHeading();};$('requestTrialInstead').onclick=function(){requestForm();}; }
      $('trialTestDetails').hidden=$('trialTestDetails').disabled=true;
      flow.querySelector('.required-note').textContent='Your contact details are required. Course preferences are optional.';
      var heading=flow.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});
    }else{event('trial_questionnaire_request_route');requestForm();}
  }
  function requestForm(){
    root.hidden=false;flow.hidden=true;
    [['name','guest_name'],['email','guest_email'],['phone','guest_phone']].forEach(function(pair){if($(pair[1]).value)contact[pair[0]]=$(pair[1]).value;});
    var days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],periods=['Morning','Afternoon','Evening'];
    root.innerHTML='<h2>Request your free trial</h2><p>Share your general weekly availability. Our team will contact you to arrange a trial. This does not reserve a live slot or confirm an appointment.</p><form id="trialRequestForm">'+field('requestName','Name','text',contact.name)+field('requestPhone','Phone number','tel',contact.phone)+field('requestEmail','Email','email',contact.email)+field('requestPostcode','Postcode area (for example RG1)','text',contact.postcode)+'<label class="request-honeypot" aria-hidden="true">Website<input id="requestWebsite" tabindex="-1" autocomplete="off"></label><fieldset class="course-preferences"><legend>Preferred weekly availability</legend><p class="field-help">Choose as many periods as you like.</p><div class="request-week"><span></span>'+periods.map(function(p){return '<span class="period-title">'+p+'</span>';}).join('')+days.map(function(d,i){return '<span>'+d.slice(0,3)+'</span>'+periods.map(function(p){var value=(i+1)+':'+p.toLowerCase();return '<button type="button" class="availability-choice" data-period="'+value+'" aria-label="'+d+' '+p+'" aria-pressed="'+selected.has(value)+'">'+(selected.has(value)?'✓':'')+'</button>';}).join('');}).join('')+'</div></fieldset><p class="field-help">Read our <a href="/privacy.html">privacy notice</a>. This request does not sign you up for marketing.</p><p id="requestError" class="question-error" role="alert"></p><div class="question-actions"><button type="button" id="requestBack" class="question-back">Back</button><button type="submit" class="question-next" id="requestSubmit">Send trial request</button></div></form>';
    $('requestName').autocomplete='name';$('requestPhone').autocomplete='tel';$('requestEmail').autocomplete='email';$('requestPostcode').maxLength=8;
    root.querySelectorAll('[data-period]').forEach(function(button){button.onclick=function(){var v=this.dataset.period;if(selected.has(v))selected.delete(v);else selected.add(v);this.setAttribute('aria-pressed',String(selected.has(v)));this.textContent=selected.has(v)?'✓':'';};});
    function remember(){contact={name:$('requestName').value,phone:$('requestPhone').value,email:$('requestEmail').value,postcode:$('requestPostcode').value};}
    $('requestBack').onclick=function(){remember();step=2;show('back');focusHeading();};
    $('trialRequestForm').onsubmit=async function(e){e.preventDefault();if(busy)return;remember();if(!selected.size){$('requestError').textContent='Choose at least one preferred day and time period.';return;}
      key=key||crypto.randomUUID();busy=true;$('requestSubmit').disabled=true;$('requestBack').disabled=true;$('requestError').textContent='';
      try{var response=await fetch('/api/trial-requests?action=submit'+scope,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:contact.name,phone:contact.phone,email:contact.email,postcode_area:contact.postcode,availability:Array.from(selected),questionnaire:raw,submission_key:key,website:$('requestWebsite').value,funnel_context:window.ccTrialFunnel?ccTrialFunnel.context():{}})});var result=await response.json();if(!response.ok)throw new Error(result.message||'Unable to send your request.');
        event('trial_request_submitted');root.innerHTML='<h2>Thanks — your trial request is received.</h2><p>Our team will contact you to arrange a trial using the details you shared.</p><p>No appointment has been booked and no slot has been reserved.</p>';focusHeading();raw=null;data={};contact={};selected.clear();
      }catch(err){$('requestError').textContent=err.message;$('requestSubmit').disabled=false;$('requestBack').disabled=false;}finally{busy=false;}
    };focusHeading();
  }
  async function init(s,callback){
    scope=s;onBooking=callback;root=$('trialQuestionnaire');flow=$('trialBookingFlow');
    try {var response=await fetch('/api/schools?action=public-config'+scope);if(!response.ok)throw new Error('config');config=await response.json();
      if(!config.trial_questionnaire){root.hidden=true;flow.hidden=false;callback(config);return;}
      window.ccTrialQuestionnaireEnabled=true;
      document.querySelector('.hero p').textContent='Answer three short questions to find your next step. No card needed.';
      show();event('trial_questionnaire_started');
    }catch(e){root.textContent='We could not load your trial options. ';var retry=document.createElement('button');retry.textContent='Try again';retry.onclick=function(){init(s,callback);};root.appendChild(retry);}
  }
  window.ccTrialQuestionnaire={init:init,answers:function(){return raw;}};
}());

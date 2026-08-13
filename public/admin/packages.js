(function () {
  'use strict';
  var listEl = document.getElementById('product-admin-list');
  var statusEl = document.getElementById('admin-status');
  var featureEl = document.getElementById('feature-enabled');

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function pounds(pence) { return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(pence||0)/100); }
  function localDateTime(value) { var d=new Date(value); if(Number.isNaN(d.getTime()))return''; var off=d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,16); }
  function show(message,error){ statusEl.textContent=message||''; statusEl.className=error?'error':''; }
  function authState(){var a=window.ccAdminAuth&&window.ccAdminAuth.getAuth();if(a)return a;try{var i=JSON.parse(localStorage.getItem('cc_instructor')||'null');return i&&((i.instructor||i).isAdmin===true)?i:null;}catch(e){return null;}}
  function api(url,options){return window.ccAdminAuth.fetchAuthed(url,options).then(async function(res){var data=await res.json();if(!res.ok)throw new Error(data.message||'Request failed');return data;});}

  function render(data){
    featureEl.checked=data.feature_enabled===true;
    listEl.innerHTML=data.products.map(function(product){
      var now=Date.now();
      var current=product.versions.find(function(v){return new Date(v.effective_from).getTime()<=now;})||product.versions[product.versions.length-1];
      var name=current&&current.content&&current.content.name||product.slug;
      var history=product.versions.map(function(v){var future=new Date(v.effective_from).getTime()>now;return '<li><strong>v'+esc(v.version_number)+'</strong><strong>'+esc(pounds(v.price_pence))+'</strong><span>'+esc(v.customer_terms_version)+'</span><span class="badge'+(future?' future':'')+'">'+(future?'Scheduled':'Effective')+' '+esc(new Date(v.effective_from).toLocaleString('en-GB'))+'</span></li>';}).join('');
      return '<article class="admin-product" data-product-id="'+esc(product.id)+'">'+
        '<div class="product-summary"><div><h3>'+esc(name)+'</h3><p class="product-slug">'+esc(product.slug)+' · '+esc(product.product_type)+'</p></div><div class="current-version"><div><strong>'+esc(current?pounds(current.price_pence):'No version')+'</strong><span>current effective price</span></div><div><strong>v'+esc(current?current.version_number:'—')+'</strong><span>immutable version</span></div></div></div>'+
        '<div class="product-controls"><label class="check-field"><input class="visible-input" type="checkbox"'+(product.visible?' checked':'')+'> Visible</label><label class="check-field"><input class="active-input" type="checkbox"'+(product.active?' checked':'')+'> Active</label><div class="field"><label>Display order</label><input class="sort-input" type="number" min="0" max="10000" value="'+esc(product.sort_order)+'"></div><button class="save-product" type="button">Save product</button></div>'+
        '<details class="version-panel"><summary>Schedule a price/version change</summary><form class="version-form"><div class="field"><label>New price (GBP)</label><input name="price" type="number" min="0.01" max="9999.99" step="0.01" value="'+esc(current?Number(current.price_pence/100).toFixed(2):'')+'" required></div><div class="field"><label>Effective from</label><input name="effective" type="datetime-local" value="'+esc(localDateTime(new Date(Date.now()+86400000)))+'" required></div><div class="field"><label>Customer terms version</label><input name="terms" maxlength="120" value="'+esc(current?current.customer_terms_version:'')+'" required></div><button type="submit">Create future version</button></form><ul class="version-history">'+history+'</ul></details>'+
      '</article>';
    }).join('');
  }

  async function load(){try{show('Loading catalogue…');var data=await api('/api/packages?action=admin-list');render(data);show(data.products.length+' products loaded for '+data.school.name+'.');}catch(e){show(e.message,true);}}

  document.getElementById('save-feature').addEventListener('click',async function(){var button=this;try{button.disabled=true;await api('/api/packages?action=set-feature',{method:'POST',body:JSON.stringify({enabled:featureEl.checked})});show('School feature gate saved and audit logged.');}catch(e){show(e.message,true);featureEl.checked=!featureEl.checked;}finally{button.disabled=false;}});
  listEl.addEventListener('click',async function(event){var button=event.target.closest('.save-product');if(!button)return;var card=button.closest('.admin-product');try{button.disabled=true;await api('/api/packages?action=update-product',{method:'POST',body:JSON.stringify({product_id:Number(card.dataset.productId),visible:card.querySelector('.visible-input').checked,active:card.querySelector('.active-input').checked,sort_order:Number(card.querySelector('.sort-input').value)})});show('Product display settings saved and audit logged.');await load();}catch(e){show(e.message,true);}finally{button.disabled=false;}});
  listEl.addEventListener('submit',async function(event){if(!event.target.classList.contains('version-form'))return;event.preventDefault();var form=event.target;var card=form.closest('.admin-product');var button=form.querySelector('button[type="submit"]');try{button.disabled=true;var effective=new Date(form.elements.effective.value);await api('/api/packages?action=create-version',{method:'POST',body:JSON.stringify({product_id:Number(card.dataset.productId),price_pence:Math.round(Number(form.elements.price.value)*100),effective_from:effective.toISOString(),customer_terms_version:form.elements.terms.value})});show('Immutable future version created and audit logged.');await load();}catch(e){show(e.message,true);}finally{button.disabled=false;}});

  if(!authState()){window.location.href='/admin/login.html';return;}
  load();
})();

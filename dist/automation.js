const actionLabels={irrigation:'Run irrigation',open_drone_house:'Open drone house',launch_drone:'Launch drone'};
const signalLabels={low_moisture:'Low soil moisture',high_temperature:'High temperature',camera_motion:'Camera motion',camera_intrusion:'Camera intrusion'};
async function automationScreen(){
  const [rules,events]=await Promise.all([api('/automation/rules'),api('/automation/events')]);
  const gateways=data.devices.filter(d=>d.kind==='gateway');
  $('#content').innerHTML=`<div class="banner">Farm actions are delivered to a provisioned gateway. Approvals and gateway acknowledgments are tracked here. The gateway must implement physical safety checks; CAFP does not operate equipment by itself.</div>
    <div class="team-layout">
    ${canEdit()?`<section class="form-card card"><h2>Request a farm action</h2>
      <form id="eventForm" class="form-grid">
        <label class="field">Plot<select name="plot" required><option value="">Choose plot</option>${data.plots.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field">Gateway<select name="gateway" required><option value="">Choose assigned gateway</option>${gateways.map(g=>`<option value="${g.id}" data-plot="${g.plot_id}">${esc(g.label)} · ${esc(plot(g.plot_id))}</option>`).join('')}</select></label>
        <label class="field">Action<select name="action">${Object.entries(actionLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field">Irrigation seconds (1–300)<input name="durationSeconds" type="number" min="0" max="300" value="60"></label>
        <label class="field span2">Reason<input name="detail" maxlength="500"></label>
        <button class="primary span2">Request action</button></form>
      <p class="muted">Manual actions await owner/admin approval. A manually requested drone launch needs a different owner/admin to approve it.</p></section>`:''}
    ${admin()?`<section class="form-card card"><h2>Create event rule</h2>
      <form id="ruleForm" class="form-grid">
        <label class="field span2">Rule name<input name="name" required maxlength="160"></label>
        <label class="field">Plot<select name="plot" required><option value="">Choose plot</option>${data.plots.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field">Gateway<select name="gateway" required><option value="">Choose assigned gateway</option>${gateways.map(g=>`<option value="${g.id}" data-plot="${g.plot_id}">${esc(g.label)} · ${esc(plot(g.plot_id))}</option>`).join('')}</select></label>
        <label class="field">Input<select name="signal">${Object.entries(signalLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field">Trigger threshold<input name="threshold" type="number" step="0.1" value="20"><small>Used for moisture below or temperature above this value.</small></label>
        <label class="field">Action<select name="action">${Object.entries(actionLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="field">Irrigation seconds (1–300)<input name="durationSeconds" type="number" min="0" max="300" value="60"></label>
        <label class="field">Cooldown minutes<input name="cooldownMinutes" type="number" min="1" max="1440" value="15"></label>
        <label class="field inline-check"><input name="autoDispatch" type="checkbox"> Automatically queue irrigation</label>
        <button class="primary span2">Create rule</button></form>
      <p class="muted">Other actions always require approval. A gateway must be assigned to the same plot.</p></section>`:''}
    </div>
    <section class="panel card" style="margin-top:18px"><div class="section-head"><h2>Rules</h2><span class="tag">${rules.length}</span></div>
      ${rules.map(r=>`<div class="plot-row"><div class="row-main"><strong>${esc(r.name)} · ${esc(actionLabels[r.action])}</strong>
        <small>${esc(plot(r.plot_id))} · ${esc(signalLabels[r.signal])}${r.threshold!==null?' '+esc(r.threshold):''} · ${r.auto_dispatch?'Auto queue':'Approval'} · ${r.enabled?'Enabled':'Paused'}</small></div>
        ${admin()?`<button class="secondary" data-toggle-rule="${r.id}">${r.enabled?'Pause':'Enable'}</button><button class="danger" data-delete-rule="${r.id}">Delete</button>`:''}</div>`).join('')||'<div class="empty">No automation rules yet.</div>'}</section>
    <section class="panel card" style="margin-top:18px"><div class="section-head"><h2>Event history</h2><button class="secondary" id="refreshEvents">Refresh</button></div>
      ${events.map(e=>`<div class="plot-row"><div class="row-main"><strong>${esc(actionLabels[e.action])} · ${esc(plot(e.plot_id))}</strong>
        <small>${fmt(e.created_at)} · ${esc(e.source)} · ${esc(e.signal)} · ${esc(e.detail)}${e.result_note?' · '+esc(e.result_note):''}</small></div>
        <span class="tag ${e.status==='failed'?'critical':e.status==='pending_approval'?'warn':''}">${esc(e.status.replaceAll('_',' '))}</span>
        ${admin()&&e.status==='pending_approval'?`<button class="primary" data-approve-event="${e.id}">Approve</button>`:''}
        ${admin()&&['pending_approval','queued'].includes(e.status)?`<button class="danger" data-cancel-event="${e.id}">Cancel</button>`:''}</div>`).join('')||'<div class="empty">No farm events yet.</div>'}</section>`;
  $('#refreshEvents').onclick=()=>run(automationScreen);
  for(const formId of ['#eventForm','#ruleForm']){
    const form=$(formId);if(!form)continue;
    const update=()=>{const current=form.elements.plot.value;for(const option of form.elements.gateway.options)option.hidden=Boolean(option.value&&option.dataset.plot!==current);
      if(form.elements.gateway.selectedOptions[0]?.hidden)form.elements.gateway.value='';};
    form.elements.plot.onchange=update;update();
  }
  if($('#eventForm'))$('#eventForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    const v=Object.fromEntries(new FormData(e.target));
    if(v.action!=='irrigation')v.durationSeconds=0;
    await api('/automation/events','POST',v);await automationScreen();toast('Action requested for approval');
  })};
  if($('#ruleForm'))$('#ruleForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    const v=Object.fromEntries(new FormData(e.target));v.autoDispatch=e.target.elements.autoDispatch.checked;
    if(v.action!=='irrigation')v.durationSeconds=0;
    await api('/automation/rules','POST',v);await automationScreen();toast('Rule created');
  })};
  document.querySelectorAll('[data-toggle-rule]').forEach(b=>b.onclick=()=>run(async()=>{
    const rule=rules.find(r=>r.id===b.dataset.toggleRule);
    await api('/automation/rules/'+rule.id,'PUT',{enabled:!rule.enabled});await automationScreen();
  }));
  document.querySelectorAll('[data-delete-rule]').forEach(b=>b.onclick=()=>run(async()=>{
    if(!confirm('Delete this rule? Existing events remain in history.'))return;
    await api('/automation/rules/'+b.dataset.deleteRule,'DELETE');await automationScreen();
  }));
  document.querySelectorAll('[data-approve-event]').forEach(b=>b.onclick=()=>run(async()=>{
    if(!confirm('Approve this action for the gateway? Confirm the area and equipment are safe.'))return;
    await api('/automation/events/'+b.dataset.approveEvent+'/approve','POST');await automationScreen();toast('Action queued');
  }));
  document.querySelectorAll('[data-cancel-event]').forEach(b=>b.onclick=()=>run(async()=>{
    await api('/automation/events/'+b.dataset.cancelEvent+'/cancel','POST');await automationScreen();toast('Action cancelled');
  }));
}

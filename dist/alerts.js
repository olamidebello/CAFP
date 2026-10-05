let alertStatus = 'active', alertSeverity = 'all', alertPlot = '', alertSearch = '';
let visibleAlerts = [];

function alertCsv() {
  const fields = ['id','plot_name','metric','status','severity','current_value','threshold','occurrences','opened_at','last_seen_at','acknowledged_at','resolved_at','resolution_note'];
  download('cafp-alerts.csv', [fields.join(','),...visibleAlerts.map(a=>fields.map(k=>csvCell(a[k])).join(','))].join('\r\n'), 'text/csv');
}

async function alerts() {
  const params = new URLSearchParams({status:alertStatus,severity:alertSeverity,limit:'500'});
  if (alertPlot) params.set('plot',alertPlot);
  const fetched = await api('/alerts?' + params);
  visibleAlerts = fetched.filter(a => !alertSearch ||
    [a.plot_name,a.metric,a.severity,a.status,a.resolution_note].some(value =>
      String(value || '').toLowerCase().includes(alertSearch.toLowerCase())));
  const active = fetched.filter(a=>a.status!=='resolved');
  $('#content').innerHTML = `<section class="panel card">
    <div class="section-head"><div><h2>Alert center</h2><p class="muted">Readings create alerts when they cross farm thresholds. A normal reading resolves an active alert.</p></div>
      <span class="tag warn">${active.length} active in current results</span></div>
    <div class="alert-toolbar">
      <label class="field">Status<select id="alertStatus"><option value="active">Active</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
      <label class="field">Severity<select id="alertSeverity"><option value="all">All</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
      <label class="field">Plot<select id="alertPlot"><option value="">All plots</option>${data.plots.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">Search<input id="alertSearch" type="search" value="${esc(alertSearch)}" placeholder="Plot, status, metric"></label>
    </div>
    <div class="form-actions alert-actions">
      <button class="secondary" id="refreshAlerts">Refresh</button>
      <button class="secondary" id="exportAlerts">Export shown CSV</button>
      ${canEdit()?'<button class="ghost" id="ackSelected">Acknowledge selected</button><button class="ghost" id="resolveSelected">Resolve selected</button>':''}
      ${admin()?'<button class="ghost" id="editThresholds">Edit thresholds</button>':''}
    </div>
    <div class="alert-list">${visibleAlerts.map(a=>`<article class="alert-item">
      ${canEdit()&&a.status!=='resolved'?`<label class="alert-select"><input type="checkbox" class="alert-check" value="${a.id}" aria-label="Select alert for ${esc(a.plot_name)}"></label>`:''}
      <div class="row-main"><strong>${esc(a.metric==='moisture'?'Low soil moisture':'High temperature')} · ${esc(a.plot_name)}</strong>
        <small>${esc(a.severity)} · ${esc(a.status)} · ${esc(a.current_value)} ${a.metric==='moisture'?'%':'°C'} (threshold ${esc(a.threshold)}${a.metric==='moisture'?'%':'°C'})</small>
        <small>Last seen ${fmt(a.last_seen_at)} · ${esc(a.occurrences)} occurrence(s)${a.resolution_note?' · '+esc(a.resolution_note):''}</small></div>
      <div class="form-actions">
        ${canEdit()&&a.status==='open'?`<button class="secondary" data-alert-action="acknowledge" data-alert-id="${a.id}">Acknowledge</button>`:''}
        ${canEdit()&&a.status!=='resolved'?`<button class="ghost" data-alert-action="resolve" data-alert-id="${a.id}">Resolve</button>`:''}
        ${canEdit()&&a.status==='resolved'?`<button class="ghost" data-alert-action="reopen" data-alert-id="${a.id}">Reopen</button>`:''}
      </div></article>`).join('') || '<div class="empty">No alerts match these filters.</div>'}</div>
    <p class="muted">Showing ${visibleAlerts.length} alert(s), up to 500 per query. Acknowledgment keeps an alert active; resolution closes it.</p>
  </section>`;
  $('#alertStatus').value=alertStatus;
  $('#alertSeverity').value=alertSeverity;
  $('#alertPlot').value=alertPlot;
  $('#alertStatus').onchange=e=>{alertStatus=e.target.value;run(alerts)};
  $('#alertSeverity').onchange=e=>{alertSeverity=e.target.value;run(alerts)};
  $('#alertPlot').onchange=e=>{alertPlot=e.target.value;run(alerts)};
  $('#alertSearch').onchange=e=>{alertSearch=e.target.value.trim();run(alerts)};
  $('#refreshAlerts').onclick=()=>run(async()=>{await refresh();await alerts();toast('Alerts refreshed')});
  $('#exportAlerts').onclick=alertCsv;
  if ($('#editThresholds')) $('#editThresholds').onclick=()=>setView('settings');
  document.querySelectorAll('[data-alert-action]').forEach(button=>button.onclick=()=>run(async()=>{
    const action=button.dataset.alertAction;
    const note=action==='resolve'?prompt('Resolution note (optional)',''):'';
    if (note===null) return;
    await api('/alerts/'+button.dataset.alertId+'/'+action,'POST',{note});
    await refresh(); await alerts(); toast('Alert '+(action==='acknowledge'?'acknowledged':action==='resolve'?'resolved':'reopened'));
  }));
  for (const [selector,action] of [['#ackSelected','acknowledge'],['#resolveSelected','resolve']]) {
    const button=$(selector);
    if (!button) continue;
    button.onclick=()=>run(async()=>{
      const ids=[...document.querySelectorAll('.alert-check:checked')].map(x=>x.value);
      if (!ids.length) throw Error('Select at least one active alert');
      if (!confirm(action==='resolve'?'Resolve selected alerts?':'Acknowledge selected alerts?')) return;
      const result=await api('/alerts/bulk','POST',{ids,action});
      await refresh(); await alerts(); toast(result.updated+' alert(s) updated');
    });
  }
}

// Keep the current dashboard fresh while the page is open. API responses are never cached.
setInterval(()=>{
  if (!user || document.hidden || !['overview','alerts'].includes(view)) return;
  run(async()=>{await refresh();if(view==='overview') overview(); else await alerts()});
},60000);

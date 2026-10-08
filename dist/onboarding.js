async function joinScreen(token=new URLSearchParams(location.search).get('invite')||'', invitation=null) {
  if(token && !invitation) {
    try { invitation=await api('/auth/invitations/'+encodeURIComponent(token)); }
    catch(error) { toast(error.message); }
  }
  $('#content').innerHTML=`<div class="auth-wrap"><section class="form-card card">
    <div class="kicker">JOIN A FARM WORKSPACE</div><h2>Register your account</h2>
    <p class="muted">A farm owner or admin provides a one-time invitation. It expires after seven days.</p>
    <form id="inviteCheck" class="form-grid">
      <label class="field span2">Invitation code<input name="token" value="${esc(token)}" required autocomplete="off"></label>
      <button class="secondary span2">Check invitation</button>
    </form>
    ${invitation?`<div class="banner"><strong>${esc(invitation.farm)}</strong><br>${esc(invitation.email)} · ${esc(invitation.role)}</div>
      <form id="joinForm" class="form-grid"><label class="field span2">Your name<input name="name" required maxlength="160" autocomplete="name"></label>
      <label class="field">Password (12+ characters)<input name="password" type="password" minlength="12" required autocomplete="new-password"></label>
      <label class="field">Confirm password<input name="confirm" type="password" minlength="12" required autocomplete="new-password"></label>
      <button class="primary span2">Create my account</button></form>`:''}
    <button class="ghost" id="backToSignIn" style="margin-top:14px">Back to sign in</button>
  </section></div>`;
  $('#inviteCheck').onsubmit=e=>{e.preventDefault();run(()=>joinScreen(new FormData(e.target).get('token').trim()))};
  $('#backToSignIn').onclick=()=>authScreen();
  if($('#joinForm'))$('#joinForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    const values=Object.fromEntries(new FormData(e.target));
    if(values.password!==values.confirm)throw Error('Passwords do not match');
    const result=await api('/auth/register-member','POST',{token,name:values.name,password:values.password});
    history.replaceState(null,'',location.pathname);
    user=result.user;await refresh();setView('overview');toast('Welcome to the farm');
  })};
}

async function teamScreen() {
  const [members,invitations]=await Promise.all([api('/users'),api('/invitations')]);
  $('#content').innerHTML=`<div class="team-layout">
    <section class="panel card"><div class="section-head"><h2>Farm team</h2><span class="tag">${members.length} members</span></div>
      ${members.map(m=>`<div class="plot-row"><div class="row-main"><strong>${esc(m.name)}</strong>
        <small>${esc(m.email)} · ${esc(m.role)} · ${m.active?'Active':'Disabled'}</small></div>
        ${m.role!=='owner'&&(owner()||m.role!=='admin')?`<button class="ghost" data-edit-member="${m.id}">Edit access</button>`:''}</div>`).join('')}
      <form id="editMember" class="form-grid" hidden><h3 class="span2">Edit member</h3>
        <input type="hidden" name="id"><label class="field">Name<input name="name" required></label>
        <label class="field">Role<select name="role"><option>viewer</option><option>operator</option>${owner()?'<option>admin</option>':''}</select></label>
        <label class="field">New password (optional)<input name="password" type="password" minlength="12" autocomplete="new-password"></label>
        <label class="field inline-check"><input name="active" type="checkbox"> Account active</label>
        <button class="primary">Save access</button><button class="ghost" id="cancelEdit" type="button">Cancel</button></form>
    </section>
    <section class="form-card card"><h2>Invite a member</h2><p class="muted">The invitation is shown once. Share the link privately with the invited person.</p>
      <form id="inviteForm" class="form-grid"><label class="field">Email<input name="email" type="email" required></label>
      <label class="field">Role<select name="role"><option value="viewer">Viewer</option><option value="operator">Operator</option>${owner()?'<option value="admin">Admin</option>':''}</select></label>
      <button class="primary span2">Create invitation</button></form><div id="inviteResult"></div>
      <h3 style="margin-top:22px">Recent invitations</h3>
      ${invitations.map(i=>`<div class="plot-row"><div class="row-main"><strong>${esc(i.email)}</strong>
      <small>${esc(i.role)} · ${i.used_at?'Accepted':i.revoked_at?'Revoked':new Date(i.expires_at)<new Date()?'Expired':'Pending'} · expires ${fmt(i.expires_at)}</small></div>
      ${!i.used_at&&!i.revoked_at&&new Date(i.expires_at)>new Date()?`<button class="danger" data-revoke-invite="${i.id}">Revoke</button>`:''}</div>`).join('')||'<div class="empty">No invitations yet.</div>'}
    </section>
  </div>`;
  document.querySelectorAll('[data-edit-member]').forEach(b=>b.onclick=()=>{
    const member=members.find(m=>m.id===b.dataset.editMember),form=$('#editMember');
    form.hidden=false;form.elements.id.value=member.id;form.elements.name.value=member.name;
    form.elements.role.value=member.role;form.elements.active.checked=Boolean(member.active);
    form.elements.password.value='';form.scrollIntoView({behavior:'smooth',block:'center'});
  });
  $('#cancelEdit').onclick=()=>$('#editMember').hidden=true;
  $('#editMember').onsubmit=e=>{e.preventDefault();run(async()=>{
    const f=e.target,v=Object.fromEntries(new FormData(f));
    await api('/users/'+v.id,'PUT',{name:v.name,role:v.role,active:f.elements.active.checked,password:v.password});
    await teamScreen();toast('Member access updated');
  })};
  $('#inviteForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    const result=await api('/invitations','POST',Object.fromEntries(new FormData(e.target)));
    const link=location.origin+location.pathname+'?invite='+encodeURIComponent(result.token);
    await teamScreen();
    $('#inviteResult').innerHTML=`<div class="banner"><strong>Copy this private link now; it will not appear again.</strong>
      <input id="newInviteLink" readonly value="${esc(link)}"><button class="secondary" id="copyInviteLink">Copy invitation link</button></div>`;
    $('#copyInviteLink').onclick=()=>run(async()=>{await navigator.clipboard.writeText(link);toast('Invitation link copied')});
  })};
  document.querySelectorAll('[data-revoke-invite]').forEach(b=>b.onclick=()=>run(async()=>{
    if(!confirm('Revoke this invitation?'))return;
    await api('/invitations/'+b.dataset.revokeInvite,'DELETE');await teamScreen();toast('Invitation revoked');
  }));
}

function profileScreen() {
  $('#content').innerHTML=`<section class="form-card card profile-card"><h2>My profile</h2>
    <p class="muted">${esc(user.tenant_name)} · ${esc(user.role)} · ${esc(user.email)}</p>
    <form id="profileForm" class="form-grid"><label class="field span2">Name<input name="name" value="${esc(user.name)}" required maxlength="160"></label>
      <label class="field">Current password<input name="currentPassword" type="password" autocomplete="current-password"></label>
      <label class="field">New password (optional, 12+ characters)<input name="newPassword" type="password" minlength="12" autocomplete="new-password"></label>
      <button class="primary span2">Save profile</button></form></section>`;
  $('#profileForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    const v=Object.fromEntries(new FormData(e.target));
    await api('/profile','PUT',{name:v.name,currentPassword:v.currentPassword,newPassword:v.newPassword||undefined});
    user=(await api('/me')).user;await refresh();profileScreen();toast('Profile saved');
  })};
}

function guideScreen() {
  const steps=[
    ['Add a plot','Create a field before entering measurements.','plots'],
    ['Capture a record','Log readings or photos from the field.','capture'],
    ['Review alerts','Acknowledge and resolve threshold events.','alerts'],
    ['Manage devices','Assign sensors and rotate ingest keys.','devices'],
    ...(admin()?[['Invite team','Send a private, one-time registration link.','team'],['Set thresholds','Adjust moisture and temperature limits.','settings']]:[]),
    ['Update profile','Change your name or password.','profile']
  ];
  $('#content').innerHTML=`<div class="plots-grid">${steps.map(([title,description,destination])=>`<article class="plot-tile card">
    <h2>${esc(title)}</h2><p class="muted">${esc(description)}</p>
    <button class="secondary" data-open-view="${destination}">Open ${esc(title)}</button></article>`).join('')}</div>`;
  document.querySelectorAll('[data-open-view]').forEach(b=>b.onclick=()=>setView(b.dataset.openView));
}

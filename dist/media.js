async function mediaScreen(){
  const assets=await api('/media');
  $('#content').innerHTML=`<div class="banner">Wyze Cam v3 media: upload photos or MP4 clips exported from the Wyze app. Cameras with an existing local RTSP stream can use the optional gateway feeder described in the README.</div>
    ${canEdit()?`<section class="form-card card"><h2>Upload camera media</h2><form id="mediaForm" class="form-grid">
      <label class="field">Plot<select name="plot" required><option value="">Select plot</option>${data.plots.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">Photo or MP4 clip<input name="file" type="file" accept="image/jpeg,image/png,video/mp4" required></label>
      <label class="field span2">Note<input name="note" maxlength="500" placeholder="Optional camera event or observation"></label>
      <button class="primary">Upload media</button></form></section>`:''}
    <section class="panel card" style="margin-top:18px"><div class="section-head"><h2>Camera gallery</h2><button class="secondary" id="reloadMedia">Refresh</button></div>
      <div class="plots-grid">${assets.map(item=>`<article class="plot-tile card">
        ${item.kind==='photo'?`<img class="photo" loading="lazy" src="/api/media/${item.id}" alt="Camera image from ${esc(plot(item.plot))}">`:
          `<video class="photo" controls preload="metadata" src="/api/media/${item.id}"></video>`}
        <h3>${esc(plot(item.plot))} · ${esc(item.kind)}</h3>
        <p class="muted">${fmt(item.time)} · ${(item.bytes/1024/1024).toFixed(1)} MB</p><p>${esc(item.note)}</p>
        <a class="secondary" href="/api/media/${item.id}" download="cafp-${item.id}.${item.kind==='photo'?(item.mime==='image/png'?'png':'jpg'):'mp4'}">Download</a>
        ${owner()||user.role==='admin'?`<button class="danger" data-delete-media="${item.id}">Delete</button>`:''}
      </article>`).join('')||'<div class="empty">No camera media yet.</div>'}</div></section>`;
  $('#reloadMedia').onclick=()=>run(mediaScreen);
  if($('#mediaForm'))$('#mediaForm').onsubmit=e=>{e.preventDefault();run(async()=>{
    const values=new FormData(e.target),file=values.get('file');
    if(!['image/jpeg','image/png','video/mp4'].includes(file.type)||file.size>8_000_000||!file.size)
      throw Error('Choose a JPEG, PNG or MP4 up to 8 MB');
    const response=await fetch('/api/media?plot='+encodeURIComponent(values.get('plot'))+'&note='+encodeURIComponent(values.get('note').slice(0,500)),{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':file.type},body:file});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Upload failed');
    await mediaScreen();toast('Camera media saved');
  })};
  document.querySelectorAll('[data-delete-media]').forEach(button=>button.onclick=()=>run(async()=>{
    if(!confirm('Delete this camera media?'))return;
    await api('/media/'+button.dataset.deleteMedia,'DELETE');await mediaScreen();toast('Media deleted');
  }));
}

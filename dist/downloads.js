let installEvent=null;
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();installEvent=event;
  if(document.querySelector('#installApp')) updateInstallButton();
});
window.addEventListener('appinstalled',()=>{installEvent=null;if(document.querySelector('#installApp'))updateInstallButton();toast('CAFP installed')});
function updateInstallButton(){
  const button=document.querySelector('#installApp');if(!button)return;
  const installed=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  button.hidden=installed;button.textContent=installEvent?'Install CAFP':'Show installation steps';
}
function downloadsScreen(){
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
  $('#content').innerHTML=`<div class="downloads-grid"><section class="form-card card">
    <div class="kicker">CAFP ON YOUR DEVICE</div><h2>Install the farm app</h2>
    <p>Use the same farm account on your phone, tablet, and desktop. Installation adds CAFP to your home screen.</p>
    <button class="primary" id="installApp" type="button">Install CAFP</button>
    <button class="ghost" id="backFromDownloads" type="button">${user?'Back to dashboard':'Back to sign in'}</button>
    <div id="installHelp" class="banner" hidden></div>
    <p class="muted">Install requires HTTPS (or localhost) and a compatible browser. Measurements and account actions need a network connection.</p>
  </section><section class="panel card"><h2>Platform instructions</h2>
    <h3>Android</h3><p>Open this site in Chrome, then use the browser menu and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
    <h3>iPhone or iPad</h3><p>Open this site in Safari, tap Share, then <strong>Add to Home Screen</strong>.</p>
    <h3>Desktop</h3><p>Open this site in a browser that supports installing web apps and select its install icon or menu item.</p>
    <button class="secondary" id="copyAppLink" type="button">Copy app link</button>
  </section></div>`;
  updateInstallButton();
  $('#backFromDownloads').onclick=()=>user?setView('overview'):authScreen();
  $('#installApp').onclick=()=>run(async()=>{
    if(installEvent){const prompt=installEvent;installEvent=null;await prompt.prompt();await prompt.userChoice;updateInstallButton();return}
    const help=$('#installHelp');help.hidden=false;
    help.textContent=ios?'In Safari: tap Share, then Add to Home Screen.':
      'Open the browser menu and choose Install app or Add to Home screen. On desktop, look for the install icon in the address bar.';
  });
  $('#copyAppLink').onclick=()=>run(async()=>{await navigator.clipboard.writeText(location.origin+location.pathname);toast('App link copied')});
}

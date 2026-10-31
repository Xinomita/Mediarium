(()=>{
  if(window.tvRemote)return;
  const style=document.createElement('style');
  style.textContent=`*:focus {outline:4px solid #edc68f!important;outline-offset:5px!important} html{scroll-behavior:smooth} body{overscroll-behavior:none} .hh-skip{display:none!important} .hh-header{position:sticky!important} a,button,input,select,summary{scroll-margin:120px 35px} .hh-card{scroll-margin:140px 35px} .hh-footer{display:none} .tv-playback{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:16px;padding:12px;border-radius:12px;background:#111e} .tv-playback button{font:600 20px sans-serif;padding:12px 24px;color:white;background:#304255;border:1px solid #778899;border-radius:8px}`;
  document.head.append(style);
  // TV GPU budget: no animated scrolling, live blur or decorative transforms.
  style.textContent+=`*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important} .hh-header{background:#151518!important} .hh-title-card:hover .hh-art,.hh-title-card:hover .hh-art img{transform:none!important;box-shadow:none!important} .hh-rail-track{scroll-snap-type:none!important} .hh-title-card:focus{outline:3px solid #edc68f!important;outline-offset:2px!important} .hh-glass{background:#29292e!important} .hh-card-reason{display:none!important}`;
  const selector='a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  const visible=e=>!e.disabled&&!e.closest('[inert]')&&e.getClientRects().length>0;
  const scope=()=>document.querySelector('dialog[open]')||document;
  let cachedScope=null,cachedOptions=null;
  const options=()=>{const s=scope();if(!cachedOptions||s!==cachedScope){cachedScope=s;cachedOptions=Array.from(s.querySelectorAll(selector)).filter(e=>!e.matches('.hh-rail-track'));}return cachedOptions.filter(visible);};
  const focus=e=>{e.focus({preventScroll:true});e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});};
  let lastPath=location.href;
  const ensure=()=>{
    if(location.href!==lastPath){lastPath=location.href;document.activeElement?.blur();}
    if(!document.activeElement||document.activeElement===document.body||!document.activeElement.isConnected){
      const all=options();const preferred=all.find(e=>e.matches('input:not([type=checkbox]):not([type=range])'))||all.find(e=>e.matches('.hh-hero a,.hh-hero button'))||all[0];if(preferred)focus(preferred);
    }
    const dialog=document.querySelector('dialog.hh-player[open]');
    if(dialog&&!dialog.querySelector('.tv-playback')){
      const bar=document.createElement('div');bar.className='tv-playback';
      const b=document.createElement('button');b.textContent='Play / pause';b.onclick=()=>window.tvRemote('playpause');bar.append(b);dialog.append(bar);
    }
  };
  window.tvRemote=key=>{
    const video=document.querySelector('dialog[open] video');
    if(key==='playpause'||key==='play'||key==='pause'){
      if(video){if(key==='pause'||(key==='playpause'&&!video.paused))video.pause();else video.play().catch(()=>{});}return;
    }
    ensure();let active=document.activeElement;
    if(key==='enter'){
      if(active?.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea')){active.focus();active.click();return 'input';}
      active?.click();return;
    }
    if(active?.matches('input[type=range]')&&(key==='left'||key==='right')){
      const eventKey=key==='left'?'ArrowLeft':'ArrowRight';
      const next=Math.max(Number(active.min)||0,Math.min(Number(active.max)||100,Number(active.value)+(key==='left'?-10:10)));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(active,String(next));
      active.dispatchEvent(new Event('input',{bubbles:true}));active.dispatchEvent(new Event('change',{bubbles:true}));active.dispatchEvent(new KeyboardEvent('keyup',{key:eventKey,bubbles:true}));return;
    }
    if(active?.matches('select')&&(key==='left'||key==='right')){
      active.selectedIndex=Math.max(0,Math.min(active.options.length-1,active.selectedIndex+(key==='left'?-1:1)));
      active.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    // Most TV input is horizontal shelf movement: constant work, no page scan.
    if(active?.matches('.hh-rail-track > .hh-title-card')&&(key==='left'||key==='right')){
      const next=key==='left'?active.previousElementSibling:active.nextElementSibling;
      if(next?.matches('.hh-title-card'))focus(next);
      return;
    }
    const origin=active?.getBoundingClientRect();if(!origin)return;
    const vertical=key==='up'||key==='down',negative=key==='up'||key==='left';
    const cx=origin.left+origin.width/2,cy=origin.top+origin.height/2;
    let best=null,bestScore=Infinity;
    for(const e of options()){
      if(e===active)continue;
      const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      const main=vertical?y-cy:x-cx,cross=vertical?Math.abs(x-cx):Math.abs(y-cy);
      if((negative?main>=-3:main<=3))continue;
      const overlap=vertical?Math.min(origin.right,r.right)-Math.max(origin.left,r.left):Math.min(origin.bottom,r.bottom)-Math.max(origin.top,r.top);
      const score=Math.abs(main)+cross*2+(overlap<0?1000:0);
      if(score<bestScore){best=e;bestScore=score;}
    }
    if(best)focus(best);else if(vertical)window.scrollBy(0,negative?-350:350);
  };
  window.tvBack=()=>{
    const dialog=document.querySelector('dialog[open]');if(dialog){dialog.dispatchEvent(new Event('cancel',{cancelable:true}));return true;}
    const menu=document.querySelector('details[open]');if(menu){menu.open=false;menu.querySelector('summary')?.focus();return true;}return false;
  };
  let scheduled=false;
  const schedule=()=>{cachedOptions=null;if(scheduled||document.hidden)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;ensure();});};
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','disabled']});
  addEventListener('popstate',schedule);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  ensure();
})();

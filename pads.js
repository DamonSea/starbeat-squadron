/* pads.js: Switch 2 Pro Controller support for browser games (from Controller Tester).
 *
 * Load it before your game's own scripts:  <script src="pads.js"></script>
 * Your game keeps calling navigator.getGamepads() and gamepad.vibrationActuator as before. This file:
 *   - remaps the Switch 2 Pro Controller (057e:2069) to the browser's "standard" layout, so buttons[0] is the
 *     bottom face button (B), buttons[9] is Plus, axes 0-3 are the sticks with up = negative, and so on
 *     (C, GL and GR come through as buttons 18, 19 and 20);
 *   - wakes the controller over USB (it sends nothing until it's told to). After the first time you allow it,
 *     this happens on its own whenever the page loads or the controller is plugged in;
 *   - gives it working rumble (HD rumble over WebHID) through the usual vibrationActuator.playEffect();
 *   - turns on player light 1.
 * Optional helpers: Pads.layout(gp), Pads.names(gp), Pads.relabel(selector), Pads.setPlayerLight(n).
 * Needs desktop Chrome or Edge for the wake-up, rumble and lights; elsewhere the controller simply isn't remapped.
 */
(function(){
  'use strict';
  if(window.Pads)return;
  const nav=navigator,realGet=nav.getGamepads?nav.getGamepads.bind(nav):null;
  const SW2={vid:0x057e,pid:0x2069};
  const isSW2=id=>/057e/i.test(id)&&/2069/i.test(id);
  // Recorded with Controller Tester's Map wizard on a real Switch 2 Pro (wired, Chrome on macOS).
  // Standard button index -> raw button index; sticks: raw axis, resting centre, sign, full-tilt range.
  const SW2_MAP={n:21,buttons:[0,1,2,3,12,4,13,5,14,6,15,7,11,8,10,9,16,17,20,19,18],
    sticks:[{x:{a:0,c:.026,s:1,r:.779},y:{a:1,c:.046,s:-1,r:.704}},{x:{a:3,c:.153,s:1,r:.674},y:{a:5,c:-.016,s:-1,r:.750}}]};
  const clamp=v=>Math.max(-1,Math.min(1,v));
  const B=b=>b?{pressed:!!b.pressed,touched:!!(b.touched||b.pressed),value:b.value||0}:{pressed:false,touched:false,value:0};

  // ---------- remapping ----------
  const shims=new Map();
  function rumbleShim(index){
    if(!shims.has(index))shims.set(index,{type:'dual-rumble',effects:['dual-rumble'],
      playEffect:(type,p={})=>type==='dual-rumble'?hdRumble(p.strongMagnitude||0,p.weakMagnitude||0,p.duration||200).then(()=>'complete',()=>'preempted'):Promise.resolve('invalid-parameter'),
      reset:()=>{stopRumble();return Promise.resolve('complete')}});
    return shims.get(index);
  }
  function mapSW2(raw){
    const m=SW2_MAP,buttons=m.buttons.map(i=>B(raw.buttons[i]));
    const axes=m.sticks.flatMap(s=>['x','y'].map(k=>{const a=s[k],v=raw.axes[a.a];return v==null?0:clamp((v-a.c)*a.s/a.r)}));
    return{id:raw.id,index:raw.index,connected:raw.connected,timestamp:raw.timestamp,mapping:'standard',buttons,axes,
      vibrationActuator:rumbleShim(raw.index),hapticActuators:[],layout:'nintendo',remapped:true};
  }
  function list(){
    let l=[];try{l=Pads.source()}catch(e){}
    let active=null;
    const out=Array.from(l||[],g=>{if(!g)return null;if(g.connected&&(!active||g.timestamp>active.timestamp))active=g;if(isSW2(g.id)){seen(g);return mapSW2(g)}return g});
    if(active)setLayout(layout(active));  // labels follow whichever controller was used last
    return out;
  }
  if(realGet)nav.getGamepads=list;

  // ---------- waking the controller (WebUSB, vendor interface 1) ----------
  const CMDS=[
    [0x03,0x91,0x00,0x0D,0x00,0x08,0x00,0x00,0x01,0x00,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF], // initialise; inputs start
    [0x0C,0x91,0x00,0x02,0x00,0x04,0x00,0x00,0x27,0x00,0x00,0x00],                     // feature mask: buttons, sticks, motion, rumble
    [0x0C,0x91,0x00,0x04,0x00,0x04,0x00,0x00,0x27,0x00,0x00,0x00],                     // enable those features
    [0x03,0x91,0x00,0x0A,0x00,0x04,0x00,0x00,0x09,0x00,0x00,0x00]];                    // full input report (0x09)
  const S={usb:null,ep:2,hid:null,awake:false,lastTs:{},seq:0,timer:null,light:1,ui:null,tried:false};
  async function openUsb(d){
    if(!d.opened)await d.open();if(!d.configuration)await d.selectConfiguration(1);
    try{await d.claimInterface(1)}catch(e){}
    const alt=d.configuration.interfaces.find(i=>i.interfaceNumber===1).alternate;
    S.ep=(alt.endpoints.find(e=>e.direction==='out')||{endpointNumber:2}).endpointNumber;S.usb=d;return d;
  }
  async function wake(ask){
    if(!('usb' in nav))throw new Error('This browser can\'t wake the controller. Use Chrome or Edge on a computer.');
    let d=(await nav.usb.getDevices()).find(x=>x.vendorId===SW2.vid&&x.productId===SW2.pid);
    if(!d&&ask)d=await nav.usb.requestDevice({filters:[{vendorId:SW2.vid,productId:SW2.pid}]});
    if(!d)return false;
    await openUsb(d);for(const c of CMDS)await d.transferOut(S.ep,new Uint8Array(c));
    await setPlayerLight(S.light);S.awake=true;updateUI();return true;
  }
  async function setPlayerLight(n){
    S.light=n;if(!S.usb)return false;
    const mask=[0,0x01,0x03,0x07,0x0F][Math.max(0,Math.min(4,n))];
    await S.usb.transferOut(S.ep,new Uint8Array([0x09,0x91,0x00,0x07,0x00,0x08,0x00,0x00,mask,0,0,0,0,0,0,0]));return true;
  }

  // ---------- HD rumble (WebHID output report 0x02) ----------
  // Each side: 0x50|counter, then a 5-byte frame of four 10-bit fields (high freq, high amp, low freq, low amp).
  // Amplitude is capped at 453, SDL's strongest normal rumble for this controller.
  const frame=(hf,ha,lf,la)=>[hf&255,((hf>>8)|(ha<<2))&255,((ha>>6)|(lf<<4))&255,((lf>>4)|(la<<6))&255,(la>>2)&255];
  const hidOk=d=>d.vendorId===SW2.vid&&d.productId===SW2.pid&&d.collections.some(c=>(c.outputReports||[]).some(r=>r.reportId===2));
  async function getHid(ask){
    if(S.hid&&S.hid.opened)return S.hid;if(!('hid' in nav))return null;
    let d=(await nav.hid.getDevices()).find(hidOk);
    if(!d&&ask){const l=await nav.hid.requestDevice({filters:[{vendorId:SW2.vid,productId:SW2.pid}]});d=l.find(hidOk)||l[0]}
    if(!d)return null;if(!d.opened)await d.open();S.hid=d;updateUI();return d;
  }
  async function send(d,f){const r=new Uint8Array(63),s=0x50|(S.seq++&15);r[0]=s;r.set(f,1);r[16]=s;r.set(f,17);await d.sendReport(2,r)}
  function stopRumble(){clearInterval(S.timer);S.timer=null;if(S.hid&&S.hid.opened)send(S.hid,[0,0,0,0,0]).catch(()=>{})}
  async function hdRumble(strong,weak,ms){
    const d=await getHid(false);if(!d)throw new Error('rumble not enabled');
    const amp=v=>Math.round(Math.max(0,Math.min(1,v))*453),f=frame(0x187,amp(weak),0x112,amp(strong)),end=performance.now()+ms;
    clearInterval(S.timer);await send(d,f);
    S.timer=setInterval(()=>{if(performance.now()>=end)stopRumble();else send(d,f).catch(stopRumble)},8);
  }

  // ---------- small prompt shown only when the controller needs a click ----------
  function seen(g){
    const k=g.index,ts=g.timestamp,moved=S.lastTs[k]!==undefined&&S.lastTs[k]!==ts;S.lastTs[k]=ts;
    if(moved)S.awake=true;
    if(!S.tried){S.tried=true;wake(false).catch(()=>{});getHid(false).catch(()=>{})}
    if(!S.ui&&!S.uiT)S.uiT=setTimeout(()=>{S.uiT=0;updateUI()},1200);
  }
  function updateUI(){
    if(!document.body)return;
    const present=Pads.source&&Array.from(Pads.source()||[]).some(g=>g&&isSW2(g.id));
    const needWake=present&&!S.awake,needHid=present&&S.awake&&!S.hid&&'hid' in nav&&!Pads.noRumblePrompt;
    if(!needWake&&!needHid){if(S.ui)S.ui.remove(),S.ui=null;return}
    if(!S.ui){S.ui=document.createElement('button');S.ui.type='button';
      S.ui.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483647;max-width:300px;padding:10px 14px;border-radius:14px;border:1px solid #6d5bd0;background:#16131fee;color:#fff;font:600 13px/1.35 system-ui,sans-serif;text-align:left;cursor:pointer;box-shadow:0 6px 24px #0008';
      S.ui.onclick=async()=>{try{if(!S.awake)await wake(true);else await getHid(true)}catch(e){S.ui&&(S.ui.textContent=/policy|Security|not allowed/i.test(e.name+e.message)?'This page can\'t reach USB devices here. Open the game on its own page in Chrome.':e.name==='NotFoundError'?'No controller chosen. Click to try again.':e.message)}updateUI()};
      document.body.appendChild(S.ui)}
    S.ui.innerHTML=needWake?'Switch 2 Pro Controller found<br><span style="font-weight:400;opacity:.8">Click to wake it up (pick it in the box that opens)</span>':
      'Controller ready<br><span style="font-weight:400;opacity:.8">Click to turn on rumble (optional) · <u data-x>hide</u></span>';
    const x=S.ui.querySelector('[data-x]');if(x)x.onclick=e=>{e.stopPropagation();Pads.noRumblePrompt=true;updateUI()};
  }
  addEventListener('gamepadconnected',e=>{if(isSW2(e.gamepad.id)){S.tried=false;S.awake=false;seen(e.gamepad);updateUI()}});
  addEventListener('gamepaddisconnected',()=>setTimeout(updateUI,100));
  if(nav.usb)nav.usb.addEventListener('connect',e=>{if(e.device.vendorId===SW2.vid&&e.device.productId===SW2.pid)setTimeout(()=>wake(false).catch(()=>{}),300)});

  // ---------- button names per layout ----------
  const NAMES={playstation:['✕','○','□','△','L1','R1','L2','R2','Create','Options','L3','R3','↑','↓','←','→','PS','Touchpad'],
    nintendo:['B','A','Y','X','L','R','ZL','ZR','−','+','LS','RS','↑','↓','←','→','Home','Capture','C','GL','GR'],
    xbox:['A','B','X','Y','LB','RB','LT','RT','View','Menu','LS','RS','↑','↓','←','→','Xbox','Share']};
  function layout(gp){const id=gp&&gp.id||'';return gp&&gp.layout||(/057e|nintendo|pro controller|joy-?con/i.test(id)?'nintendo':/045e|xbox|xinput/i.test(id)?'xbox':'playstation')}
  // Swap PlayStation symbols for the active controller's names inside elements matching `selector`.
  let relabelSel=null,current='playstation';
  // Only symbols and L1/R1-style names are swapped: plain words like "Options" are left alone so menu text isn't touched.
  const SWAP={nintendo:{'✕':'B','○':'A','□':'Y','△':'X','L1':'L','R1':'R','L2':'ZL','R2':'ZR','L3':'LS','R3':'RS'},
              xbox:{'✕':'A','○':'B','□':'X','△':'Y','L1':'LB','R1':'RB','L2':'LT','R2':'RT','L3':'LS','R3':'RS'}};
  const RX=/✕|○|□|△|\b(?:L1|R1|L2|R2|L3|R3)\b/g;
  function fixNode(n){
    if(n.__padOrig===undefined){if(!RX.test(n.nodeValue)){RX.lastIndex=0;return}RX.lastIndex=0;n.__padOrig=n.nodeValue}
    const want=current==='playstation'?n.__padOrig:n.__padOrig.replace(RX,m=>SWAP[current][m]||m);
    if(n.nodeValue!==want){n.__padSet=true;n.nodeValue=want}
  }
  function relabelAll(){if(!relabelSel)return;document.querySelectorAll(relabelSel).forEach(el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode())fixNode(n)})}
  function relabel(selector){
    relabelSel=selector;relabelAll();
    new MutationObserver(ms=>{if(!relabelSel)return;for(const m of ms){
      if(m.type==='characterData'){const n=m.target;if(n.__padSet){n.__padSet=false;continue}n.__padOrig=undefined;const el=n.parentElement;if(el&&el.closest(relabelSel))fixNode(n)}
      else m.addedNodes.forEach(a=>{const el=a.nodeType===1?a:a.parentElement;if(!el)return;if(el.closest(relabelSel)||(a.nodeType===1&&a.querySelector(relabelSel))){
        const roots=a.nodeType===3?[a.parentElement]:[a];roots.forEach(r=>{const w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){n.__padOrig=undefined;if(n.parentElement.closest(relabelSel))fixNode(n)}})}})}
    }).observe(document.body,{subtree:true,childList:true,characterData:true});
  }
  function setLayout(l){if(l!==current){current=l;relabelAll()}}

  window.Pads={
    source:()=>realGet?realGet():[],          // where raw gamepads come from (tests can swap this)
    map:g=>g&&isSW2(g.id)?mapSW2(g):g,        // remap one raw gamepad
    layout,names:gp=>NAMES[layout(gp)].slice(),setLayout,relabel,refresh:relabelAll,
    wake:()=>wake(true),enableRumble:()=>getHid(true),setPlayerLight,
    get awake(){return S.awake},noRumblePrompt:false
  };
})();

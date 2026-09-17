import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIGNAL_POSTS, crossingPhase, secondsUntilChange, walkCountdown, setCrossingTime } from './crossing-logic';
import { glowMaterial, texture, uniform } from './tsl';

/** Hooded signal heads and pedestrian pictograms; no extra point lights or bloom-heavy text. */
export function createCrossingSignals() {
  const group=new THREE.Group();group.name='Coordinated crossing signals';
  const shell=new THREE.MeshStandardNodeMaterial({color:0x172431,roughness:.65,metalness:.4});
  const trim=new THREE.MeshBasicNodeMaterial({color:0x418e99});
  const lamps: {mesh:THREE.Mesh; axis:'avenue'|'cross'; state:'red'|'amber'|'green'}[]=[];
  const pedestrians:{walk:THREE.Group;stop:THREE.Mesh}[]=[];
  const countdowns:Record<PanelKey,THREE.Mesh[]>={avenue:[],cross:[],walk:[]};
  const colors={red:0xff415f,amber:0xffbd40,green:0x57efb0};
  // Every light in this city is emissive and bloom is what makes it read as a light: a plain colour
  // tops out at 1.0 linear, under the 1.6 threshold in post.ts, so these lenses were flat discs that
  // never glowed and were easy to miss entirely from the pavement. glowMaterial multiplies past the
  // threshold and shares one cached program per colour.
  const lit=Object.fromEntries(Object.entries(colors).map(([k,color])=>[k,glowMaterial(color,6.5)]));
  // A dark lens sits in every socket so a head still reads as a signal when that aspect is unlit,
  // instead of showing an empty hole. Static, so it merges into the housing draw below.
  const lens=new THREE.MeshStandardNodeMaterial({color:0x090d14,roughness:.35,metalness:.2});
  function box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material=shell) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);parent.add(m);return m;
  }
  // Countdown panels: one canvas per axis, redrawn only when the number changes, and every panel on
  // that axis samples it. A generated image cannot do this job, since the digits change every second.
  type PanelKey='avenue'|'cross'|'walk';
  const panels: Record<PanelKey,{tex:THREE.CanvasTexture;ctx:CanvasRenderingContext2D;shown:string}> = {} as any;
  const panelMat: Record<PanelKey,THREE.MeshBasicNodeMaterial> = {} as any;
  for(const axis of ['avenue','cross','walk'] as const) {
    const c=document.createElement('canvas');c.width=256;c.height=160;
    const ctx=c.getContext('2d')!;
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    panels[axis]={tex,ctx,shown:''};
    const m=new THREE.MeshBasicNodeMaterial();
    m.colorNode=texture(tex).rgb.mul(uniform(3.4)); // well past the bloom threshold: the panel is a light
    panelMat[axis]=m;
  }
  const drawPanel=(axis:PanelKey,secs:number,state:'red'|'amber'|'green',word?:string)=>{
    const p=panels[axis];const key=secs+state+(word??'');
    if(p.shown===key) return;
    p.shown=key;
    const {ctx}=p;const w=256,h=160;
    const ink=state==='green'?'#57efb0':state==='amber'?'#ffbd40':'#ff415f';
    ctx.fillStyle='#04070c';ctx.fillRect(0,0,w,h);
    // A depleting bar rather than digits. Text on a small panel kept losing its top to whatever sat
    // in front of it, and at this size a row of blocks reads faster anyway: each block is a second,
    // capped at ten, and the whole panel is one colour so the state is legible before the count is.
    const n=Math.min(10,Math.max(1,secs));
    const pad=14,gap=5,cols=10;
    const bw=(w-pad*2-gap*(cols-1))/cols,bh=52;
    for(let i=0;i<cols;i++) {
      ctx.fillStyle=i<n?ink:'#12202c';
      ctx.fillRect(pad+i*(bw+gap),h-pad-bh,bw,bh);
    }
    ctx.strokeStyle=ink;ctx.lineWidth=8;ctx.strokeRect(4,4,w-8,h-8);
    if(word) {
      ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='alphabetic';
      ctx.font='bold 46px "IBM Plex Mono", monospace';
      ctx.fillText(word,w/2,h-pad-bh-16);
    }
    p.tex.needsUpdate=true;
  };
  drawPanel('avenue',1,'red');drawPanel('cross',1,'red');drawPanel('walk',1,'red','WAIT');

  for(const p of SIGNAL_POSTS) {
    const post=new THREE.Group();post.position.set(p.x,0,p.z);group.add(post);
    box(post,.22,6.2,.22,0,3.1,0);box(post,.34,.12,.34,0,6.2,0,trim);
    for(const axis of ['avenue','cross'] as const) {
      // Both heads and both pedestrian units used to sit concentric on the mast, so each one's
      // housing cut across its neighbour's lit face from any oblique angle. Standing each unit out
      // along its own facing direction puts them side by side instead of inside one another.
      const head=new THREE.Group();head.rotation.y=axis==='avenue'?(p.sz>0?0:Math.PI):(p.sx>0?Math.PI/2:-Math.PI/2);
      head.position.set(0,0,.26);head.position.applyAxisAngle(new THREE.Vector3(0,1,0),head.rotation.y);post.add(head);
      box(head,.92,2.0,.42,0,4.8,0);box(head,1.0,.12,.72,0,5.88,.12);
      for(const [i,state] of (['red','amber','green'] as const).entries()) {
        const y=5.42-i*.6;
        // These lenses were 0.2 u across and read as roughly eight screen pixels from the pavement,
        // against a dark hood: the lights were drawn and correct, just too small to notice. The head
        // is now a third larger and the lens half again, and burns past the bloom threshold, so the
        // post-chain gives it the same halo every other light in the city gets. No extra geometry:
        // a separate halo quad per lamp cost 50 draw calls and showed up on the phone tier.
        const socket=new THREE.Mesh(new THREE.CircleGeometry(.32,14),lens);socket.position.set(0,y,.24);head.add(socket);
        const mesh=new THREE.Mesh(new THREE.CircleGeometry(.3,14),lit[state]);mesh.position.set(0,y,.28);mesh.userData.signal=`${axis}:${state}`;head.add(mesh);
        lamps.push({mesh,axis,state});
      }
      // The bar is the point, so its housing is a shallow backing plate rather than a tall hood.
      box(head,1.06,.74,.16,0,3.5,.06);
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(1.0,.63),panelMat[axis]);
      panel.position.set(0,3.5,.2);head.add(panel);countdowns[axis].push(panel);

      const ped=new THREE.Group();ped.rotation.y=head.rotation.y+Math.PI;
      ped.position.set(0,0,.26);ped.position.applyAxisAngle(new THREE.Vector3(0,1,0),ped.rotation.y);post.add(ped);
      box(ped,1.24,.86,.18,0,1.95,0);box(ped,.8,.92,.18,0,2.92,0);
      const wpanel=new THREE.Mesh(new THREE.PlaneGeometry(1.18,.76),panelMat.walk);
      wpanel.position.set(0,1.95,.13); // its backing plate is only .18 deep, so this clears itped.add(wpanel);countdowns.walk.push(wpanel);
      const stop=box(ped,.62,.14,.02,0,2.92,.13,lit.red);
      const walk=new THREE.Group();ped.add(walk);
      box(walk,.15,.36,.02,0,2.92,.13,lit.green);
      const dot=new THREE.Mesh(new THREE.CircleGeometry(.115,10),lit.green);dot.position.set(0,3.24,.14);walk.add(dot);
      for(const s of [-1,1]) {
        const leg=box(walk,.09,.33,.02,s*.09,2.66,.13,lit.green);leg.rotation.z=s*.45;
        const arm=box(walk,.09,.29,.02,s*.13,2.92,.13,lit.green);arm.rotation.z=s*.7;
      }
      walk.updateMatrix();
      const glyphParts=walk.children.map(child=>{
        const mesh=child as THREE.Mesh;mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      for(const child of walk.children) (child as THREE.Mesh).geometry.dispose();
      walk.clear();walk.add(new THREE.Mesh(mergeGeometries(glyphParts,false)!,lit.green));
      glyphParts.forEach(g=>g.dispose());
      pedestrians.push({walk,stop});
    }
  }
  // All static housings/poles share two draws, not one draw per small component.
  group.updateMatrixWorld(true);
  for(const material of [shell,trim,lens]) {
    const parts:THREE.Mesh[]=[];
    group.traverse(o=>{if(o instanceof THREE.Mesh && o.material===material) parts.push(o);});
    const geos=parts.map(m=>m.geometry.clone().applyMatrix4(m.matrixWorld));
    for(const part of parts) {part.removeFromParent();part.geometry.dispose();}
    group.add(new THREE.Mesh(mergeGeometries(geos,false)!,material));
    geos.forEach(g=>g.dispose());
  }
  for(const axis of ['avenue','cross','walk'] as const) {
    const parts=countdowns[axis];
    if(!parts.length) continue;
    const geos=parts.map(m=>{m.updateMatrixWorld(true);return m.geometry.clone().applyMatrix4(m.matrixWorld);});
    for(const part of parts) {part.removeFromParent();part.geometry.dispose();}
    group.add(new THREE.Mesh(mergeGeometries(geos,false)!,panelMat[axis]));
    geos.forEach(g=>g.dispose());
  }

  const update=(t:number)=>{
    setCrossingTime(t);const phase=crossingPhase(t);
    for(const axis of ['avenue','cross'] as const) drawPanel(axis,secondsUntilChange(axis,t),phase[axis],axis==='avenue'?'AVE':'CROSS');
    const wc=walkCountdown(t);drawPanel('walk',wc.secs,wc.walk?'green':'red',wc.walk?'WALK':'WAIT');
    for(const l of lamps) l.mesh.visible=phase[l.axis]===l.state;
    for(const p of pedestrians) {p.walk.visible=phase.walk;p.stop.visible=!phase.walk;}
  };
  update(0);return {group,update};
}

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
    const c=document.createElement('canvas');c.width=192;c.height=112;
    const ctx=c.getContext('2d')!;
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    panels[axis]={tex,ctx,shown:''};
    const m=new THREE.MeshBasicNodeMaterial();
    m.colorNode=texture(tex).rgb.mul(uniform(2.2)); // emissive enough for bloom to catch the digits
    panelMat[axis]=m;
  }
  const drawPanel=(axis:PanelKey,secs:number,state:'red'|'amber'|'green')=>{
    const p=panels[axis];const label=String(secs).padStart(2,'0');
    if(p.shown===label+state) return;
    p.shown=label+state;
    const {ctx}=p;const w=192,h=112;
    ctx.fillStyle='#05080d';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#1d2b3a';ctx.lineWidth=5;ctx.strokeRect(3,3,w-6,h-6);
    ctx.fillStyle=state==='green'?'#57efb0':state==='amber'?'#ffbd40':'#ff415f';
    ctx.font='bold 78px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(label,w/2,h/2+4);
    p.tex.needsUpdate=true;
  };
  drawPanel('avenue',1,'red');drawPanel('cross',1,'red');drawPanel('walk',1,'red');

  for(const p of SIGNAL_POSTS) {
    const post=new THREE.Group();post.position.set(p.x,0,p.z);group.add(post);
    box(post,.22,6.2,.22,0,3.1,0);box(post,.34,.12,.34,0,6.2,0,trim);
    for(const axis of ['avenue','cross'] as const) {
      const head=new THREE.Group();head.rotation.y=axis==='avenue'?(p.sz>0?0:Math.PI):(p.sx>0?Math.PI/2:-Math.PI/2);post.add(head);
      box(head,1.0,2.3,.55,0,4.65,0);box(head,1.1,.14,.9,0,5.95,.14);
      for(const [i,state] of (['red','amber','green'] as const).entries()) {
        const y=5.3-i*.65;
        // These lenses were 0.2 u across and read as roughly eight screen pixels from the pavement,
        // against a dark hood: the lights were drawn and correct, just too small to notice. The head
        // is now a third larger and the lens half again, and burns past the bloom threshold, so the
        // post-chain gives it the same halo every other light in the city gets. No extra geometry:
        // a separate halo quad per lamp cost 50 draw calls and showed up on the phone tier.
        const socket=new THREE.Mesh(new THREE.CircleGeometry(.34,14),lens);socket.position.set(0,y,.30);head.add(socket);
        const mesh=new THREE.Mesh(new THREE.CircleGeometry(.3,14),lit[state]);mesh.position.set(0,y,.34);mesh.userData.signal=`${axis}:${state}`;head.add(mesh);
        lamps.push({mesh,axis,state});
      }
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(.78,.46),panelMat[axis]);
      panel.position.set(0,3.62,.34);head.add(panel);countdowns[axis].push(panel);

      const ped=new THREE.Group();ped.rotation.y=head.rotation.y+Math.PI;post.add(ped);
      box(ped,.86,1.55,.35,0,2.45,0);
      const wpanel=new THREE.Mesh(new THREE.PlaneGeometry(.66,.4),panelMat.walk);
      wpanel.position.set(0,2.06,.2);ped.add(wpanel);countdowns.walk.push(wpanel);
      const stop=box(ped,.4,.09,.02,0,2.7,.24,lit.red);
      const walk=new THREE.Group();ped.add(walk);
      box(walk,.11,.27,.02,0,2.7,.24,lit.green);
      const dot=new THREE.Mesh(new THREE.CircleGeometry(.085,8),lit.green);dot.position.set(0,2.96,.25);walk.add(dot);
      for(const s of [-1,1]) {
        const leg=box(walk,.07,.25,.02,s*.07,2.48,.24,lit.green);leg.rotation.z=s*.45;
        const arm=box(walk,.07,.22,.02,s*.1,2.7,.24,lit.green);arm.rotation.z=s*.7;
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
    for(const axis of ['avenue','cross'] as const) drawPanel(axis,secondsUntilChange(axis,t),phase[axis]);
    const wc=walkCountdown(t);drawPanel('walk',wc.secs,wc.walk?'green':'red');
    for(const l of lamps) l.mesh.visible=phase[l.axis]===l.state;
    for(const p of pedestrians) {p.walk.visible=phase.walk;p.stop.visible=!phase.walk;}
  };
  update(0);return {group,update};
}

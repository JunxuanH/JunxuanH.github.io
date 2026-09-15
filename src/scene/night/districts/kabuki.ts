import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeBlock, stringLights, type DistrictBuild, type DistrictCtx } from './shared';
import { CURB_H } from '../streets';
import { MARKET_STALLS, MARKET_BOLLARDS } from '../market-layout';
import { loader } from '../palette';

/** A compact pedestrian electronics / food bazaar. No stand or vehicle occupies its central lane. */
export async function create(ctx: DistrictCtx): Promise<DistrictBuild> {
  const group = new THREE.Group();
  group.name = 'Afterhours pedestrian market';
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x17202d, roughness: .65, metalness: .35 });
  const panel = new THREE.MeshStandardNodeMaterial({ color: 0x27303e, roughness: .85 });
  const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x0b101a, roughness: .9 });
  const ceramic = new THREE.MeshStandardNodeMaterial({ color: 0xc2bcb0, roughness: .65 });
  const yellow = new THREE.MeshBasicNodeMaterial({ color: 0xb9ae45 });
  // Static geometry is merged by material after placement; small props don't each cost a draw call.
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0) => {
    parent.updateMatrixWorld(true);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x,y,z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,0)), new THREE.Vector3(1,1,1));
    g.applyMatrix4(parent.matrixWorld.clone().multiply(m));
    const list = batches.get(mat) ?? []; list.push(g); batches.set(mat,list);
  };
  const box = (p: THREE.Object3D, mat: THREE.Material, w: number,h: number,d: number,x: number,y: number,z: number,rx=0,ry=0) =>
    add(new THREE.BoxGeometry(w,h,d),mat,p,x,y,z,rx,ry);
  const label = (text: string, sub: string, tint: number, w: number) => {
    const c = document.createElement('canvas'); c.width=1024; c.height=256;
    const a=c.getContext('2d')!; a.fillStyle='#08101b'; a.fillRect(0,0,1024,256);
    const hex='#'+tint.toString(16).padStart(6,'0');
    a.strokeStyle=hex; a.lineWidth=7; a.strokeRect(8,8,1008,240);
    a.fillStyle=hex; a.font='italic 900 66px sans-serif'; a.fillText(text,38,112,950);
    a.fillStyle='#ced8dd'; a.font='26px monospace'; a.fillText(sub,42,195,940);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w,w/4),new THREE.MeshBasicNodeMaterial({map:t}));
  };
  const poster = (name: string,w=2.2) => {
    const t=loader.load('/night/ads/'+name); t.colorSpace=THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w,w*.67),new THREE.MeshBasicNodeMaterial({map:t}));
  };
  // Existing skyline/storefront architecture stays behind the counters.
  for (const [dx,side,w,h,seed] of [[-14,1,30,14,2],[18,1,26,11,3],[-10,-1,34,12,1],[24,-1,22,16,0]]) {
    const b=facadeBlock(w,h,16,ctx.tex,seed,side>0?'nz':'pz',side>0?0xc867c4:0x5fced8);
    b.position.set(50+dx,CURB_H,-228+side*22.5); group.add(b);
  }
  const lights: DistrictBuild['lights']=[];
  for (const [i,s] of MARKET_STALLS.entries()) {
    const p=new THREE.Group(); p.position.set(s.x,CURB_H,s.z); p.rotation.y=s.yaw; group.add(p);
    const trim=new THREE.MeshBasicNodeMaterial({color:s.accent});
    // Recessed back wall, waist-high counter, angled metal awning and exposed service box.
    box(p,panel,6,3.6,.18,0,1.8,-1.8);
    box(p,metal,6,1.02,1.1,0,.51,1);
    box(p,rubber,6.2,.12,1.3,0,1.08,1);
    box(p,trim,5.8,.055,.045,0,.92,1.57);
    box(p,metal,6.7,.18,4.2,0,3.7,0,-.10);
    box(p,trim,6.6,.07,.07,0,3.41,2.07);
    for(const x of [-3,3]) { box(p,metal,.13,3.6,.13,x,1.8,1.6); box(p,yellow,.14,.22,.15,x,.6,1.61); }
    box(p,metal,.7,1.15,.45,2.5,2.8,-1.45);
    for(let k=0;k<4;k++) box(p,trim,.32,.04,.03,2.5,2.45+k*.16,-1.2);
    const sign=label(s.name,['HOT FOOD / NIGHT SHIFT','DIAGNOSTICS / PARTS','PLAY / TRADE / REPAIR','LISTEN / CONNECT','STREETWEAR / AUGMENTS','COLD DRINKS / RECHARGE'][i],s.accent,5.5);
    sign.position.set(0,3.02,1.75); p.add(sign);
    if(s.kind==='audio'||s.kind==='repair') {
      const art=poster(s.kind==='audio'?'product-headphones-v2.webp':'product-computer-v2.webp',2.4);
      art.position.set(-1.25,2.55,-1.67); p.add(art);
    }
    if(s.kind==='food') {
      for(let k=0;k<5;k++) {
        add(new THREE.CylinderGeometry(.24,.13,.14,12),ceramic,p,-2+k,1.2,1.05);
        box(p,yellow,.5,.025,.025,-2+k,1.29,1.05,0,.18);
      }
      for(const x of [-1.9,0,1.9]) {
        add(new THREE.CylinderGeometry(.32,.32,.12,12),rubber,p,x,.7,2.7);
        add(new THREE.CylinderGeometry(.07,.1,.65,8),metal,p,x,.33,2.7);
      }
      // Short noren curtain strips, above head height.
      for(let k=0;k<6;k++) box(p,panel,.8,.5,.035,-2.4+k*.96,3.13,1.8);
    } else if(s.kind==='drinks') {
      box(p,metal,1.5,2.4,.9,-1.7,1.2,-1.2);
      box(p,trim,1.25,1.6,.025,-1.7,1.35,-.73);
      for(let k=0;k<8;k++) {
        add(new THREE.CylinderGeometry(.12,.12,.35,10),k%2?trim:ceramic,p,-2.5+k*.68,1.32,1);
      }
    } else if(s.kind==='wear') {
      box(p,metal,4.5,.08,.08,0,2.9,-.65);
      for(let k=0;k<4;k++) {
        const x=-1.7+k*1.1;
        box(p,k%2?panel:rubber,.65,1.05,.22,x,2.12,-.65);
        box(p,trim,.45,.045,.03,x,2.28,-.51);
        box(p,panel,.22,.8,.24,x-.42,2.05,-.65,0,.2);
        box(p,panel,.22,.8,.24,x+.42,2.05,-.65,0,-.2);
      }
    } else if(s.kind==='audio') {
      for(let k=0;k<3;k++) {
        add(new THREE.TorusGeometry(.29,.035,6,16),trim,p,-1.8+k*1.7,1.6,1.05);
        for(const dx of [-.26,.26]) box(p,rubber,.14,.3,.2,-1.8+k*1.7+dx,1.48,1.05);
        box(p,metal,.06,.4,.06,-1.8+k*1.7,1.32,.94);
      }
    } else {
      for(let k=0;k<4;k++) {
        box(p,metal,.9,.09,.55,-2+k*1.3,1.18,1,0,.12);
        box(p,trim,.55,.015,.36,-2+k*1.3,1.235,1,0,.12);
      }
      if(s.kind==='repair') for(let k=0;k<4;k++) box(p,ceramic,.08,.48,.06,.5+k*.3,2.3,-1.65);
    }
    lights.push([s.x,3.2,s.z+Math.cos(s.yaw)*2.2,s.accent,140,9]);
  }
  // Lanterns and exposed catenary cables; high enough to keep every sign readable.
  for(const x of [28,46,64,80]) {
    group.add(stringLights(new THREE.Vector3(x,6,-241),new THREE.Vector3(x,6,-215),9,.75,.14,0xffb66d,1));
    group.add(stringLights(new THREE.Vector3(x+.18,6.3,-241),new THREE.Vector3(x+.18,6.3,-215),28,.95,.035,0x10141c,.35));
  }
  for(const b of MARKET_BOLLARDS) {
    add(new THREE.CylinderGeometry(.14,.18,1,8),metal,group,b.x,.5,b.z);
    add(new THREE.CylinderGeometry(.15,.15,.12,8),yellow,group,b.x,.77,b.z);
  }
  // Seating bays at the far end, never across the through-route.
  for(const z of [-234.5,-221.5]) {
    box(group,metal,1.2,.12,3,79,.55,z);
    box(group,panel,.12,.6,3,79.55,.86,z);
    for(const dz of [-1,1]) box(group,metal,.75,.5,.12,79,.25,z+dz);
  }
  const gate=label('AFTERHOURS MARKET','PEDESTRIAN LANE / OPEN ALL NIGHT',0xe176cb,8);
  gate.position.set(81,6.4,-228); gate.rotation.y=-Math.PI/2; group.add(gate);
  for(const z of [-234,-222]) box(group,metal,.16,7,.16,81,3.5,z);
  box(group,metal,.16,.16,12,81,7,-228);
  for(const [mat,geos] of batches) {
    const merged=mergeGeometries(geos,false);
    if(merged) group.add(new THREE.Mesh(merged,mat));
    geos.forEach(g=>g.dispose());
  }
  return {group,props:[],lights};
}

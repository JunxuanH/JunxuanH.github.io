import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DOWNTOWN_LOBBIES, DOWNTOWN_DEPTH, DOWNTOWN_CENTER_X } from '../building-layout';
import { DOWNTOWN_ASSETS, DOWNTOWN_PROPS, DOWNTOWN_INFILL, DOWNTOWN_UPPER_HEIGHTS } from '../downtown-layout';
import { CURB_H } from '../streets';
import { facadeBlock, type DistrictCtx } from './shared';

export async function downtownDetail(ctx: DistrictCtx) {
  const group = new THREE.Group(); group.name = 'Downtown corporate frontage';
  const metal = new THREE.MeshStandardNodeMaterial({color:0x364453,roughness:.65,metalness:.3});
  const dark = new THREE.MeshStandardNodeMaterial({color:0x101a25,roughness:.8});
  const warm = new THREE.MeshBasicNodeMaterial({color:0xbdb29c});
  const cyan = new THREE.MeshBasicNodeMaterial({color:0x65becb});
  const pink = new THREE.MeshBasicNodeMaterial({color:0xb16eab});
  const leaves = new THREE.MeshStandardNodeMaterial({color:0x45685d,roughness:.9});
  const batches = new Map<THREE.Material,THREE.BufferGeometry[]>();
  function box(p:THREE.Object3D,mat:THREE.Material,w:number,h:number,d:number,x:number,y:number,z:number) {
    p.updateWorldMatrix(true,false);
    const geo = new THREE.BoxGeometry(w,h,d).translate(x,y,z).applyMatrix4(p.matrixWorld);
    const list=batches.get(mat)??[]; list.push(geo); batches.set(mat,list);
  }
  function sign(p:THREE.Object3D,title:string,sub:string,w:number,x:number,y:number,z:number) {
    const c=document.createElement('canvas'); c.width=1024;c.height=256;
    const g=c.getContext('2d')!;
    g.fillStyle='#0b1721';g.fillRect(0,0,1024,256);
    g.strokeStyle='#72cbd5';g.lineWidth=5;g.strokeRect(6,6,1012,244);
    g.fillStyle='#e0ebeb';g.font='bold 65px monospace';g.fillText(title,35,104,950);
    g.fillStyle='#a1bfc5';g.font='27px monospace';g.fillText(sub,38,184,950);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,w/4),new THREE.MeshBasicNodeMaterial({map:tex}));
    mesh.position.set(x,y,z);p.add(mesh);
  }
  for(const [i,[side,z,w]] of DOWNTOWN_LOBBIES.entries()) {
    const p=new THREE.Group();p.position.set(side*DOWNTOWN_CENTER_X,CURB_H,z);p.rotation.y=side<0?Math.PI/2:-Math.PI/2;group.add(p);
    // Stack within the existing lobby footprint, not new lots beside the campus.
    // Elevated floors use only the window atlas; storefront doors belong at street level.
    const upperHeight=DOWNTOWN_UPPER_HEIGHTS[i];
    const upper=facadeBlock(w,upperHeight,DOWNTOWN_DEPTH,ctx.tex,i,null,side<0?0x9364a7:0x63b9c6);
    upper.position.y=7;p.add(upper);
    const crown=facadeBlock(w*.68,5,8,ctx.tex,i+1,null,0x628b9c);crown.position.set(0,7+upperHeight,-1);p.add(crown);
    box(p,metal,w*.72,.35,3,0,4.8,7.5);
    box(p,side<0?pink:cyan,w*.72,.06,.08,0,4.65,9.02);
    for(const dx of [-w*.28,w*.28]) {
      box(p,metal,2.4,1.1,2,dx,8+upperHeight,0);
      for(let k=0;k<5;k++) box(p,dark,1.9,.07,.12,dx,8.57+upperHeight,-.7+k*.35);
    }
    sign(p,['NORTHSTAR / HQ','VECTOR SYSTEMS','NEXUS / OFFICES','ARC / LOGISTICS'][i],
      i===1?'AUDIO · COMPUTE · PERSONAL TECH':'CORPORATE CAMPUS / AUTHORIZED ENTRY',Math.min(w-3,12),0,6.1,7.12);
    for(const dx of [-w*.32,w*.32]) {
      box(p,dark,3,2.2,.25,dx,2.1,7.15);
      box(p,warm,2.65,.08,.25,dx,3.16,7.32);
      box(p,metal,2.65,.15,.65,dx,1.05,7.4);
      for(let j=0;j<3;j++) {
        box(p,metal,.48,.55,.22,dx-.8+j*.8,1.42,7.55);
        box(p,j===1?pink:cyan,.36,.3,.03,dx-.8+j*.8,1.46,7.68);
      }
    }
  }
  for(const [i,s] of DOWNTOWN_INFILL.entries()) {
    const tower=facadeBlock(s.w,s.h,s.d,ctx.tex,i+2,null,i%2?0x63b9c6:0x9364a7);
    tower.position.set(s.x,CURB_H,s.z);group.add(tower);
  }
  for(const s of DOWNTOWN_PROPS) {
    const p=new THREE.Group();p.position.set(s.x,CURB_H,s.z);group.add(p);
    if(s.kind==='bench') {
      box(p,metal,s.w,.15,s.d,0,.5,0);box(p,metal,.12,.6,s.d,-.49,.8,0);
      for(const z of [-1.5,1.5]) box(p,dark,.7,.45,.2,0,.22,z);
    } else if(s.kind==='planter') {
      box(p,metal,s.w,.7,s.d,0,.35,0);box(p,leaves,s.w*.8,.7,s.d*.8,0,1.05,0);
    } else {
      box(p,metal,s.w,s.h,s.d,0,s.h/2,0);
      const face=new THREE.Group();face.rotation.y=s.x>0?-Math.PI/2:Math.PI/2;p.add(face);
      sign(face,s.kind==='lockers'?'PARCEL / 24':'GRID / 09',s.kind==='lockers'?'SECURE DELIVERY':'SERVICE ACCESS',s.d*.85,0,s.h*.76,s.w/2+.02);
      if(s.kind==='lockers') for(let k=0;k<4;k++) for(let j=0;j<2;j++) {
        box(p,dark,.03,.64,.86,-s.w/2-.02,.48+j*.75,-1.5+k);
        box(p,cyan,.04,.04,.18,-s.w/2-.04,.48+j*.75,-1.3+k);
      }
    }
  }
  await Promise.all(DOWNTOWN_ASSETS.map(async a=>{
    try {
      const {scene}=await new GLTFLoader().loadAsync(`/night/downtown/${a.file}.glb`);
      const bounds=new THREE.Box3().setFromObject(scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      const scale=new THREE.Vector3(a.w/size.x,a.h/size.y,a.d/size.z);
      scene.scale.copy(scale);scene.position.set(-center.x*scale.x,-bounds.min.y*scale.y,-center.z*scale.z);
      scene.traverse((o:any)=>{if(o.isMesh){o.geometry.computeVertexNormals();o.material=metal;}});
      const p=new THREE.Group();p.position.set(a.x,CURB_H,a.z);p.rotation.y=a.yaw;p.add(scene);group.add(p);
      if(a.file==='shelter') {
        sign(p,'NEON TRANSIT','09  DOWNTOWN → HARBOR',a.w*.85,0,a.h+.35,a.d/2+.03);
        box(p,cyan,a.w*.85,.055,.07,0,a.h+.35+a.w*.85/8+.1,a.d/2+.05);
        sign(p,'09 / CITY LOOP','CAMPUS · DOWNTOWN · HARBOR',3.1,.2,1.9,-.4);
      } else {
        // The lobby already carries the showroom name; keep its entrance quiet.
        for(const x of [-a.w*.42,a.w*.42])
          box(p,cyan,.055,a.h*.65,.07,x,a.h*.48,a.d/2+.05);
      }
    } catch(e) {console.warn('[downtown] asset unavailable',a.file,e);}
  }));
  for(const [material,geometries] of batches) {
    group.add(new THREE.Mesh(mergeGeometries(geometries,false)!,material));
    geometries.forEach(g=>g.dispose());
  }
  return group;
}

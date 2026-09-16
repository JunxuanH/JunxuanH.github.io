import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Solid service core inside the existing glass shell; no changes to the street footprint. */
export function officeCore(w:number,h:number,d:number) {
  const group=new THREE.Group();group.name='Office elevator and service core';
  const concrete=new THREE.MeshStandardNodeMaterial({color:0x333c49,roughness:.82,metalness:.12});
  const steel=new THREE.MeshStandardNodeMaterial({color:0x65717d,roughness:.48,metalness:.65});
  const recess=new THREE.MeshStandardNodeMaterial({color:0x080e16,roughness:.8});
  const light=new THREE.MeshBasicNodeMaterial({color:0x92c9d1});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  function box(mat:THREE.Material,bw:number,bh:number,bd:number,x:number,y:number,z:number) {
    const parts=batches.get(mat)??[];
    parts.push(new THREE.BoxGeometry(bw,bh,bd).translate(x,y,z));batches.set(mat,parts);
  }
  const coreWidth=Math.min(w*.55,11),front=1;
  box(concrete,coreWidth,h,4,0,h/2,front-2);
  // Opaque rear service wall stops the lobby reading like an empty glass aquarium.
  box(concrete,w-.4,h,.4,0,h/2,-d/2+.4);
  for(const x of [-coreWidth*.25,coreWidth*.25]) {
    box(recess,2.3,3.4,.08,x,1.8,front+.045);
    for(const side of [-1,1]) {
      box(steel,.94,2.9,.06,x+side*.49,1.65,front+.1);
      box(steel,.12,3.4,.18,x+side*1.16,1.8,front+.12);
    }
    box(steel,2.44,.12,.18,x,3.5,front+.12);
    box(steel,2.4,.08,.5,x,.22,front+.18);
    box(recess,1.1,.5,.09,x,3.95,front+.08);
    // Restrained, non-flashing 01 floor display made from geometry.
    for(const dx of [-.29,-.03,.3]) box(light,.035,.26,.02,x+dx,3.95,front+.14);
    for(const dy of [-.13,.13]) box(light,.26,.035,.02,x-.16,3.95+dy,front+.14);
    box(recess,.2,.55,.08,x+1.45,1.5,front+.08);
    box(light,.07,.07,.025,x+1.45,1.6,front+.14);
    box(light,.07,.07,.025,x+1.45,1.4,front+.14);
  }
  // Vertical reveals emphasize the load-bearing core continuing into the upper floors.
  for(const x of [-coreWidth/2+.18,coreWidth/2-.18]) box(steel,.12,h,.08,x,h/2,front+.06);
  for(const [mat,parts] of batches) {
    group.add(new THREE.Mesh(mergeGeometries(parts,false)!,mat));parts.forEach(g=>g.dispose());
  }
  return group;
}

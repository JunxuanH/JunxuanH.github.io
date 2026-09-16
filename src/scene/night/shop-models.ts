import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ShopModel = 'mask'|'headphones'|'console';
const cache=new Map<ShopModel,Promise<THREE.Group>>();
/** Tiny untextured Fal meshes. One shared geometry/material per product, recoloured locally. */
export async function loadShopModel(id:ShopModel):Promise<THREE.Group> {
  if(!cache.has(id)) cache.set(id,(async()=>{
    const {scene}=await new GLTFLoader().loadAsync(`/night/shop-models/${id}.glb`);
    scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(scene), size=bounds.getSize(new THREE.Vector3());
    const centre=bounds.getCenter(new THREE.Vector3()), scale=1/Math.max(size.x,size.y,size.z);
    const group=new THREE.Group();
    const dark=new THREE.Color('#283647'),cyan=new THREE.Color('#44c4d6'),pink=new THREE.Color('#b958bc'),silver=new THREE.Color('#99b1bd');
    scene.traverse(o=>{
      if(!(o as THREE.Mesh).isMesh)return;
      const mesh=o as THREE.Mesh;
      const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geometry.translate(-centre.x,-centre.y,-centre.z).scale(scale,scale,scale);
      geometry.computeVertexNormals();
      const p=geometry.getAttribute('position'), colors=new Float32Array(p.count*3);
      for(let i=0;i<p.count;i++) {
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
        let c=dark;
        if(id==='mask') c=Math.abs(x)>.34?pink:y>.23?cyan:Math.abs(x)<.09?silver:dark;
        if(id==='headphones') c=Math.abs(x)>.27?cyan:y>.25?silver:dark;
        if(id==='console') c=z>.04&&y>.02&&Math.abs(x)<.23?dark:y<-.10&&z>.04?cyan:pink;
        c.toArray(colors,i*3);
      }
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
      const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.35});
      group.add(new THREE.Mesh(geometry,material));
      mesh.geometry.dispose();
      const old=Array.isArray(mesh.material)?mesh.material:[mesh.material];old.forEach(m=>m.dispose());
    });
    if(!group.children.length)throw new Error('Empty shop model');
    if(id==='console') {
      // The generated inset has no screen material. Add a fitted glass face and a restrained status line.
      const screen=new THREE.Mesh(new THREE.PlaneGeometry(.57,.38),new THREE.MeshStandardMaterial({color:0x071b26,roughness:.24,metalness:.2,emissive:0x123f4a,emissiveIntensity:.3}));
      screen.position.set(0,.18,.086);group.add(screen);
      const status=new THREE.Mesh(new THREE.PlaneGeometry(.34,.012),new THREE.MeshBasicMaterial({color:0x56cfdd}));
      status.position.set(0,.08,.087);group.add(status);
    }
    return group;
  })().catch(error=>{cache.delete(id);throw error;}));
  return (await cache.get(id)!).clone(true);
}

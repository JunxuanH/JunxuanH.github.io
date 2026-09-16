import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadShopModel, type ShopModel } from './shop-models';

/** One on-demand canvas, rendered only on interaction/resize; no extra perpetual animation loop. */
export function showShopModel(host:HTMLElement,id:ShopModel,onReady?:()=>void) {
  let disposed=false, renderer:THREE.WebGPURenderer|undefined, controls:OrbitControls|undefined;
  let observer:ResizeObserver|undefined;
  const note=document.createElement('p');note.textContent='Loading 3D preview…';note.setAttribute('role','status');host.append(note);
  const dispose=()=>{disposed=true;observer?.disconnect();controls?.dispose();renderer?.dispose();host.replaceChildren();};
  (async()=>{
    try {
      const model=await loadShopModel(id);if(disposed)return;
      renderer=new THREE.WebGPURenderer({antialias:true,alpha:true,forceWebGL:true});
      await renderer.init();if(disposed){renderer.dispose();return;}
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      const scene=new THREE.Scene();scene.add(model);
      scene.add(new THREE.HemisphereLight(0xe5f7ff,0x263349,2.6));
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,3,4);scene.add(light);
      const rim=new THREE.DirectionalLight(0xd68fc9,1.2);rim.position.set(-2,1,-2);scene.add(rim);
      const camera=new THREE.PerspectiveCamera(38,1,.01,20);camera.position.set(.8,.35,1.9);
      const canvas=renderer.domElement;canvas.setAttribute('aria-label','Rotatable 3D product preview');
      host.replaceChildren(canvas,note);note.textContent='Drag to rotate · pinch or scroll to zoom';
      controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.minDistance=1.1;controls.maxDistance=3.5;
      const draw=()=>{if(!disposed)renderer!.render(scene,camera);};
      controls.addEventListener('change',draw);
      const resize=()=>{const w=host.clientWidth||280;renderer!.setSize(w,280);camera.aspect=w/280;camera.updateProjectionMatrix();draw();};
      observer=new ResizeObserver(resize);observer.observe(host);controls.update();resize();
      onReady?.();
      const actions=document.createElement('div');
      for(const [label,angle] of [['Rotate left',-.4],['Rotate right',.4]] as const){
        const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{model.rotation.y+=angle;draw();};actions.append(b);
      }
      host.append(actions);
    } catch(error) {
      controls?.dispose();observer?.disconnect();renderer?.dispose();
      if(!disposed){host.replaceChildren(note);note.textContent='3D preview unavailable. The product illustration is shown above.';}
      console.warn('[shop preview]',error);
    }
  })();
  return dispose;
}

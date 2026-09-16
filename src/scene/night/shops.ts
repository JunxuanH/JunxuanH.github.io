import { MARKET_STALLS } from './market-layout';
import { SHOPS, itemArtwork, shopInReach, ITEM_MODELS } from './shop-catalogue';
import '../../styles/shops.css';

export function createShops(opts: { prompt(s:string|null):void; available(i:number):boolean; owner(i:number,active:boolean):void }) {
  const dialog=document.createElement('dialog'); dialog.className='shop-panel';
  dialog.setAttribute('aria-labelledby','shop-heading'); document.body.append(dialog);
  let active=-1, page:'talk'|'browse'|'detail'='browse';
  let restore:HTMLElement|null=null;
  let disposePreview:(()=>void)|undefined;
  let previewVersion=0;
  const clearPreview=()=>{previewVersion++;disposePreview?.();disposePreview=undefined;};
  const el=(tag:string,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const button=(text:string,fn:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;};
  function close() {
    clearPreview();
    if(active>=0) opts.owner(active,false);
    active=-1; dialog.close(); document.documentElement.classList.remove('shop-open');
    restore?.focus({preventScroll:true}); opts.prompt(null);
  }
  function art(index:number) {
    const n=el('div','','shop-item-art'); n.setAttribute('aria-hidden','true');
    const artwork=itemArtwork(index);
    n.style.backgroundImage=`url("${artwork.url}")`;
    n.style.backgroundPosition=artwork.position;
    return n;
  }
  function render(next:typeof page, item=0) {
    clearPreview();
    page=next; dialog.replaceChildren();
    const stall=MARKET_STALLS[active], shop=SHOPS[stall.kind];
    dialog.style.setProperty('--shop-accent','#'+stall.accent.toString(16).padStart(6,'0'));
    dialog.append(el('p',`${shop.owner} / AFTERHOURS MARKET`,'shop-kicker'));
    const h=el('h2',stall.name);h.id='shop-heading';dialog.append(h);
    dialog.append(button('Leave shop',close));
    {
      dialog.append(page==='browse' ? button(`Talk to ${shop.owner}`,()=>render('talk')) : button('← Back to inventory',()=>render('browse')));
      if(page==='talk') {
        const speech=el('p','What would you like to know?','shop-speech');speech.setAttribute('aria-live','polite');
        for(const [topic,line] of shop.topics) dialog.append(button(topic,()=>{speech.textContent=line;}));
        dialog.append(speech);
      } else if(page==='browse') {
        dialog.append(el('p',shop.greeting,'shop-greeting'),el('p','INVENTORY / TAKE A CLOSER LOOK','shop-kicker'));
        const grid=el('div','','shop-items');
        shop.items.forEach((entry,i)=>{const b=button('',()=>render('detail',i));b.append(art(entry.art),el('strong',entry.name),el('span',entry.description));grid.append(b);});
        dialog.append(grid);
      } else {
        const entry=shop.items[item], illustration=art(entry.art);dialog.append(illustration,el('h3',entry.name),el('p',entry.description),el('p',`${shop.owner}: “${entry.remark}”`,'shop-speech'));
        const model=ITEM_MODELS[entry.art];
        if(model) {
          const host=el('div','','shop-model-preview');
          const version=previewVersion;
          const view=button('View coloured 3D model',async()=>{
            view.disabled=true;
            try {
              const {showShopModel}=await import('./shop-model-viewer');
              if(version!==previewVersion)return;
              disposePreview=showShopModel(host,model,()=>{illustration.hidden=true;host.scrollIntoView({block:'nearest'});});
            } catch {if(version===previewVersion){host.textContent='3D preview unavailable. Please try again.';view.disabled=false;}}
          });
          dialog.append(view,host);
        }
      }
    }
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
  }
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  // Do not leak key or pointer controls into the world; retain native button and Tab behaviour.
  for(const event of ['keydown','pointerdown','pointermove','pointerup']) dialog.addEventListener(event,e=>e.stopPropagation());
  return {
    get open(){return dialog.open;}, close,
    update(p:{x:number;z:number},yaw:number,enabled:boolean,interact:boolean) {
      if(!enabled || document.documentElement.classList.contains('resume-open')) {if(dialog.open)close();opts.prompt(null);return false;}
      if(dialog.open) {
        const s=MARKET_STALLS[active];
        if(Math.hypot(p.x-s.x,p.z-s.z)>7)close();
        return true;
      }
      const i=shopInReach(p,yaw,opts.available);
      opts.prompt(i<0?null:`TALK TO ${SHOPS[MARKET_STALLS[i].kind].owner.toUpperCase()}`);
      if(i<0)return false;
      if(interact) {
        active=i; restore=document.activeElement as HTMLElement;
        opts.owner(i,true);document.documentElement.classList.add('shop-open');
        render('browse');dialog.showModal();dialog.querySelector<HTMLButtonElement>('button')?.focus();opts.prompt(null);
      }
      return true;
    },
  };
}

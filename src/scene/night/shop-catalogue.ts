import { MARKET_STALLS } from './market-layout';

export type ShopKind = typeof MARKET_STALLS[number]['kind'];
export const SHOP_ATLAS = '/night/ads/market-items-atlas.webp';
export const SHOPS: Record<ShopKind, { owner: string; greeting: string; topics: [string,string][]; items: { name: string; description: string; remark: string; art: number }[] }> = {
  food: { owner:'Mika', greeting:'Come in out of the rain. The broth has been going since sundown.', topics:[['What is cooking?', 'Night Shift is our house bowl. Chili Boost uses the same broth with toasted peppers. Both come with an extra egg.'], ['Life at the market', 'The repair crew eats here after closing. They fix my induction hob; I keep them fed.']], items:[
    {name:'Night Shift Bowl',description:'Slow broth, spring noodles, greens and a soft egg.',remark:'A warm reset after a long day.',art:0},
    {name:'Chili Boost Bowl',description:'Our house bowl with roasted chili oil and toasted peppers.',remark:'Same bowl, extra heat. Keep a drink nearby.',art:0}] },
  repair: { owner:'Patch', greeting:'Nothing is obsolete until I have had a look at it.', topics:[['What do you repair?', 'Decks, ports, cooling loops. Start with a diagnosis, not a replacement.'], ['A little engineering advice', 'Measure the bottleneck before changing parts. The project terminal in the centre has more things built with that mindset.']], items:[
    {name:'Link-6 Module',description:'A pocket bridge for six generations of mismatched connectors.',remark:'The adapter you wish you packed.',art:1},
    {name:'Link-6 Diagnostic Edition',description:'The same module with loopback testing and a readable status light.',remark:'Find the bad connection before taking everything apart.',art:1}] },
  games: { owner:'Byte', greeting:'One more round? That is how everybody ends up here until sunrise.', topics:[['What is on the deck?', 'Tiny arcade games, local saves, physical buttons. Nothing needs a login.'], ['Something to build?', 'Try the project terminal in the square. Chordsmith is a different kind of playground: words and chords instead of high scores.']], items:[
    {name:'Pocket Arcade',description:'A compact handheld with tactile buttons and a bright night-mode display.',remark:'For the last train home.',art:2},
    {name:'Pocket Arcade — Rhythm',description:'A rhythm-focused firmware edition of the same handheld.',remark:'Headphones recommended. Your neighbours will thank you.',art:2}] },
  audio: { owner:'Echo', greeting:'The city is loud. Your music does not have to fight it.', topics:[['What should I listen for?', 'Comfort first. Then a clear midrange and bass that leaves room for everything else.'], ['After-hours listening', 'The noodle cook likes old synth records. I trade listening sessions for dinner.']], items:[
    {name:'Quietline Headphones',description:'Closed-back over-ear headphones with soft replaceable cushions.',remark:'A little quiet in a very busy city.',art:3},
    {name:'Quietline Studio',description:'The same comfortable shell, tuned for a more neutral studio mix.',remark:'Hear the details, not just the glow.',art:3}] },
  wear: { owner:'Kitsune', greeting:'Rainproof, repairable, and unmistakably yours.', topics:[['Why the fox mask?', 'A little theatre, a replaceable filter, and a silhouette you can spot across the lane.'], ['Built to last', 'Replace the straps before you replace the whole mask. Patch has the tools; I have the spares.']], items:[
    {name:'Foxfilter Mask',description:'An angular streetwear respirator concept with replaceable side filters.',remark:'Fictional gear, not real protective equipment.',art:4},
    {name:'Foxfilter — Night Shift',description:'A night-shift edition of the same shell with low-output illuminated seams.',remark:'Visible in the rain, without lighting up the whole street.',art:4}] },
  drinks: { owner:'Fizz', greeting:'Cold cans, warm welcome. What are you in the mood for?', topics:[['Pick a flavour', 'Citrus Static is sharp and bright. Plum Frequency is softer, with a dry finish.'], ['Who keeps this place awake?', 'Mostly the conversations. The cans are just an excuse to stop for a minute.']], items:[
    {name:'Citrus Static',description:'A lime-and-yuzu soda in a returnable neon can.',remark:'Pairs with the chili bowl across the lane.',art:5},
    {name:'Plum Frequency',description:'A plum-and-ginger variant in the same returnable can.',remark:'A quieter kind of fizz.',art:5}] },
};

/** Approach anchor is outside the counter; the owner behind it is not the distance target. */
export function shopInReach(p: {x:number;z:number}, yaw: number, available: (i:number)=>boolean = ()=>true) {
  let best=-1, distance=Infinity;
  MARKET_STALLS.forEach((s,i)=>{
    if(!available(i)) return;
    const nx=Math.sin(s.yaw), nz=Math.cos(s.yaw);
    const dx=p.x-s.x,dz=p.z-s.z;
    if(dx*nx+dz*nz<1.5) return; // never through the rear wall
    const ax=s.x+nx*2.5, az=s.z+nz*2.5, d=Math.hypot(p.x-ax,p.z-az);
    const to=Math.hypot(dx,dz)||1;
    if(d<2.7 && d<distance && (-dx*Math.sin(yaw)-dz*Math.cos(yaw))/to>.25) {best=i;distance=d;}
  });
  return best;
}

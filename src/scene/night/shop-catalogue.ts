import { MARKET_STALLS } from './market-layout';

export type ShopKind = typeof MARKET_STALLS[number]['kind'];
export const SHOP_ATLAS = '/night/ads/market-items-atlas.webp';
export const SHOP_ATLASES = [SHOP_ATLAS, '/night/ads/market-items-atlas-2.webp', '/night/ads/market-items-atlas-3.webp'];
export function itemArtwork(index: number) {
  const cell=index%6;
  return {url:SHOP_ATLASES[Math.floor(index/6)],position:`${(cell%3)*50}% ${Math.floor(cell/3)*100}%`};
}
export const SHOPS: Record<ShopKind, { owner: string; greeting: string; topics: [string,string][]; items: { name: string; description: string; remark: string; art: number }[] }> = {
  food: { owner:'Mika', greeting:'Come in out of the rain. The broth has been going since sundown.', topics:[['What is cooking?', 'Night Shift is our house bowl. Chili Boost uses the same broth with toasted peppers. Both come with an extra egg.'], ['Life at the market', 'The repair crew eats here after closing. They fix my induction hob; I keep them fed.']], items:[
    {name:'Night Shift Bowl',description:'Slow broth, spring noodles, greens and a soft egg.',remark:'A warm reset after a long day.',art:0},
    {name:'Midnight Dumplings',description:'A bamboo steamer of handmade vegetable dumplings.',remark:'Best shared, but I will not judge.',art:6},
    {name:'Neon Grill Skewers',description:'Smoky glazed skewers, grilled to order.',remark:'The late-night favourite.',art:12}] },
  repair: { owner:'Patch', greeting:'Nothing is obsolete until I have had a look at it.', topics:[['What do you repair?', 'Decks, ports, cooling loops. Start with a diagnosis, not a replacement.'], ['A little engineering advice', 'Measure the bottleneck before changing parts. The project terminal in the centre has more things built with that mindset.']], items:[
    {name:'Link-6 Module',description:'A pocket bridge for six generations of mismatched connectors.',remark:'The adapter you wish you packed.',art:1},
    {name:'Pocket Repair Kit',description:'Precision drivers, probes and bits in a folding case.',remark:'Start with the right tool.',art:7},
    {name:'Copperflow Cooler',description:'A compact fan and copper heatsink for overworked electronics.',remark:'Give that processor some breathing room.',art:13}] },
  games: { owner:'Byte', greeting:'One more round? That is how everybody ends up here until sunrise.', topics:[['What is on the deck?', 'Tiny arcade games, local saves, physical buttons. Nothing needs a login.'], ['Something to build?', 'Try the project terminal in the square. Chordsmith is a different kind of playground: words and chords instead of high scores.']], items:[
    {name:'Pocket Arcade',description:'A compact handheld with tactile buttons and a bright night-mode display.',remark:'For the last train home.',art:2},
    {name:'Neon Gamepad',description:'A wireless controller with tactile triggers and a low-latency link.',remark:'Bring a friend for player two.',art:8},
    {name:'Circuit Quest Cartridge',description:'A physical game cartridge with an illuminated circuit window.',remark:'No download queue. Just plug in and play.',art:14}] },
  audio: { owner:'Echo', greeting:'The city is loud. Your music does not have to fight it.', topics:[['What should I listen for?', 'Comfort first. Then a clear midrange and bass that leaves room for everything else.'], ['After-hours listening', 'The noodle cook likes old synth records. I trade listening sessions for dinner.']], items:[
    {name:'Quietline Headphones',description:'Closed-back over-ear headphones with soft replaceable cushions.',remark:'A little quiet in a very busy city.',art:3},
    {name:'Pocket Synth',description:'A portable keyboard with hands-on sound controls and a step sequencer.',remark:'Make the soundtrack for your walk home.',art:9},
    {name:'Signal Buds',description:'Compact wireless earbuds in a pocket charging case.',remark:'Travel light without leaving the music behind.',art:15}] },
  wear: { owner:'Kitsune', greeting:'Rainproof, repairable, and unmistakably yours.', topics:[['Why the fox mask?', 'A little theatre, a replaceable filter, and a silhouette you can spot across the lane.'], ['Built to last', 'Replace the straps before you replace the whole mask. Patch has the tools; I have the spares.']], items:[
    {name:'Foxfilter Mask',description:'An angular streetwear respirator concept with replaceable side filters.',remark:'Fictional gear, not real protective equipment.',art:4},
    {name:'Signal Jacket',description:'A technical bomber jacket with cyan seams and utility pockets.',remark:'The city never checks the weather forecast.',art:10},
    {name:'Circuit Gloves',description:'Fingerless utility gloves with padded knuckles and conductive fingertips.',remark:'Built for repairs on the move.',art:16}] },
  drinks: { owner:'Fizz', greeting:'Cold cans, warm welcome. What are you in the mood for?', topics:[['Pick a flavour', 'Citrus Static is sharp and bright. Plum Frequency is softer, with a dry finish.'], ['Who keeps this place awake?', 'Mostly the conversations. The cans are just an excuse to stop for a minute.']], items:[
    {name:'Citrus Static',description:'A lime-and-yuzu soda in a returnable neon can.',remark:'Pairs with the chili bowl across the lane.',art:5},
    {name:'Plum Frequency Tea',description:'Chilled plum tea in a returnable glass bottle.',remark:'A quieter kind of refreshment.',art:11},
    {name:'Night Pearl Milk Tea',description:'Creamy iced milk tea with dark tapioca pearls.',remark:'Take the long way home and enjoy it.',art:17}] },
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

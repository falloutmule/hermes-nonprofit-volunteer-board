import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe,it,expect } from 'vitest';

async function render(events:unknown[]) {
 const root={innerHTML:''};
 const html=readFileSync('public/calendar/index.html','utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
 runInNewContext(script,{document:{querySelector:()=>root},fetch:async()=>({ok:true,json:async()=>({events})}),Date,Promise,encodeURIComponent});
 await new Promise(resolve=>setImmediate(resolve));
 return root.innerHTML;
}
describe('category public presentation',()=>{
 it('shows separate categories and safely encoded SMS discovery links',async()=>{
  const html=await render([{name:'Saturday Feed',startsAt:'2026-10-03T21:45:00Z',location:'302 South Ave',staffingEnabled:true,categories:[
   {name:'Pantry',key:'PANTRY',active:true,sortOrder:1,spotsAvailable:2,reservedCount:0,signupEligible:true},
   {name:'Harm Reduction / First Aid / Hygiene',key:'SUPPLIES',active:true,sortOrder:2,spotsAvailable:0,reservedCount:1,signupEligible:true},
   {name:'Meal <script>',key:'MEAL',active:true,sortOrder:3,spotsAvailable:0,reservedCount:0,signupEligible:false}
  ]}]);
  expect(html).toContain('Harm Reduction / First Aid / Hygiene');expect(html).toContain('2 spots');
  expect(html).toContain('body=SUPPLIES');expect(html).toContain('for standby');
  expect(html).toContain('Meal &lt;script&gt;');expect(html).not.toContain('body=MEAL');
  expect(html).toContain('Text JOIN first');
 });
 it('shows no opportunities for an empty published list',async()=>{
  const html=await render([]);expect(html).toContain('No published volunteer events');expect(html).not.toContain('body=PANTRY');
 });
});

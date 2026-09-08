import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, impact, weatherStatus, clipSegment } from './model.js';

const data=JSON.parse(readFileSync(new URL('../../public/vr/profiles.json',import.meta.url)));
test('all 18 real zone locations project in the Chennai study area',()=>{
  const profiles=Object.values(data.profiles);assert.equal(profiles.length,18);
  const a=project([13.14,80.08]),b=project([12.88,80.30]);
  for(const {zone} of profiles){const [x,z]=project(zone.center);assert.ok(x>a[0]&&x<b[0]&&z>a[1]&&z<b[1]);}
  assert.ok(project([13.1,80.2])[1]<project([13.0,80.2])[1],'north is -Z');
});
test('every recommendation has a finite nonzero price and modelling inputs',()=>{
  for(const {interventions} of Object.values(data.profiles))for(const i of interventions){assert.ok(i.estimated_cost_inr>0);assert.ok(Number.isFinite(i.temp_drop));assert.ok(i.source);}
});
test('all zone intervention subsets use correct allowances and overlap damping',()=>{
  for(const {interventions} of Object.values(data.profiles))for(let mask=0;mask<8;mask++){
    const ids=interventions.filter((_,i)=>mask&(1<<i)).map(i=>i.id),r=impact(interventions,ids);
    const selected=interventions.filter(i=>ids.includes(i.id));
    assert.equal(r.total,Math.round(selected.reduce((s,i)=>s+i.estimated_cost_inr,0)*1.3*1.1));
    assert.equal(r.drop,Math.round(selected.reduce((s,i)=>s+i.temp_drop,0)*(ids.length>1?0.75:1)*100)/100);
  }
});
test('cache does not masquerade as live weather',()=>{
  const now=Date.parse('2026-09-07T18:00:00Z');
  assert.equal(weatherStatus({air_temp_c:29,observed_at:'2026-09-07T17:45'},now),'Live');
  assert.equal(weatherStatus({air_temp_c:29,observed_at:'2026-09-06T17:45'},now),'Cached');
  assert.equal(weatherStatus({air_temp_c:null},now),'Unavailable');
  assert.equal(weatherStatus({air_temp_c:29,observed_at:'invalid'},now),'Cached');
});
test('OSM ways are clipped to the tabletop without edge streaks',()=>{
  assert.deepEqual(clipSegment([-2,0],[2,0],[-1,-1,1,1]),[[-1,0],[1,0]]);
  assert.equal(clipSegment([-2,3],[2,3],[-1,-1,1,1]),null);
  assert.deepEqual(clipSegment([0,-2],[0,2],[-1,-1,1,1]),[[0,-1],[0,1]]);
});

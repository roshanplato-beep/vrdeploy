import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { project, impact, weatherStatus, clipSegment, zoneAreaSqm, buildableAreaSqm, maxCountFor, impactPlacements, footprintSqm } from './model.js';

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
test('a zone\'s buildable land shrinks with its own building and road coverage, never goes negative',()=>{
  for(const {zone} of Object.values(data.profiles)){
    const area=zoneAreaSqm(zone),buildable=buildableAreaSqm(zone);
    assert.ok(area>0);
    assert.ok(buildable>=0&&buildable<=area);
    const covered=(zone.building_density_pct||0)+(zone.road_coverage_pct||0);
    if(covered>=100)assert.equal(buildable,0);
  }
});
test('a solution can only fit as many times as its own footprint allows in the remaining land',()=>{
  for(const {interventions} of Object.values(data.profiles))for(const item of interventions){
    assert.equal(maxCountFor(item,0),0);
    const {sqm}=footprintSqm(item);
    assert.ok(sqm>0);
    assert.equal(maxCountFor(item,sqm*3.9),3);
  }
});
test('a measure the dataset never sized gets an area estimated from a priced sibling in its own category, clearly flagged',()=>{
  for(const {interventions} of Object.values(data.profiles))for(const item of interventions){
    const f=footprintSqm(item);
    assert.equal(f.source,Number.isFinite(item.estimated_area_sqm)?'measured':'estimated');
  }
});
test('placing many of the same measure keeps reducing temperature but never past the rural baseline',()=>{
  const {interventions}=Object.values(data.profiles)[0];
  const item=interventions[0];
  const placements=Array.from({length:50},()=>({interventionId:item.id,effectiveness:1}));
  const r=impactPlacements(interventions,placements,{baselineC:24,lstC:24+item.temp_drop*2});
  assert.ok(r.drop<=item.temp_drop*2+1e-9);
  assert.ok(r.cappedByBaseline);
  const rFew=impactPlacements(interventions,placements.slice(0,1),{baselineC:0,lstC:100});
  const rMore=impactPlacements(interventions,placements.slice(0,2),{baselineC:0,lstC:100});
  assert.ok(rMore.drop>rFew.drop,'a second placement still adds cooling when nothing caps it');
});

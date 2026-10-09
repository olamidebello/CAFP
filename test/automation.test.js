import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSignal} from '../server/automation.js';

function database(rule,duplicate=false){
  const calls=[];
  const connection={
    async beginTransaction(){calls.push('begin')},
    async execute(sql,args){
      calls.push({sql,args});
      if(sql.includes('SELECT enabled'))return [[{enabled:1}]];
      if(sql.includes('SELECT id FROM farm_events'))return [duplicate?[{id:'existing'}]:[]];
      return [{affectedRows:1}];
    },
    async commit(){calls.push('commit')},async rollback(){calls.push('rollback')},release(){calls.push('release')}
  };
  return {calls,async execute(sql,args){calls.push({sql,args});return [[rule]]},async getConnection(){return connection}};
}
const rule={id:'rule-1',tenant_id:'farm-1',plot_id:'plot-1',gateway_id:'gateway-1',
  signal:'low_moisture',threshold:20,action:'irrigation',duration_seconds:60,
  auto_dispatch:1,cooldown_minutes:15};

test('low moisture queues one tenant-scoped irrigation event',async()=>{
  const db=database(rule);const ids=await evaluateSignal(db,{tenantId:'farm-1',plotId:'plot-1',source:'sensor',signal:'low_moisture',value:12});
  assert.equal(ids.length,1);
  const insert=db.calls.find(x=>x.sql?.includes('INSERT INTO farm_events'));
  assert.equal(insert.args[1],'farm-1');assert.equal(insert.args[9],'queued');
  assert.equal(db.calls[0].args[0],'farm-1');
});
test('normal readings and cooldown do not queue another action',async()=>{
  const normal=database(rule);assert.deepEqual(await evaluateSignal(normal,{tenantId:'farm-1',plotId:'plot-1',source:'sensor',signal:'low_moisture',value:25}),[]);
  assert.ok(!normal.calls.some(x=>x.sql?.includes('INSERT INTO farm_events')));
  const duplicate=database(rule,true);assert.deepEqual(await evaluateSignal(duplicate,{tenantId:'farm-1',plotId:'plot-1',source:'sensor',signal:'low_moisture',value:10}),[]);
});
test('drone rules produce approval requests even if configured for dispatch',async()=>{
  const db=database({...rule,action:'launch_drone',auto_dispatch:1});
  await evaluateSignal(db,{tenantId:'farm-1',plotId:'plot-1',source:'sensor',signal:'low_moisture',value:10});
  assert.equal(db.calls.find(x=>x.sql?.includes('INSERT INTO farm_events')).args[9],'pending_approval');
});

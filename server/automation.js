import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';

const actions=['irrigation','open_drone_house','launch_drone'];
const signals=['low_moisture','high_temperature','camera_motion','camera_intrusion'];
const q=(db,sql,args=[])=>db.execute(sql,args).then(([rows])=>rows);
const hash=s=>createHash('sha256').update(s).digest('hex');
const error=(res,code,message)=>res.status(code).json({error:message});

export async function ensureAutomationSchema(pool){
  await pool.execute(`CREATE TABLE IF NOT EXISTS automation_rules (
    id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,plot_id CHAR(36) NOT NULL,
    gateway_id CHAR(36) NOT NULL,name VARCHAR(160) NOT NULL,
    signal ENUM('low_moisture','high_temperature','camera_motion','camera_intrusion') NOT NULL,
    threshold DECIMAL(7,2) NULL,
    action ENUM('irrigation','open_drone_house','launch_drone') NOT NULL,
    duration_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    auto_dispatch BOOLEAN NOT NULL DEFAULT FALSE,enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cooldown_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_rule_signal (tenant_id,plot_id,signal,enabled),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plot_id) REFERENCES plots(id),
    FOREIGN KEY (gateway_id) REFERENCES devices(id)
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS farm_events (
    id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,plot_id CHAR(36) NOT NULL,
    gateway_id CHAR(36) NOT NULL,rule_id CHAR(36) NULL,requested_by CHAR(36) NULL,
    approved_by CHAR(36) NULL,source ENUM('manual','sensor','camera') NOT NULL,
    signal VARCHAR(40) NOT NULL,action ENUM('irrigation','open_drone_house','launch_drone') NOT NULL,
    duration_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('pending_approval','queued','claimed','succeeded','failed','cancelled') NOT NULL,
    detail VARCHAR(500) NOT NULL DEFAULT '',result_note VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME NULL,claimed_at DATETIME NULL,finished_at DATETIME NULL,
    KEY idx_event_tenant (tenant_id,created_at),KEY idx_gateway_queue (gateway_id,status,created_at),
    KEY idx_event_rule (rule_id,created_at),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plot_id) REFERENCES plots(id),
    FOREIGN KEY (gateway_id) REFERENCES devices(id),
    FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE SET NULL,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
}

export async function evaluateSignal(pool,{tenantId,plotId,source,signal,value=null,detail=''}){
  const rules=await q(pool,`SELECT * FROM automation_rules WHERE tenant_id=? AND plot_id=? AND signal=? AND enabled=1`,
    [tenantId,plotId,signal]);
  const created=[];
  for(const rule of rules){
    if(signal==='low_moisture'&&(value===null||Number(value)>=Number(rule.threshold)) ||
       signal==='high_temperature'&&(value===null||Number(value)<=Number(rule.threshold)))continue;
    const c=await pool.getConnection();
    try{
      await c.beginTransaction();
      const [locked]=await c.execute('SELECT enabled FROM automation_rules WHERE id=? AND tenant_id=? FOR UPDATE',[rule.id,tenantId]);
      if(!locked[0]?.enabled){await c.rollback();continue}
      const [recent]=await c.execute(`SELECT id FROM farm_events WHERE rule_id=?
        AND created_at>DATE_SUB(NOW(),INTERVAL ? MINUTE) LIMIT 1`,[rule.id,rule.cooldown_minutes]);
      if(recent.length){await c.rollback();continue}
      const id=randomUUID();
      const status=rule.action==='irrigation'&&rule.auto_dispatch?'queued':'pending_approval';
      await c.execute(`INSERT INTO farm_events
        (id,tenant_id,plot_id,gateway_id,rule_id,source,signal,action,duration_seconds,status,detail)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[id,tenantId,plotId,rule.gateway_id,rule.id,source,signal,
        rule.action,rule.duration_seconds,status,String(detail).slice(0,500)]);
      await c.commit();created.push(id);
    }catch(e){await c.rollback();throw e}finally{c.release()}
  }
  return created;
}

async function gatewayFromKey(pool,req){
  const match=/^([0-9a-f-]{36})\.([0-9a-f]{48})$/i.exec(req.get('x-device-key')||'');
  if(!match)return null;
  const gateway=(await q(pool,'SELECT * FROM devices WHERE id=?',[match[1]]))[0];
  const actual=Buffer.from(hash(match[2]),'hex'),expected=Buffer.from(gateway?.api_key_hash||'','hex');
  return gateway?.kind==='gateway'&&gateway.status!=='maintenance'&&actual.length===expected.length&&
    timingSafeEqual(actual,expected)?gateway:null;
}

export function installAutomationRoutes(app,pool,{auth,requireRole,audit}){
  app.get('/api/automation/rules',auth,async(req,res,next)=>{
    try{res.json(await q(pool,'SELECT * FROM automation_rules WHERE tenant_id=? ORDER BY created_at DESC',[req.user.tenant_id]))}
    catch(e){next(e)}
  });
  app.post('/api/automation/rules',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try{
      const {name,plot,gateway,signal,threshold,action,durationSeconds=0,autoDispatch=false,cooldownMinutes=15}=req.body||{};
      const duration=Number(durationSeconds),cooldown=Number(cooldownMinutes),t=Number(threshold);
      if(typeof name!=='string'||!name.trim()||!signals.includes(signal)||!actions.includes(action)||
         !Number.isInteger(duration)||duration<0||duration>300||
         (action==='irrigation'&&(duration<1||autoDispatch&&duration>300))||
         (action!=='irrigation'&&duration!==0)||
         !Number.isInteger(cooldown)||cooldown<1||cooldown>1440||
         (['low_moisture','high_temperature'].includes(signal)&&(!Number.isFinite(t)||
           (signal==='low_moisture'&&(t<0||t>100))||(signal==='high_temperature'&&(t< -50||t>70))))||
         (autoDispatch===true&&action!=='irrigation'))return error(res,400,'Invalid automation rule');
      const [p,g]=await Promise.all([
        q(pool,'SELECT id FROM plots WHERE id=? AND tenant_id=?',[plot,req.user.tenant_id]),
        q(pool,"SELECT id FROM devices WHERE id=? AND tenant_id=? AND kind='gateway' AND plot_id=?",[gateway,req.user.tenant_id,plot])]);
      if(!p.length||!g.length)return error(res,404,'Plot or assigned gateway not found');
      const id=randomUUID();
      await q(pool,`INSERT INTO automation_rules
        (id,tenant_id,plot_id,gateway_id,name,signal,threshold,action,duration_seconds,auto_dispatch,cooldown_minutes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[id,req.user.tenant_id,plot,gateway,name.trim().slice(0,160),signal,
          ['low_moisture','high_temperature'].includes(signal)?t:null,action,duration,autoDispatch===true,cooldown]);
      await audit(req.user,'create','automation_rule',id);res.status(201).json({id});
    }catch(e){next(e)}
  });
  app.put('/api/automation/rules/:id',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try{
      if(typeof req.body?.enabled!=='boolean')return error(res,400,'Enabled must be true or false');
      const result=await q(pool,'UPDATE automation_rules SET enabled=? WHERE id=? AND tenant_id=?',
        [req.body.enabled,req.params.id,req.user.tenant_id]);
      if(!result.affectedRows)return error(res,404,'Rule not found');
      await audit(req.user,'update','automation_rule',req.params.id);res.json({ok:true});
    }catch(e){next(e)}
  });
  app.delete('/api/automation/rules/:id',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try{
      const result=await q(pool,'DELETE FROM automation_rules WHERE id=? AND tenant_id=?',[req.params.id,req.user.tenant_id]);
      if(!result.affectedRows)return error(res,404,'Rule not found');
      await audit(req.user,'delete','automation_rule',req.params.id);res.json({ok:true});
    }catch(e){next(e)}
  });
  app.get('/api/automation/events',auth,async(req,res,next)=>{
    try{res.json(await q(pool,'SELECT * FROM farm_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200',[req.user.tenant_id]))}
    catch(e){next(e)}
  });
  app.post('/api/automation/events',auth,requireRole('owner','admin','operator'),async(req,res,next)=>{
    try{
      const {plot,gateway,action,durationSeconds=0,detail=''}=req.body||{};
      const duration=Number(durationSeconds);
      if(!actions.includes(action)||!Number.isInteger(duration)||
         (action==='irrigation'&&(duration<1||duration>300))||
         (action!=='irrigation'&&duration!==0))return error(res,400,'Invalid action or duration');
      const g=await q(pool,"SELECT id FROM devices WHERE id=? AND tenant_id=? AND kind='gateway' AND plot_id=?",
        [gateway,req.user.tenant_id,plot]);
      if(!g.length)return error(res,404,'Assigned gateway not found');
      const id=randomUUID();
      await q(pool,`INSERT INTO farm_events
        (id,tenant_id,plot_id,gateway_id,requested_by,source,signal,action,duration_seconds,status,detail)
        VALUES (?,?,?,?,?,'manual','manual',?,?,'pending_approval',?)`,
        [id,req.user.tenant_id,plot,gateway,req.user.id,action,duration,String(detail).slice(0,500)]);
      await audit(req.user,'request','farm_event',id);res.status(201).json({id,status:'pending_approval'});
    }catch(e){next(e)}
  });
  app.post('/api/automation/events/:id/approve',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try{
      const event=(await q(pool,'SELECT * FROM farm_events WHERE id=? AND tenant_id=?',[req.params.id,req.user.tenant_id]))[0];
      if(!event)return error(res,404,'Event not found');
      if(event.action==='launch_drone'&&event.requested_by===req.user.id)
        return error(res,403,'Drone requests require a different owner or admin to approve');
      const result=await q(pool,`UPDATE farm_events SET status='queued',approved_by=?,approved_at=NOW()
        WHERE id=? AND tenant_id=? AND status='pending_approval'`,[req.user.id,req.params.id,req.user.tenant_id]);
      if(!result.affectedRows)return error(res,409,'Event is no longer pending');
      await audit(req.user,'approve','farm_event',req.params.id);res.json({ok:true});
    }catch(e){next(e)}
  });
  app.post('/api/automation/events/:id/cancel',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try{
      const result=await q(pool,`UPDATE farm_events SET status='cancelled',finished_at=NOW()
        WHERE id=? AND tenant_id=? AND status IN ('pending_approval','queued')`,[req.params.id,req.user.tenant_id]);
      if(!result.affectedRows)return error(res,409,'Event cannot be cancelled after gateway claim');
      await audit(req.user,'cancel','farm_event',req.params.id);res.json({ok:true});
    }catch(e){next(e)}
  });
  app.post('/api/automation/device-event',async(req,res,next)=>{
    try{
      const device=await gatewayFromKey(pool,req);
      if(!device||!device.plot_id)return error(res,401,'Assigned gateway key required');
      const signal=req.body?.signal;
      if(!['camera_motion','camera_intrusion'].includes(signal))return error(res,400,'Invalid camera signal');
      const ids=await evaluateSignal(pool,{tenantId:device.tenant_id,plotId:device.plot_id,
        source:'camera',signal,detail:req.body?.detail||''});
      res.status(201).json({events:ids});
    }catch(e){next(e)}
  });
  app.post('/api/automation/gateway/poll',async(req,res,next)=>{
    const gateway=await gatewayFromKey(pool,req);
    if(!gateway)return error(res,401,'Gateway key required');
    const c=await pool.getConnection();
    try{
      await c.beginTransaction();
      const [rows]=await c.execute(`SELECT id,action,duration_seconds,plot_id,detail FROM farm_events
        WHERE tenant_id=? AND gateway_id=? AND plot_id=? AND status='queued'
        ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [gateway.tenant_id,gateway.id,gateway.plot_id]);
      if(!rows.length){await c.commit();return res.json({command:null})}
      await c.execute("UPDATE farm_events SET status='claimed',claimed_at=NOW() WHERE id=?",[rows[0].id]);
      await c.commit();res.json({command:rows[0]});
    }catch(e){await c.rollback();next(e)}finally{c.release()}
  });
  app.post('/api/automation/gateway/:id/ack',async(req,res,next)=>{
    try{
      const gateway=await gatewayFromKey(pool,req);
      if(!gateway)return error(res,401,'Gateway key required');
      const status=req.body?.status;
      if(!['succeeded','failed'].includes(status))return error(res,400,'Acknowledge success or failure');
      const result=await q(pool,`UPDATE farm_events SET status=?,result_note=?,finished_at=NOW()
        WHERE id=? AND tenant_id=? AND gateway_id=? AND status='claimed'`,
        [status,String(req.body?.note||'').slice(0,500),req.params.id,gateway.tenant_id,gateway.id]);
      if(!result.affectedRows)return error(res,409,'Claimed command not found');
      res.json({ok:true});
    }catch(e){next(e)}
  });
}

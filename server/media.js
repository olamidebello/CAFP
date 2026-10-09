import express from 'express';
import {randomUUID, createHash, timingSafeEqual} from 'node:crypto';

const kinds={'image/jpeg':'photo','image/png':'photo','video/mp4':'video'};
const digest=value=>createHash('sha256').update(value).digest('hex');
const sql=(pool,statement,args=[])=>pool.execute(statement,args).then(([rows])=>rows);

export async function ensureMediaSchema(pool){
  await pool.execute(`CREATE TABLE IF NOT EXISTS media_assets (
    id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL, plot_id CHAR(36) NOT NULL,
    device_id CHAR(36) NULL, created_by CHAR(36) NULL,
    kind ENUM('photo','video') NOT NULL, mime_type VARCHAR(32) NOT NULL,
    payload LONGBLOB NOT NULL, byte_count INT UNSIGNED NOT NULL,
    captured_at DATETIME NOT NULL, note VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_media_tenant (tenant_id,captured_at),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plot_id) REFERENCES plots(id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
}

export function installMediaRoutes(app,pool,{auth,requireRole,audit}){
  const body=express.raw({type:['image/jpeg','image/png','video/mp4'],limit:'8mb'});
  async function save(req,res,next,device=null){
    try{
      const mime=req.get('content-type')?.split(';')[0]?.toLowerCase();
      if(!kinds[mime]||!Buffer.isBuffer(req.body)||!req.body.length||req.body.length>8_000_000)
        return res.status(400).json({error:'Upload a JPEG, PNG, or MP4 file up to 8 MB'});
      const bytes=req.body;
      if(mime==='image/jpeg'&&!(bytes[0]===0xff&&bytes[1]===0xd8) ||
         mime==='image/png'&&bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' ||
         mime==='video/mp4'&&bytes.subarray(4,8).toString()!=='ftyp')
        return res.status(400).json({error:'File does not match its media type'});
      const tenant=device?.tenant_id||req.user.tenant_id;
      const plot=device?.plot_id||req.query.plot;
      if(!plot||!(await sql(pool,'SELECT id FROM plots WHERE id=? AND tenant_id=?',[plot,tenant])).length)
        return res.status(404).json({error:'Assigned plot not found'});
      const captured=req.get('x-captured-at')||new Date().toISOString();
      if(!Number.isFinite(Date.parse(captured)))return res.status(400).json({error:'Invalid capture time'});
      const note=String(device?req.get('x-media-note')||'':req.query.note||'').slice(0,500);
      const id=randomUUID();
      await sql(pool,`INSERT INTO media_assets
        (id,tenant_id,plot_id,device_id,created_by,kind,mime_type,payload,byte_count,captured_at,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[id,tenant,plot,device?.id||null,req.user?.id||null,
          kinds[mime],mime,bytes,bytes.length,new Date(captured).toISOString().slice(0,19).replace('T',' '),note]);
      if(device)await sql(pool,"UPDATE devices SET last_seen_at=NOW(),status='online' WHERE id=? AND tenant_id=?",[device.id,tenant]);
      else await audit(req.user,'upload','media',id);
      res.status(201).json({id});
    }catch(error){next(error)}
  }
  app.post('/api/media',auth,requireRole('owner','admin','operator'),body,(req,res,next)=>save(req,res,next));
  app.post('/api/media/device',body,async(req,res,next)=>{
    try{
      const key=req.get('x-device-key')||'';
      const match=/^([0-9a-f-]{36})\.([0-9a-f]{48})$/i.exec(key);
      if(!match)return res.status(401).json({error:'Device key required'});
      const device=(await sql(pool,'SELECT * FROM devices WHERE id=?',[match[1]]))[0];
      const actual=Buffer.from(digest(match[2]),'hex');
      const expected=Buffer.from(device?.api_key_hash||'', 'hex');
      if(!device||expected.length!==actual.length||!timingSafeEqual(actual,expected)||
         !['camera','gateway'].includes(device.kind)||device.status==='maintenance')
        return res.status(401).json({error:'Invalid camera or gateway key'});
      await save(req,res,next,device);
    }catch(error){next(error)}
  });
  app.get('/api/media',auth,async(req,res,next)=>{
    try{
      const rows=await sql(pool,`SELECT id,plot_id plot,device_id device,kind,mime_type mime,
        byte_count bytes,captured_at time,note FROM media_assets WHERE tenant_id=?
        ORDER BY captured_at DESC LIMIT 100`,[req.user.tenant_id]);
      res.json(rows);
    }catch(error){next(error)}
  });
  app.get('/api/media/:id',auth,async(req,res,next)=>{
    try{
      const item=(await sql(pool,'SELECT mime_type,payload FROM media_assets WHERE id=? AND tenant_id=?',
        [req.params.id,req.user.tenant_id]))[0];
      if(!item)return res.status(404).json({error:'Media not found'});
      const bytes=item.payload;
      res.set({'Content-Type':item.mime_type,'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'});
      const range=req.get('range');
      if(range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match)return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();
        const suffix=match[1]===''?Number(match[2]):null;
        const start=suffix!==null?Math.max(0,bytes.length-suffix):Number(match[1]);
        const end=suffix!==null?bytes.length-1:match[2]===''?bytes.length-1:Math.min(bytes.length-1,Number(match[2]));
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length)
          return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();
        return res.status(206).set('Content-Range',`bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start,end+1));
      }
      res.send(bytes);
    }catch(error){next(error)}
  });
  app.delete('/api/media/:id',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try{
      const result=await sql(pool,'DELETE FROM media_assets WHERE id=? AND tenant_id=?',[req.params.id,req.user.tenant_id]);
      if(!result.affectedRows)return res.status(404).json({error:'Media not found'});
      await audit(req.user,'delete','media',req.params.id);res.json({ok:true});
    }catch(error){next(error)}
  });
}

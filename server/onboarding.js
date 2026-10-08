import {randomBytes, randomUUID, createHash} from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const emailOkay = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255;
const passwordOkay = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const fail = (res, status, error) => res.status(status).json({error});
const query = (pool, sql, args=[]) => pool.execute(sql,args).then(([rows])=>rows);

export async function ensureOnboardingSchema(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS invitations (
    id CHAR(36) PRIMARY KEY,
    tenant_id CHAR(36) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role ENUM('admin','operator','viewer') NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    KEY idx_invitation_tenant (tenant_id,created_at),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
}

export function installOnboardingRoutes(app, pool, {auth, requireRole, audit, passwordHash, checkPassword, setCookie}) {
  app.get('/api/auth/invitations/:token', async(req,res,next)=>{
    try {
      if (!/^[a-f0-9]{64}$/.test(req.params.token)) return fail(res,404,'Invitation not found');
      const invitation=(await query(pool,`SELECT i.email,i.role,t.name farm FROM invitations i
        JOIN tenants t ON t.id=i.tenant_id WHERE i.token_hash=? AND i.used_at IS NULL
        AND i.revoked_at IS NULL AND i.expires_at>NOW()`,[digest(req.params.token)]))[0];
      if (!invitation) return fail(res,404,'Invitation expired or unavailable');
      res.json(invitation);
    } catch(error){next(error)}
  });
  app.post('/api/auth/register-member', async(req,res,next)=>{
    const {token,name,password}=req.body||{};
    if (typeof token!=='string'|| !/^[a-f0-9]{64}$/.test(token) ||
        typeof name!=='string'||!name.trim()||!passwordOkay(password)) return fail(res,400,'Valid invitation, name and password required');
    const connection=await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [found]=await connection.execute(`SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL
        AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`,[digest(token)]);
      const invitation=found[0];
      if(!invitation){await connection.rollback();return fail(res,410,'Invitation expired or unavailable')}
      const [existing]=await connection.execute('SELECT id FROM users WHERE tenant_id=? AND email=?',[invitation.tenant_id,invitation.email]);
      if(existing.length){await connection.rollback();return fail(res,409,'A member with this email already belongs to the farm')}
      const userId=randomUUID();
      await connection.execute('INSERT INTO users (id,tenant_id,email,name,password_hash,role) VALUES (?,?,?,?,?,?)',
        [userId,invitation.tenant_id,invitation.email,name.trim().slice(0,160),passwordHash(password),invitation.role]);
      await connection.execute('UPDATE invitations SET used_at=NOW() WHERE id=?',[invitation.id]);
      const session=randomBytes(32).toString('hex');
      await connection.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))',[digest(session),userId]);
      const [farm]=await connection.execute('SELECT name FROM tenants WHERE id=?',[invitation.tenant_id]);
      await connection.commit();
      setCookie(res,session);
      res.status(201).json({user:{id:userId,tenant_id:invitation.tenant_id,email:invitation.email,name:name.trim(),role:invitation.role,tenant_name:farm[0].name}});
    } catch(error){await connection.rollback();next(error)} finally{connection.release()}
  });
  app.get('/api/invitations',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try {res.json(await query(pool,`SELECT id,email,role,created_at,expires_at,used_at,revoked_at FROM invitations
      WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100`,[req.user.tenant_id]))}catch(error){next(error)}
  });
  app.post('/api/invitations',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try {
      const {email,role='viewer'}=req.body||{};
      if(!emailOkay(email)||!['admin','operator','viewer'].includes(role)||req.user.role==='admin'&&role==='admin')
        return fail(res,400,'Valid email and permitted role required');
      const normalized=email.trim().toLowerCase();
      if((await query(pool,'SELECT id FROM users WHERE tenant_id=? AND email=?',[req.user.tenant_id,normalized])).length)
        return fail(res,409,'This email already belongs to the farm');
      const token=randomBytes(32).toString('hex'),invitationId=randomUUID();
      await query(pool,`INSERT INTO invitations (id,tenant_id,email,role,token_hash,created_by,expires_at)
        VALUES (?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))`,
        [invitationId,req.user.tenant_id,normalized,role,digest(token),req.user.id]);
      await audit(req.user,'invite','user',invitationId);
      res.status(201).json({id:invitationId,token,expiresInDays:7});
    }catch(error){next(error)}
  });
  app.delete('/api/invitations/:id',auth,requireRole('owner','admin'),async(req,res,next)=>{
    try {
      const result=await query(pool,`UPDATE invitations SET revoked_at=NOW() WHERE id=? AND tenant_id=?
        AND used_at IS NULL AND revoked_at IS NULL`,[req.params.id,req.user.tenant_id]);
      if(!result.affectedRows)return fail(res,404,'Active invitation not found');
      await audit(req.user,'revoke','invitation',req.params.id);
      res.json({ok:true});
    }catch(error){next(error)}
  });
  app.put('/api/profile',auth,async(req,res,next)=>{
    try {
      const {name,currentPassword,newPassword}=req.body||{};
      if(typeof name!=='string'||!name.trim())return fail(res,400,'Name required');
      if(newPassword!==undefined && !passwordOkay(newPassword))return fail(res,400,'New password must have 12–128 characters');
      const [member]=await query(pool,'SELECT password_hash FROM users WHERE id=? AND tenant_id=?',[req.user.id,req.user.tenant_id]);
      if(!member)return fail(res,404,'Member not found');
      if(newPassword && !checkPassword(currentPassword||'',member.password_hash))return fail(res,403,'Current password is incorrect');
      await query(pool,'UPDATE users SET name=?,password_hash=? WHERE id=? AND tenant_id=?',
        [name.trim().slice(0,160),newPassword?passwordHash(newPassword):member.password_hash,req.user.id,req.user.tenant_id]);
      if(newPassword){
        const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cafp_session='));
        await query(pool,'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',[req.user.id,digest(raw?.slice(13)||'')]);
      }
      await audit(req.user,'update','profile',req.user.id);
      res.json({ok:true});
    }catch(error){next(error)}
  });
}

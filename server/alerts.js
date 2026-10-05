import {randomUUID} from 'node:crypto';

const metrics = {
  moisture: {column: 'moisture', setting: 'low_moisture', label: 'Low soil moisture'},
  temperature: {column: 'temperature', setting: 'high_temperature', label: 'High temperature'}
};
const validId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const fail = (res, status, error) => res.status(status).json({error});
const rows = (pool, sql, args = []) => pool.execute(sql, args).then(([result]) => result);

// Also runs on existing database volumes; Docker's init SQL only runs once.
export async function ensureAlertSchema(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS alerts (
    id CHAR(36) PRIMARY KEY,
    tenant_id CHAR(36) NOT NULL,
    plot_id CHAR(36) NOT NULL,
    record_id CHAR(36) NULL,
    metric ENUM('moisture','temperature') NOT NULL,
    status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
    severity ENUM('warning','critical') NOT NULL DEFAULT 'warning',
    threshold DECIMAL(7,2) NOT NULL,
    current_value DECIMAL(7,2) NOT NULL,
    occurrences INT NOT NULL DEFAULT 1,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME NULL,
    acknowledged_by CHAR(36) NULL,
    resolved_at DATETIME NULL,
    resolved_by CHAR(36) NULL,
    resolution_note VARCHAR(500) NULL,
    KEY idx_alert_tenant_status (tenant_id,status,last_seen_at),
    KEY idx_alert_plot_metric (tenant_id,plot_id,metric),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE CASCADE,
    FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE SET NULL
  )`);
}

// A plot-row lock serializes concurrent device and manual readings for that plot.
export async function syncReadingAlerts(pool, {tenantId, plotId, recordId, reading}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [plot] = await connection.execute('SELECT id FROM plots WHERE id=? AND tenant_id=? FOR UPDATE', [plotId, tenantId]);
    if (!plot.length) { await connection.rollback(); return; }
    const [settings] = await connection.execute('SELECT low_moisture,high_temperature FROM tenant_settings WHERE tenant_id=?', [tenantId]);
    if (!settings.length) { await connection.rollback(); return; }
    for (const [metric, config] of Object.entries(metrics)) {
      const value = reading[config.column];
      if (value === null || value === undefined || value === '') continue;
      const threshold = Number(settings[0][config.setting]);
      const triggered = metric === 'moisture' ? Number(value) < threshold : Number(value) > threshold;
      const [active] = await connection.execute(
        "SELECT id FROM alerts WHERE tenant_id=? AND plot_id=? AND metric=? AND status IN ('open','acknowledged') ORDER BY opened_at DESC FOR UPDATE",
        [tenantId, plotId, metric]
      );
      if (triggered) {
        const severity = metric === 'moisture'
          ? Number(value) < threshold / 2 ? 'critical' : 'warning'
          : Number(value) > threshold + 10 ? 'critical' : 'warning';
        if (active.length) {
          await connection.execute(
            'UPDATE alerts SET record_id=?,current_value=?,threshold=?,severity=?,occurrences=occurrences+1,last_seen_at=NOW() WHERE id=?',
            [recordId, value, threshold, severity, active[0].id]
          );
        } else {
          await connection.execute(
            'INSERT INTO alerts (id,tenant_id,plot_id,record_id,metric,severity,threshold,current_value) VALUES (?,?,?,?,?,?,?,?)',
            [randomUUID(), tenantId, plotId, recordId, metric, severity, threshold, value]
          );
        }
      } else if (active.length) {
        await connection.execute(
          "UPDATE alerts SET status='resolved',resolved_at=NOW(),resolution_note='Reading returned to normal' WHERE tenant_id=? AND plot_id=? AND metric=? AND status IN ('open','acknowledged')",
          [tenantId, plotId, metric]
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const selectAlerts = `SELECT a.id,a.plot_id,a.record_id,a.metric,a.status,a.severity,
  a.threshold,a.current_value,a.occurrences,a.opened_at,a.last_seen_at,
  a.acknowledged_at,a.resolved_at,a.resolution_note,p.name AS plot_name
  FROM alerts a JOIN plots p ON p.id=a.plot_id WHERE a.tenant_id=?`;

export function installAlertRoutes(app, pool, auth, requireRole, audit) {
  app.get('/api/alerts', auth, async (req, res, next) => {
    try {
      const status = req.query.status || 'active';
      if (!['active','open','acknowledged','resolved','all'].includes(status)) return fail(res, 400, 'Invalid status');
      const severity = req.query.severity || 'all';
      if (!['all','warning','critical'].includes(severity)) return fail(res, 400, 'Invalid severity');
      const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
      const args = [req.user.tenant_id];
      let sql = selectAlerts;
      if (status === 'active') sql += " AND a.status IN ('open','acknowledged')";
      else if (status !== 'all') { sql += ' AND a.status=?'; args.push(status); }
      if (severity !== 'all') { sql += ' AND a.severity=?'; args.push(severity); }
      if (req.query.plot) {
        if (!validId(req.query.plot)) return fail(res, 400, 'Invalid plot');
        sql += ' AND a.plot_id=?'; args.push(req.query.plot);
      }
      sql += ' ORDER BY a.last_seen_at DESC LIMIT ?';
      args.push(limit);
      res.json(await rows(pool, sql, args));
    } catch (error) { next(error); }
  });

  app.post('/api/alerts/:id/:action', auth, requireRole('owner','admin','operator'), async (req, res, next) => {
    try {
      const {id, action} = req.params;
      if (!validId(id) || !['acknowledge','resolve','reopen'].includes(action)) return fail(res, 400, 'Invalid alert action');
      const note = String(req.body?.note || '').trim().slice(0, 500);
      const transitions = {
        acknowledge: ["status='acknowledged',acknowledged_at=NOW(),acknowledged_by=?", "status='open'"],
        resolve: ["status='resolved',resolved_at=NOW(),resolved_by=?,resolution_note=?", "status IN ('open','acknowledged')"],
        reopen: ["status='open',acknowledged_at=NULL,acknowledged_by=NULL,resolved_at=NULL,resolved_by=NULL,resolution_note=NULL", "status='resolved'"]
      };
      const [set, where] = transitions[action];
      const values = action === 'acknowledge' ? [req.user.id] : action === 'resolve' ? [req.user.id, note] : [];
      const result = await rows(pool, `UPDATE alerts SET ${set} WHERE id=? AND tenant_id=? AND ${where}`, [...values,id,req.user.tenant_id]);
      if (!result.affectedRows) return fail(res, 409, 'Alert not found or action is not available in its current state');
      await audit(req.user, action, 'alert', id);
      res.json({ok:true});
    } catch (error) { next(error); }
  });

  app.post('/api/alerts/bulk', auth, requireRole('owner','admin','operator'), async (req, res, next) => {
    try {
      const {ids, action} = req.body || {};
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(validId) ||
          !['acknowledge','resolve'].includes(action)) return fail(res, 400, 'Provide 1–100 alert IDs and an action');
      const unique = [...new Set(ids)];
      const placeholders = unique.map(() => '?').join(',');
      const set = action === 'acknowledge'
        ? "status='acknowledged',acknowledged_at=NOW(),acknowledged_by=?"
        : "status='resolved',resolved_at=NOW(),resolved_by=?,resolution_note='Bulk resolution'";
      const condition = action === 'acknowledge' ? "status='open'" : "status IN ('open','acknowledged')";
      const result = await rows(pool, `UPDATE alerts SET ${set} WHERE tenant_id=? AND id IN (${placeholders}) AND ${condition}`,
        [req.user.id,req.user.tenant_id,...unique]);
      await audit(req.user, action, 'alerts', String(result.affectedRows));
      res.json({updated:result.affectedRows});
    } catch (error) { next(error); }
  });
}

export async function dashboardAlerts(pool, tenantId) {
  return rows(pool, selectAlerts + " AND a.status IN ('open','acknowledged') ORDER BY a.last_seen_at DESC LIMIT 100", [tenantId]);
}

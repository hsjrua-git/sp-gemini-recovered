import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { auditContext } from '../lib/auditContext.js';
import {
  classifyRequest,
  entityIdFromPath,
  normalisePath,
  safeBody,
} from '../lib/auditRules.js';

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

export function auditRequests(req, res, next) {
  if (READ_ONLY.has(req.method)) return next();

  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const path = normalisePath(req.originalUrl);
    // These changes already have atomic row snapshots, recorded by database
    // triggers. Route-level bulk summaries remain alongside those snapshots.
    if (/^\/api\/(students|groups|teachers|parameters|intervals|assignments|sessions|periods|evaluations|tasks|task-templates|alerts|field-definitions)(\/|$)/.test(path)) return;
    const kind = classifyRequest(req.method, path, res.statusCode);
    if (!kind) return;

    const isAuth = path.startsWith('/api/auth/');
    const user = req.user ?? responseBody?.user ?? null;
    const attempted =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase().slice(0, 64)
        : null;

    const details = isAuth
      ? {
          ip: req.ip,
          ...(kind.action.startsWith('auth.login')
            ? { attemptedUsername: attempted }
            : {}),
        }
      : {
          method: req.method,
          path,
          request: safeBody(req.body),
          result: safeBody(responseBody),
        };

    recordAudit(pool, {
      userId: user?.id ?? null,
      actor: user?.username ?? attempted ?? 'unknown',
      action: kind.action,
      entityType: kind.entityType,
      entityId: isAuth
        ? (user?.id ?? null)
        : (responseBody?.id ?? entityIdFromPath(path)),
      details,
    }).catch((error) => {
      console.error('Could not write audit entry:', error);
    });
  });

  auditContext.run({ userId: req.user?.id, actor: req.user?.username }, next);
}

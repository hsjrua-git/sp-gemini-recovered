import { AsyncLocalStorage } from 'node:async_hooks';

export const auditContext = new AsyncLocalStorage();

// Initialize every checkout, including background/session-store checkouts.
// Values are session-scoped so both one-statement writes and explicit
// transactions carry the actor into their transactional database triggers.
export function attachAuditContext(pool) {
  const connect = pool.connect.bind(pool);
  pool.connect = (callback) => {
    const context = auditContext.getStore();
    const acquire = async () => {
      const client = await connect();
      try {
        await client.query(
          `SELECT set_config('app.user_id',$1,false), set_config('app.actor',$2,false),
                  set_config('app.override_reason','',false), set_config('app.reset_data','',false)`,
          [context?.userId ?? '', context?.actor ?? ''],
        );
        return client;
      } catch (error) {
        client.release(error);
        throw error;
      }
    };
    if (typeof callback === 'function') {
      acquire().then(client => callback(null, client, client.release), error => callback(error));
      return;
    }
    return acquire();
  };
  return pool;
}

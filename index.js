import "dotenv/config";
import express from "express";
import { pool, initDb, consume, bodyDefault, installErrorHandlers,
  authenticate, auditTrail, requireRole, isAdmin, sameEntity, jsonError } from "./common.js";

const app = express();
const PORT = process.env.PORT || 3008;

app.disable("x-powered-by");
app.use(express.json());
app.use(bodyDefault);

await initDb(`
CREATE TABLE IF NOT EXISTS templates(
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  channel TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(
  id BIGSERIAL PRIMARY KEY,
  entity_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_id);`);
await pool.query("insert into templates(name,channel) values('recall','system'),('fraud','system') on conflict do nothing");

app.get("/", (_, res) => res.json({ service: "notification-service", status: "ok" }));
app.get("/health", async (_, res) => {
  try { await pool.query("select 1"); res.json({ status: "ok" }); }
  catch { res.status(503).json({ status: "down" }); }
});

// El gateway quita el prefijo /notifications, así que el servicio expone /entity/:id.
// La ruta antigua (/notifications/entity/:id) se mantiene por compatibilidad.
// 2.7: sesión obligatoria (C1). Cada usuario ve solo sus avisos (M1):
//   - los de su propia entidad (su nombre);
//   - admin y fabricante: también los avisos de recall de un lote (id del lote);
//   - admin: además los avisos de fraude (por serial) y los del sistema.
// 2.8: registro de auditoría (va antes de authenticate para anotar también los 401).
app.use(auditTrail("notification", []));
app.use(authenticate);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/templates", requireRole("admin"), async (_, res) => res.json((await pool.query("select * from templates")).rows));
app.get(["/entity/:id", "/notifications/entity/:id"], async (req, res) => {
  const id = req.params.id;
  const allowed = isAdmin(req) || sameEntity(id, req.auth.name) || (req.auth.role === "fabricante" && UUID_RE.test(id));
  if (!allowed) return jsonError(res, 403, "Solo puedes consultar tus propias notificaciones");
  const sql = UUID_RE.test(id) || isAdmin(req)
    ? "select * from notifications where entity_id=$1 order by created_at desc"
    : "select * from notifications where lower(trim(entity_id))=lower(trim($1)) order by created_at desc";
  res.json((await pool.query(sql, [id])).rows);
});

const save = (entity, event, message) =>
  pool.query("insert into notifications(entity_id,event_type,message) values($1,$2,$3)", [entity, event, message]);

consume("notification-service", async (msg) => {
  if (msg.event === "fraud.alert") {
    const a = msg.payload.alert;
    await save(a.serial_number || "system", msg.event,
      `Alerta de fraude (${a.severity})${a.pattern ? `: ${a.pattern}` : ""}`);
  } else if (msg.event === "recall.initiated") {
    const r = msg.payload;
    await save(r.batch_id, msg.event, `Recall iniciado: ${r.reason}`);
    // Además se avisa a cada entidad que recibió unidades del lote.
    for (const entity of r.affected_entities || []) {
      await save(entity, msg.event, `Recall del lote ${r.batch_id}: ${r.reason}`);
    }
  }
});

installErrorHandlers(app);
app.listen(PORT, () => console.log(`Notification Service http://localhost:${PORT}`));

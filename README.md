# notification-service — VetChain

Servicio de notificaciones. Convierte eventos del sistema (alertas de fraude, recalls) en avisos
dirigidos a las entidades afectadas.

## Responsabilidad en la arquitectura

Es el **canal de avisos** de la plataforma. Consume los eventos relevantes y escribe una notificación
por destinatario, que el frontend muestra por entidad.

- Consume `fraud.alert` y `recall.initiated`.
- Guarda notificaciones asociadas a una **entidad** (por nombre).
- Expone las notificaciones por entidad y la plantilla de mensajes.

## Tecnologías

| Componente | Versión |
|---|---|
| Node.js | ≥ 18 |
| Express | ^5.2.1 |
| pg | ^8.16.3 |
| amqplib (RabbitMQ) | ^0.10.9 |
| dotenv | ^18.0.1 |

## Instalación y ejecución

**Método oficial (recomendado): Docker Compose**, desde la raíz del proyecto:

```bash
docker compose up -d --build --wait
```

**Ejecución directa** (requiere PostgreSQL y RabbitMQ):

```bash
npm install
node index.js        # o: npm start
```

El servicio escucha en `PORT` (3008 por defecto).

## Endpoints principales

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` , `/health` | Público | Identificación y estado. |
| GET | `/templates` | admin / master-admin | Plantillas de notificación. |
| GET | `/entity/:id` , `/notifications/entity/:id` | Autenticado | Notificaciones de una entidad. |

## Variables de entorno

| Variable | Defecto | Descripción |
|---|---|---|
| `PORT` | `3008` | Puerto de escucha. |
| `DATABASE_URL` | — | Conexión a PostgreSQL. |
| `DB_NAME` | — | Base de datos a usar dentro de la misma instancia. |
| `DB_POOL_MAX` | `10` | Tamaño máximo del pool. |
| `RABBITMQ_URL` | `amqp://localhost:5672` | Conexión AMQP. |
| `JWT_SECRET` | — | Verificación del token. |
| `AUTH_SERVICE_URL` | `http://localhost:3001` | Validación de sesión/ámbito. |

## Base de datos

- `templates` (`id`, `name` **UNIQUE**, `channel`) — sembrado con `recall` y `system`.
- `notifications` (`id`, `entity_id`, `event_type`, `message`, `status`, `created_at`)
  + índice `idx_notifications_entity`.

## Reglas de negocio

- Las notificaciones se **indexan por el NOMBRE de la entidad**, no por id. La ruta del Gateway
  (`/notifications/entity/<nombre>`) recibe el nombre **codificado en URL**
  (p. ej. `Mar%C3%ADa%20Gonz%C3%A1lez`); pasar un id numérico devuelve `403`.
- El acceso a las notificaciones de una entidad se filtra con la comprobación `sameEntity`.
- Un recall genera un aviso por **cada entidad afectada**; una alerta de fraude, un aviso a la
  administración.

## Eventos

- **Consume** (`vetchain.events`): `fraud.alert`, `recall.initiated`.
- **Publica**: ninguno.

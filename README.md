# SanaConsultIA — Agente WhatsApp

Agente conversacional de WhatsApp con dashboard de gestión en tiempo real.

## Stack

- **Node.js** (v18+) con ES Modules
- **Baileys** — WhatsApp Web API (sin número de empresa)
- **OpenRouter** — LLM vía API (compatible con Claude, GPT-4, Mixtral…)
- **Express + Socket.IO** — Dashboard web en tiempo real
- **SQLite** (better-sqlite3) — Base de datos local

---

## Requisitos previos

- Node.js 18 o superior → [nodejs.org](https://nodejs.org)
- Cuenta en [OpenRouter](https://openrouter.ai) con créditos
- WhatsApp activo en tu teléfono

---

## Instalación

```bash
# 1. Clonar / entrar al directorio
cd agente-whatsapp

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tu OPENROUTER_API_KEY
```

### Contenido de `.env`

```env
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxx
OPENROUTER_MODEL=anthropic/claude-3-haiku
PORT=3000
SITE_URL=http://localhost:3000
SITE_NAME=SanaConsultIA
```

> Puedes cambiar el modelo por cualquiera disponible en OpenRouter:
> `openai/gpt-4o-mini`, `mistralai/mixtral-8x7b`, `anthropic/claude-3-5-sonnet`, etc.

---

## Arrancar el bot

```bash
npm start
```

Al iniciar verás:

```
🚀 Dashboard → http://localhost:3000
QR generado — escanea con WhatsApp
```

1. Abre el dashboard en **http://localhost:3000**
2. Aparecerá el **código QR** en el panel izquierdo
3. En WhatsApp de tu teléfono → *Dispositivos vinculados* → *Vincular dispositivo*
4. Escanea el QR
5. El bot queda conectado ✓

Las credenciales se guardan en `auth_info/` — la próxima vez arranca sin pedir QR.

---

## Funcionalidades

### Modos de operación (por conversación)

| Modo | Comportamiento |
|------|----------------|
| 🤖 **IA** | El bot responde automáticamente usando OpenRouter |
| 👤 **Humano** | Los mensajes llegan al dashboard pero el bot **no** responde |

El toggle se puede cambiar en tiempo real desde el dashboard sin reiniciar.

### Dashboard (`localhost:3000`)

- **Lista de conversaciones** — ordenadas por actividad reciente
- **Historial de mensajes** — con timestamps y diferenciación visual
- **Toggle IA / Humano** — por contacto individual
- **Envío manual** — en modo humano puedes responder desde el dashboard
- **Estado de conexión** — indicador en tiempo real (conectado / QR / desconectado)
- **QR en pantalla** — escaneo desde el propio navegador

### Persistencia

Todas las conversaciones y mensajes se guardan en `data.db` (SQLite).

---

## Estructura del proyecto

```
agente-whatsapp/
├── index.js          # Servidor Express + Socket.IO + rutas API
├── whatsapp.js       # Conexión Baileys, gestión de mensajes
├── ai.js             # Cliente OpenRouter (prompt + historial)
├── database.js       # SQLite — conversaciones y mensajes
├── dashboard/
│   ├── index.html    # Interfaz del panel
│   ├── style.css     # Estilos (tema oscuro tipo WhatsApp)
│   └── app.js        # Lógica frontend + Socket.IO cliente
├── auth_info/        # Credenciales WhatsApp (se genera automáticamente)
├── data.db           # Base de datos SQLite (se genera automáticamente)
├── .env              # Variables de entorno (NO subir a git)
├── .env.example      # Plantilla
└── package.json
```

---

## API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/api/status` | Estado de la conexión WhatsApp |
| `GET`  | `/api/conversations` | Lista todas las conversaciones |
| `GET`  | `/api/conversations/:phone/messages` | Historial de un contacto |
| `POST` | `/api/conversations/:phone/mode` | Cambiar modo `{ mode: "ai" \| "human" }` |
| `POST` | `/api/conversations/:phone/send` | Enviar mensaje `{ message: "texto" }` |

---

## Personalizar el prompt

Edita la constante `SYSTEM_PROMPT` en `ai.js` para adaptar la personalidad, servicios y restricciones del bot a tu negocio.

---

## Producción (opcional)

Para ejecutar en un servidor con PM2:

```bash
npm install -g pm2
pm2 start index.js --name sanaconsultia-bot
pm2 save
pm2 startup
```

Para exponer con HTTPS usa nginx como proxy inverso apuntando al puerto 3000.

---

## Solución de problemas

**El QR no aparece en el dashboard**
→ Refresca la página. El QR se emite por Socket.IO al conectar.

**Error `OPENROUTER_API_KEY` inválida**
→ Verifica que el archivo `.env` existe y tiene la clave correcta.

**El bot no responde**
→ Comprueba que la conversación está en modo "IA" (badge verde en el dashboard).

**Desconexiones frecuentes**
→ Normal durante las primeras horas; Baileys reconecta automáticamente.

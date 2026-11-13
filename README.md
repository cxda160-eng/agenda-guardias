# Agenda de Guardias

App web instalable (PWA) para compartir guardias, fellowship, consultorio y planes entre dos personas.
Los datos se guardan en tu propio sitio de Netlify (Netlify Blobs) y se protegen con un PIN que solo conocen ustedes dos.

## Qué hay en la carpeta

```
public/                     la app (lo que se ve)
  index.html
  manifest.webmanifest      datos para instalarla en el celular
  sw.js                     permite abrirla sin señal
  icons/
netlify/functions/turnos.mjs   el servidor que guarda los turnos
netlify.toml                configuración de Netlify
package.json                dependencia @netlify/blobs
```

## Importante antes de publicar

El arrastre de carpeta de **Netlify Drop no sirve para esta app**: Drop solo publica archivos estáticos y no instala el servidor (la función). Usá una de estas dos opciones.

### Opción A — Con GitHub (recomendada)

1. Creá un repositorio nuevo en GitHub (puede ser privado) y subí todo el contenido de esta carpeta.
2. En Netlify: **Add new site → Import an existing project → GitHub** y elegí el repositorio.
   Netlify lee `netlify.toml` solo; no hace falta cambiar nada en la configuración de build.
3. Antes o después del primer deploy, andá a **Site configuration → Environment variables → Add a variable**:
   - Key: `AGENDA_PIN`
   - Value: el PIN que van a usar los dos (por ejemplo, 6 dígitos o una palabra; mejor si no es obvio).
4. Andá a **Deploys → Trigger deploy → Deploy site** para que tome el PIN.

### Opción B — Con Netlify CLI (desde la compu)

```bash
npm install
npm install -g netlify-cli
netlify login
netlify init            # crea el sitio
netlify env:set AGENDA_PIN "tu-pin"
netlify deploy --prod
```

## Uso

1. Abrí la dirección del sitio (algo como `https://tu-agenda.netlify.app`).
2. Ingresá tu nombre y el PIN. Pasale la dirección y el PIN a la otra persona.
3. Para instalarla como app:
   - **Android (Chrome):** menú ⋮ → *Instalar app* o *Agregar a pantalla principal*.
   - **iPhone (Safari):** botón Compartir → *Agregar a inicio*.

La agenda se actualiza sola cada 2 minutos mientras está abierta y cada vez que volvés a abrirla (si pasaron más de 30 segundos). Sin señal muestra lo último que se cargó, pero para guardar cambios hace falta conexión.

## Ver las guardias en el calendario del celular

En la app, tocá **📲 Calendario del celular**. Ahí está el enlace de suscripción y las instrucciones para iPhone/iPad y para Google Calendar.
Las guardias traen aviso la noche anterior y 1 hora antes (en iPhone hay que desactivar *Eliminar alertas* para ese calendario).
El enlace depende del PIN: si cambiás el PIN, hay que volver a suscribirse.

## Cambiar el PIN

Cambiá `AGENDA_PIN` en Netlify y volvé a desplegar. Los dos van a tener que ingresar el PIN nuevo; los turnos no se pierden.

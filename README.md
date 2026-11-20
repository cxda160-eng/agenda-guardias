# Agenda de Guardias

App web instalable (PWA) para compartir guardias, fellowship, consultorio y planes entre dos personas.
La app se publica con **GitHub Pages** (carpeta `docs/`) y los turnos se guardan en **Firebase Firestore**, protegidos por un PIN compartido.

## Estructura

```
docs/                    la app que publica GitHub Pages
  index.html, app.js
  firebase-config.js     datos del proyecto de Firebase (no son secretos)
  manifest.webmanifest, sw.js, icons/
firestore.rules          reglas de seguridad para pegar en Firebase
```

## Cómo funciona el PIN

Cada agenda se guarda en Firestore bajo una clave de 64 caracteres calculada a partir del PIN.
Sin el PIN no se puede llegar a los datos, y las reglas impiden listar las agendas.
La primera vez, al ingresar el PIN la app ofrece **Crear agenda nueva con este PIN**.
Si cambian el PIN, se crea una agenda nueva y vacía: el PIN no se puede cambiar sin pasar los turnos.

## Puesta en marcha

1. Crear un proyecto en Firebase y una base Firestore (modo producción).
2. Pegar el contenido de `firestore.rules` en **Firestore → Reglas** y publicar.
3. Registrar una app web y copiar su configuración en `docs/firebase-config.js`.
4. En GitHub: **Settings → Pages → Deploy from a branch → main / docs**.

## Calendario del celular

El botón **📲 Pasar al calendario** descarga un archivo `.ics` con los turnos desde la fecha elegida, para importar en iPhone o Google Calendar.
No se actualiza solo: GitHub Pages no tiene servidor para un enlace de suscripción.

## Respaldo

En la app, **Respaldo de datos** copia todos los turnos o importa una copia. Importar dos veces la misma copia no duplica turnos.

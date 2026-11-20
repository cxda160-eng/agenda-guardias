// Configuración de Firebase (Consola de Firebase → Configuración del proyecto → Tus apps → app web).
// Estos datos no son secretos: identifican el proyecto. La protección de las guardias está en las reglas
// de Firestore (firestore.rules) y en el PIN, que nunca se guarda en el código.
export const FIREBASE_CONFIG = {
  apiKey: "PEGAR_API_KEY",
  authDomain: "PEGAR_PROYECTO.firebaseapp.com",
  projectId: "PEGAR_PROYECTO",
  storageBucket: "PEGAR_PROYECTO.appspot.com",
  messagingSenderId: "PEGAR",
  appId: "PEGAR"
};

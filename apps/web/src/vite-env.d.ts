/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the API, for example https://api.example.com. Unset means same origin (the Vite proxy in dev).
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

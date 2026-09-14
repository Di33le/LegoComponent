/// <reference types="vite/client" />

declare module "*.mp3" {
  const src: string;
  export default src;
}

declare module "*.stl" {
  const src: string;
  export default src;
}

declare module "*.stl?url" {
  const src: string;
  export default src;
}

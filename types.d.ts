declare module "*.html" {
  const route: import("bun").HTMLBundle;
  export default route;
}

declare module "*.css";

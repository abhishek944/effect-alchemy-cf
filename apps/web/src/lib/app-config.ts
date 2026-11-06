const { name } = PUBLIC_APP_CONFIG;

export const appConfig = Object.freeze({
  name,
  initial: Array.from(name)[0]?.toUpperCase() ?? "",
});

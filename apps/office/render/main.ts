/// <reference types="vite/client" />
import { mountOfficeRenderPage } from "@starter/office-server/render-page";
import "./styles.css";

const fonts = document.createElement("link");
fonts.rel = "stylesheet";
fonts.href = new URL("assets/fonts.css", document.baseURI).href;
await new Promise<void>((resolve, reject) => {
  fonts.addEventListener("load", () => resolve(), { once: true });
  fonts.addEventListener(
    "error",
    () => reject(new Error("Packaged Office math fonts are missing.")),
    { once: true },
  );
  document.head.append(fonts);
});

const container = document.querySelector<HTMLElement>("#app");
if (container === null) throw new Error("The native Office render container is missing.");
await mountOfficeRenderPage(container);

// Local-only specimen behavior. No network requests, credentials, or persistence.
const input = document.querySelector('[aria-label="Message draft"]');
const send = document.querySelector('[aria-label="Send sample message"]');
const status = document.querySelector('[role="status"]');
const model = document.querySelector('[aria-label="Choose sample model"]');
const popup = document.querySelector("#model-menu");
if (
  !(input instanceof HTMLTextAreaElement) ||
  !(send instanceof HTMLButtonElement) ||
  !(status instanceof HTMLElement) ||
  !(model instanceof HTMLButtonElement) ||
  !(popup instanceof HTMLElement)
) {
  throw new Error("The specimen requires its labeled draft, buttons, status and popup.");
}
const modelIcon = model.querySelector("svg");
if (!modelIcon) throw new Error("The specimen model button requires its icon.");
const update = () => {
  send.disabled = !input.value.trim();
};
input.addEventListener("input", update);
const submit = () => {
  if (!input.value.trim()) return;
  status.textContent = "Sample sent locally. No request was made.";
  input.value = "";
  update();
};
send.addEventListener("click", submit);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
});
document.querySelectorAll(".sidebar .row").forEach((row) =>
  row.addEventListener("click", () => {
    document.querySelectorAll(".sidebar .row").forEach((item) => {
      item.classList.remove("selected");
      item.removeAttribute("aria-current");
    });
    row.classList.add("selected");
    row.setAttribute("aria-current", "page");
    status.textContent = "Sample sidebar selection updated.";
  }),
);
model.addEventListener("click", () => {
  popup.hidden = !popup.hidden;
  model.setAttribute("aria-expanded", String(!popup.hidden));
  if (!popup.hidden) popup.querySelector("button")?.focus();
});
popup.querySelectorAll("button").forEach((item) =>
  item.addEventListener("click", () => {
    model.replaceChildren(
      document.createTextNode(item.textContent + " "),
      modelIcon.cloneNode(true),
    );
    popup.hidden = true;
    model.setAttribute("aria-expanded", "false");
    model.focus();
    status.textContent = "Sample model selected: " + item.textContent;
  }),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !popup.hidden) {
    popup.hidden = true;
    model.setAttribute("aria-expanded", "false");
    model.focus();
  }
});
document.querySelectorAll("[data-feedback]").forEach((button) =>
  button.addEventListener("click", () => {
    status.textContent = button.getAttribute("data-feedback") ?? "";
  }),
);
update();

document.querySelector(".sidebar .row.selected")?.setAttribute("aria-current", "page");

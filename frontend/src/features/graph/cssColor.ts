// Resolves a design token (e.g. "--tool-color") to the concrete color of the
// current theme. Sigma draws on a canvas and cannot read CSS variables or
// light-dark() itself.
export function cssColor(token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

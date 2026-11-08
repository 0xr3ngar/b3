export { layoutFor, planRoute, toTransitInput } from "@t3tools/universal-learn/mapModel";

export function linePaint(color: string): string {
  switch (color) {
    case "primary":
    case "success":
    case "rust":
    case "span":
    case "warning":
    case "info":
      return `var(--l-${color})`;
    default:
      return "var(--foreground)";
  }
}

import type { MobileThemeVariable, MobileThemeVariables } from "../lib/mobileTheme";

const LINE_COLOR: Record<string, MobileThemeVariable> = {
  primary: "--color-primary",
  success: "--color-primary",
  warning: "--color-warning",
  info: "--color-primary",
  rust: "--color-warning",
  span: "--color-foreground",
};

export function learnLineColor(token: string, colors: MobileThemeVariables): string {
  if (token.startsWith("#") || token.startsWith("rgb")) return token;
  return colors[LINE_COLOR[token] ?? "--color-primary"];
}

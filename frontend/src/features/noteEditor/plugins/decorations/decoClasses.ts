// Highest emphasis level styled in editorTheme.ts ("[********** x]").
const MAX_STRONG_LEVEL = 10;

// Maps the decoration characters of a "deco" node (the text between "[" and
// the space, e.g. "*/") to CSS classes: one "deco-<char>" per distinct
// character, plus "level level-N" when "*" is present (N = number of "*",
// like Cosense's "deco-* level level-2"). Combinations need no nesting: the
// classes simply stack on one element.
export function decoClasses(decos: string): string[] {
  const classes = [...new Set(decos)].map((char) => `deco-${char}`);
  const stars = [...decos].filter((char) => char === "*").length;
  if (stars > 0) {
    classes.push("level", `level-${Math.min(stars, MAX_STRONG_LEVEL)}`);
  }
  return classes;
}

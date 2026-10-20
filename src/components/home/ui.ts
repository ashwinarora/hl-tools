/** Button and link looks shared by the tiles and bands of design C. */
export const BTN =
	"inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,opacity,border-color] focus-visible:outline-2 focus-visible:outline-offset-2";

/** The flagship's action: the brand's own fill. */
export const BTN_BRAND = `${BTN} bg-brand text-brand-foreground hover:opacity-90`;

/** A second action: an outline on whatever ground it sits on. */
export const BTN_OUTLINE = `${BTN} border border-border-strong bg-surface/70 text-foreground hover:bg-surface-2`;

/** The faucet's action: ink on amber, the same weight as the flagship's. */
export const BTN_INK = `${BTN} bg-foreground text-background hover:opacity-90`;

/** A quiet text link with an underline that shows on hover. */
export const TEXT_LINK =
	"inline-flex items-center gap-1 text-sm text-muted-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground";

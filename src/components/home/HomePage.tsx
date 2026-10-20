import { MotionConfig } from "motion/react";
import { MULTISIG_WRAP } from "#/components/Header";
import { cn } from "#/lib/utils";
import { Bands } from "./Bands";
import { HERO } from "./copy";
import { FaucetTile } from "./FaucetTile";
import { MultisigTile } from "./MultisigTile";
import { ToolsTile } from "./ToolsTile";

/**
 * The refined Bento (C2): one headline for everyone, then the three products
 * in one screen at 1440×900. The Multisig takes the left 7 of 12 columns
 * and both rows; the faucet and the tools stack on the right. On a phone the
 * tiles stack in the same order, then one band per product.
 *
 * The grid is as wide as the site's header (1,440 px) so the tiles line up
 * with the logo and the network switch. Motion follows the reader's
 * reduced-motion setting everywhere on the page.
 */
export function HomePage() {
	return (
		<MotionConfig reducedMotion="user">
			<main>
				<section aria-labelledby="c-title" className="pb-12 sm:pb-16 xl:pb-10">
					<div
						className={cn(
							MULTISIG_WRAP,
							"c2-rise flex flex-col gap-3 pt-8 pb-5 sm:pt-10 lg:flex-row lg:items-end lg:justify-between lg:gap-12 lg:pt-7",
						)}
					>
						<h1
							id="c-title"
							className="text-balance text-[34px] leading-[1.02] font-semibold tracking-[-0.04em] sm:text-[46px] lg:text-[52px] xl:whitespace-nowrap"
						>
							{HERO.title}
						</h1>
						<p className="max-w-[46ch] text-pretty text-[15px] leading-relaxed text-muted-foreground lg:max-w-[40ch] lg:pb-1.5">
							{HERO.sub}
						</p>
					</div>

					<div
						className={cn(
							MULTISIG_WRAP,
							"grid gap-3 md:grid-cols-2 xl:min-h-[clamp(640px,calc(100svh-180px),740px)] xl:grid-cols-12 xl:grid-rows-[auto_minmax(0,1fr)]",
						)}
					>
						<MultisigTile className="md:col-span-2 xl:col-span-7 xl:row-span-2 xl:row-start-1" />
						<FaucetTile className="xl:col-span-5 xl:col-start-8 xl:row-start-1" />
						<ToolsTile className="xl:col-span-5 xl:col-start-8 xl:row-start-2" />
					</div>
				</section>

				<Bands wrap={MULTISIG_WRAP} />
			</main>
		</MotionConfig>
	);
}

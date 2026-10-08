import { type Address, isAddress } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";

export interface AddressCheck {
	readonly address: Address | null;
	readonly issues: readonly Issue[];
}

export const ZERO_ADDRESS =
	"0x0000000000000000000000000000000000000000" as Address;

/**
 * Validate and lowercase an address. Mixed case is accepted with a warning:
 * the chain lowercases addresses before hashing, so a document must never
 * carry them in checksum form.
 */
export function normaliseAddress(value: unknown, path: string): AddressCheck {
	if (!isAddress(value)) {
		return {
			address: null,
			issues: [
				issue(
					"address.invalid",
					"error",
					`${path} must be a 20-byte hex address (0x + 40 hex digits).`,
					{ path },
				),
			],
		};
	}
	const lower = value.toLowerCase() as Address;
	const issues: Issue[] = [];
	if (lower !== value) {
		issues.push(
			issue(
				"address.uppercase",
				"warning",
				`${path} was mixed case; normalised to lowercase (the chain hashes lowercase addresses).`,
				{ path },
			),
		);
	}
	return { address: lower, issues };
}

export function isZeroAddress(address: string): boolean {
	return address.toLowerCase() === ZERO_ADDRESS;
}

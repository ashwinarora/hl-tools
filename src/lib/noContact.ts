/**
 * No-contact mode: the one place the rest of the app learns about it.
 *
 * `NO_CONTACT=true` in the build environment produces a deployment with no way to reach
 * me: no links to my GitHub, and a noindex page. Unset, or any other value, is the
 * normal site. The value is fixed at build time (see vite.config.ts), so anything gated
 * on NO_CONTACT is removed from the bundle and the server output, not just unrendered.
 *
 * Gate contact UI with `NO_CONTACT` directly. See README "No-contact mode".
 */
declare const __NO_CONTACT__: boolean;

export const NO_CONTACT: boolean = __NO_CONTACT__;

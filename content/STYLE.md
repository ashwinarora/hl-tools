# hl-tools docs: how to write a page

Audience: someone who has never used hl-tools, reading quickly. They want to know what a thing is for, how to do it, and what happens next. The app already warns at every step, so the docs do not repeat every warning: they cover what a reader must know *before* they start, and the steps.

## Shape of a page (MDX in `content/docs/`)

```mdx
---
title: Short title, the page's subject (sentence case)
description: One sentence, 50 to 160 characters, what the page answers. Shown under the title, in search results and in llms.txt.
covers: [ids this page documents, see below]
---

One or two sentences: what this is for. No heading before it.

## Before you start          (only when something applies: wallet, network, who does this step)

## Steps / How to use it     (Steps component; button and field names in **bold**, exactly as on screen)

## What happens next         (or "Reading the result" for a tool)

## Good to know              (folded: Accordions; at most ~5 short items; edge cases, tips)

<TryIt to="/route?with=params">Open the X</TryIt>
```

- At most about 700 words outside the folded "Good to know" and tables. Shorter is better.
- Short sentences. One idea per sentence. Second person ("you"), present tense.
- No filler: no "simply", "just", "easily", "powerful", "seamless", "In this guide we will".
- Never claim: private, privately, encrypted, only you, confidential, secret, free, no server, without a server, no backend, never leaves, browser only. Say what happens instead ("Your pasted text is decoded in this page; hl-tools does not store it").
- Names of buttons, tabs and fields exactly as the screen writes them, in bold: **Run probe**, **Compare two payloads**.
- Link other docs pages with relative site paths: `[the Signing Inspector](/docs/tools/signing)`. Link app screens the same way: `/tools/signing`.
- Developer-tool pages may use the developer's words (nonce, EIP-712, MsgPack, CoreWriter, precompile, tick size, JSON-RPC…). Explain each the first time in a few words.
- Do not invent behaviour. Every sentence must be true of the code as it is. Read the component before you describe it. If unsure, leave it out.

## Components

```mdx
<Steps>
<Step>

### Paste a payload

Paste the request body into **Payload**.

</Step>
<Step>

### Read the verdict

…

</Step>
</Steps>

<Callout type="warn" title="Careful">Only for something that loses money or time if missed. Always type="warn" (amber); a test holds it.</Callout>
<Callout title="Note">A fact worth seeing before the steps.</Callout>

<Accordions>
<Accordion title="Why does my signature recover a different address?">
Two or three sentences.
</Accordion>
</Accordions>

<TryIt to="/tools/signing?sample=order">Try it with a sample order</TryIt>

<Fact id="activationFee" />   (numbers from the rule files; ids in src/lib/docs/facts.ts)

<RuleTable id="order-rules" />   (a whole table from the rule files, with its source and check date under it; ids in src/lib/docs/tables.ts)

<WalletPrompt kind="send" />    (a drawn wallet pop-up with the fields to check numbered; kinds in src/lib/docs/prompts.ts; add `testnet` for a testnet signer's view)
```

- **Search words.** `keywords: [EIP712, tick size]` in the frontmatter adds other spellings a reader may type. Quote anything YAML would read as a number: `"0x3333"`, `"1e8"`.
- **Marks on a screenshot** live in `src/components/docs/marks.ts`, keyed by the picture's path: at most four boxes, in the picture's own pixels, with a label of a few words. The page draws them and lists the labels under the picture; a re-shot picture only needs its boxes moved.

Screenshots are added later. Where one belongs, leave a comment on its own line saying exactly what it should show:
`{/* shot: the Verdict panel after loading the "order" sample, with the recovered signer in green */}`
At most two or three per page, only where a picture explains better than words.

## `covers:` ids

Multisig pages list the action kinds (`sendUsdc`, `sendToken`, …), treasury tabs and proposal statuses they document. Tool pages list the tool id from `src/lib/tools.ts` (`assets`, `signing`, `corewriter`, `trace`, `orders`, `websocket`, `rpc`, `multisig`).

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

World of Warcraft players who want to understand simulation results, compare gear and talent choices, and plan their next upgrade or dungeon route.

## Product Purpose

WhyLowDPS keeps local SimulationCraft, character context, and upgrade and PvE planning in one workflow so players can make informed decisions about their characters.

## Positioning

The workflow connects a local simulation to result analysis, realistic gear comparisons, and route or weekly planning. Players can start with manual SimC in credential-free Light Mode, use optional Battle.net context, or run a private hosted instance.

## Operating Context

Players use the product while reviewing a character, preparing for a raid or dungeon, choosing an upgrade, or checking weekly progress. The public site helps them understand the workflow and choose among Windows desktop, private Docker/PWA hosting, and trusted-LAN phone pairing.

## Capabilities and Constraints

- The Windows app runs SimulationCraft locally and stores credentials, profiles, routes, history, and simulations on the user's machine.
- Light Mode supports manual SimC and local workflows without Battle.net credentials; connected character tools are optional.
- Private Docker hosting runs a separate app, backend, and Linux SimulationCraft runtime with operator-controlled access.
- LAN phone pairing is opt-in and intended for a trusted private network; it must not be described as internet-facing.
- WhyLowDPS is independent and is not affiliated with Blizzard Entertainment, SimulationCraft, or Raidbots.

## Evidence on Hand

- Public project site: `docs/index.html` and `docs/styles.css`.
- Real product screenshots: `docs/assets/screenshots/`.
- Public source and releases: `https://github.com/JosephLteif/simcraft`.
- Current setup guidance: `docs/getting-started.md`, `docs/docker-hosting.md`, and `docs/lan-sharing.md`.

## Product Principles

- Show how a question moves from simulation to a useful decision.
- Keep product claims tied to the shipped app and setup documentation.
- Make setup choices and privacy boundaries easy to understand.
- Preserve local-first use and make account connection optional.

## Brand Commitment

The public GitHub Pages site uses a clear, category-standard dark product layout. Use Raidbots, WoWAnalyzer, and SimulationCraft as references for task clarity and technical credibility without borrowing their visual identities.

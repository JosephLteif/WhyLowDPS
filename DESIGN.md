---
name: WhyLowDPS Website
description: A dark, product-led site for local simulation and upgrade planning.
colors:
  background: "#0e171b"
  background-soft: "#111c21"
  surface: "#152128"
  foreground: "#f5f6f6"
  text-soft: "#c5cdd2"
  text-muted: "#929fa7"
  divider: "rgba(173, 191, 201, 0.14)"
  divider-strong: "rgba(173, 191, 201, 0.24)"
  action-blue: "#1d63d4"
  action-blue-hover: "#1959bf"
  brand-brass: "#d5ad53"
  brand-brass-bright: "#f0c968"
typography:
  display:
    fontFamily: '"Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(2.7rem, 3.8vw, 3.55rem)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(2rem, 3.5vw, 3.35rem)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  body:
    fontFamily: '"Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: "0.82rem"
    fontWeight: 600
rounded:
  control: "8px"
  panel: "12px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "40px"
  xl: "72px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "46px"
  screenshot-frame:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
---

# Design System: WhyLowDPS Website

## Overview

**Creative North Star: "The Upgrade Bench"**

The public site should feel like a precise place to evaluate a character decision. Its structure follows the player's path: see the product, scan what it can answer, understand the workflow, then choose how to run it. Real WhyLowDPS screenshots carry the proof; the frame stays quiet so the product remains legible.

Dark graphite and blue-gray surfaces keep the page calm. Blue marks the primary action, while restrained brass connects the site to the existing WhyLowDPS mark and game context. Use the system sans stack for fast rendering without an external font request.

**Key Characteristics:**
- Product proof before decorative treatment.
- Clear section hierarchy and generous separation.
- Blue actions, restrained brass details, and authentic screenshots.

## Colors

The palette pairs quiet blue-gray surfaces with high-contrast text, one clear action color, and a small brass accent.

### Primary
- **Action Blue** (#1d63d4): Primary download action and selection emphasis.
- **Brand Brass** (#d5ad53): Small line icons and selected-state detail tied to the existing mark.

### Secondary
- **Bright Brass** (#f0c968): Small labels and modal callouts where brass needs emphasis.

### Neutral
- **Graphite** (#0e171b): Main page background.
- **Deep Slate** (#111c21): Secondary section surfaces.
- **Raised Slate** (#152128): Dialogs, screenshot frames, and restrained panels.
- **Off White** (#f5f6f6): Headings and primary text.
- **Soft Slate** (#c5cdd2): Body copy on dark surfaces.
- **Muted Slate** (#929fa7): Secondary copy, captions, and navigation.
- **Cool Divider** (rgba(173, 191, 201, 0.14)): Section separators and quiet borders.

### Named Rules
**The Proof Before Polish Rule.** Use real app screens for product claims; decoration never substitutes for a capability.

## Typography

**Display Font:** Segoe UI (Inter, system UI, sans-serif fallback)
**Body Font:** Segoe UI (Inter, system UI, sans-serif fallback)
**Label/Mono Font:** System sans; reserve monospace for actual code.

**Character:** Direct, compact, and familiar to a Windows-first audience. Bold headings lead; body copy stays readable and conversational.

### Hierarchy
- **Display** (720, clamp(2.7rem, 3.8vw, 3.55rem), 1.08): Main landing-page statement.
- **Headline** (720, clamp(2rem, 3.5vw, 3.35rem), 1.08): Section headings.
- **Title** (700, clamp(1.15rem, 1.8vw, 1.45rem), 1.08): Feature and workflow titles.
- **Body** (400, 1rem, 1.55): Explanations, held near 68ch where space allows.
- **Label** (600, 0.82rem): Navigation and supporting labels.

## Layout

Use a centered container capped at 1320px, with 64px desktop gutters and 36px at tablet widths. The first viewport pairs a compact hero copy column with a larger real dashboard screenshot. Below it, a four-part proof strip gives way to an editorial feature showcase. At 1060px the hero and feature showcase stack; at 820px the header and grids reflow; at 560px proof points become a single column. Section padding scales from 64px on small screens to 112px on wide screens.

## Elevation & Depth

Surfaces stay mostly flat. Thin neutral borders separate sections; neutral black shadows lift product screenshots and dialogs without colored halos.

### Shadow Vocabulary
- **Screenshot Frame** (`0 22px 54px rgba(0, 0, 0, .38)`): Quietly separates real app screenshots from the page.
- **Dialog** (`0 30px 100px rgba(0, 0, 0, .65)`): Holds focus above the page backdrop.

### Named Rules
**The Neutral Elevation Rule.** Shadows use neutral black; color belongs to text, borders, and controls.

## Shapes

Controls use a restrained 8px radius; screenshot frames and dialogs use 12px. Section boundaries use thin rules rather than nested rounded containers. Avoid glass treatment and decorative gradients.

## Components

### Buttons
- **Shape:** Compact 8px corners (8px radius).
- **Primary:** Solid blue fill, white text, and 11px 18px padding; the action stays explicit.
- **Hover / Focus:** One-pixel lift on hover; a visible blue focus outline for keyboard use.
- **Secondary:** Transparent fill with a quiet border and the same control height.

### Cards / Containers
- **Corner Style:** 12px for screenshot frames; feature and setup content uses open columns.
- **Background:** Raised slate appears only for overlays and a few restrained panels.
- **Shadow Strategy:** Neutral screenshot and dialog elevation only.
- **Border:** Fine cool-gray dividers; no colored edge bars.
- **Internal Padding:** 24–30px for feature and setup sections.

### Inputs / Fields
- **Style:** Native select with a dark surface, fine border, and 8px corners.
- **Focus:** Blue outline with offset; maintain visible keyboard focus.
- **Error / Disabled:** No custom error state on the public landing page.

### Navigation
- **Style:** Compact, medium-weight links in muted slate. Hover uses blue; the desktop header stays sticky, while mobile navigation scrolls horizontally.

### Screenshot Frame
Use the original product capture at its natural aspect ratio, with a thin border and neutral shadow. Captions are optional and stay secondary.

### FAQ Disclosure
Use native `details` and `summary`, with a fine divider, a clear open state, and no modal interruption.

## Do's and Don'ts

### Do:
- **Do** use authentic screenshots and accurate product language.
- **Do** keep body and muted text above WCAG AA contrast on dark surfaces.
- **Do** honor `prefers-reduced-motion` and keep content visible without animation.

### Don't:
- **Don't** use glowing shadows, gradients, or decorative grids as atmosphere.
- **Don't** invent product metrics, testimonials, or UI content.
- **Don't** turn each capability into a repeated rounded card.
